/**
 * 大檔分割／索引／合併
 *
 * 流程：
 * 1. 將共 x 筆明細的 ACH 檔 partition 成 y 個小檔（各含 BOF＋明細＋EOF）
 * 2. 產出 index JSON（dictionary）：記錄來源、各 part 檔名、序號區間、筆數／金額
 * 3. 分批改檔（例如 P01→R01）後，依 index 合併回單一輸出大檔
 */

import {
  convertP01ToR01,
  type ConvertP01ToR01Options,
  type ConvertedR01File,
} from "./convertR01";
import {
  buildRecord,
  emptyHeader,
  isRowEmpty,
  lookupTxid,
} from "./engine";
import {
  IMPORT_LIMITS,
  parseRecordFields,
  type ImportProgress,
} from "./import";
import {
  filterExcludedDetailLines,
  type ExcludeRulesDoc,
} from "./exclude";
import type {
  Branch,
  DetailRow,
  FormatSchema,
  HeaderValues,
  RecordFieldDef,
  Txid,
} from "./schema";
import { newRowId, safeDigits } from "./utils";

export const PARTITION_LIMITS = {
  /** 未指定時預設每包筆數（對齊可編輯表單上限） */
  defaultChunkSize: IMPORT_LIMITS.maxFormDetailRows,
  /** 大檔轉檔時記憶體中暫存的明細列上限 */
  convertChunkSize: 2_000,
  progressIntervalMs: IMPORT_LIMITS.progressIntervalMs,
} as const;

export const PARTITION_INDEX_KIND = "ach-partition-index" as const;

export type PartitionEntry = {
  /** 0-based */
  index: number;
  filename: string;
  detailCount: number;
  amount: number;
  /** 來源檔全域序號（1-based，含） */
  seqFrom: number;
  /** 來源檔全域序號（1-based，含） */
  seqTo: number;
  /** 來源明細 0-based 起始位移 */
  detailOffset: number;
};

export type PartitionIndex = {
  version: 1;
  kind: typeof PARTITION_INDEX_KIND;
  sourceFilename: string;
  formatCode: string;
  recordLength: number;
  lineEnding: string;
  createdAt: string;
  header: HeaderValues;
  /** 原始控制首錄（合併時優先使用以保留 TTIME 等） */
  headerLine: string;
  totalDetailCount: number;
  totalAmount: number;
  /** 實際產出的分割檔數 y */
  partCount: number;
  /** 規劃用：每包目標筆數（最後一包可能較少） */
  chunkSize: number;
  partitions: PartitionEntry[];
};

export type PartitionFile = {
  filename: string;
  content: string;
  entry: PartitionEntry;
};

export type PartitionPlan = {
  partCount: number;
  chunkSize: number;
  sizes: number[];
};

export type PartitionProgress = ImportProgress & {
  phase: "count" | "write" | "convert" | "merge";
  partIndex: number;
  partCount: number;
};

/** 平均分配 x 筆到 y 檔（前 rem 檔多 1 筆）；y 無上限（至多 x，每檔至少 1 筆） */
export function planPartitionSizes(
  totalDetailCount: number,
  partCount: number,
): number[] {
  const x = Math.max(0, Math.floor(totalDetailCount));
  if (x === 0) return [];
  const y = Math.min(Math.max(1, Math.floor(partCount)), x);
  const base = Math.floor(x / y);
  const rem = x % y;
  return Array.from({ length: y }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * 規劃「可在網頁表單編輯」的分割：每包 ≤ maxFormDetailRows。
 * 若指定的 y 太小會自動加大；檔數無上限。
 */
export function planPartitionsForEdit(
  totalDetailCount: number,
  preferredPartCount?: number,
): PartitionPlan & { autoRaised: boolean; minPartCount: number } {
  const x = Math.max(0, Math.floor(totalDetailCount));
  const maxPer = IMPORT_LIMITS.maxFormDetailRows;
  const minPartCount = Math.max(1, Math.ceil(x / maxPer) || 1);
  let partCount = preferredPartCount ?? minPartCount;
  const autoRaised = partCount < minPartCount;
  partCount = Math.max(partCount, minPartCount);
  const plan = planPartitions(x, { partCount });
  return { ...plan, autoRaised, minPartCount };
}

/** 由筆數與「要幾個檔」或「每檔幾筆」規劃分割（檔數無上限） */
export function planPartitions(
  totalDetailCount: number,
  opts: { partCount?: number; chunkSize?: number },
): PartitionPlan {
  const x = Math.max(0, Math.floor(totalDetailCount));
  if (x === 0) {
    return { partCount: 0, chunkSize: 0, sizes: [] };
  }

  let partCount: number;
  let chunkSize: number;

  if (opts.partCount != null && opts.partCount > 0) {
    partCount = Math.min(Math.max(1, Math.floor(opts.partCount)), x);
    chunkSize = Math.ceil(x / partCount);
  } else {
    chunkSize = Math.max(
      1,
      Math.floor(opts.chunkSize ?? PARTITION_LIMITS.defaultChunkSize),
    );
    partCount = Math.ceil(x / chunkSize);
  }

  const sizes = planPartitionSizes(x, partCount);
  return {
    partCount: sizes.length,
    chunkSize,
    sizes,
  };
}

export function partitionIndexFilename(sourceFilename: string): string {
  const base = sourceFilename.replace(/\.[^.]+$/, "") || "ach";
  return `${base}.partition-index.json`;
}

export function partitionPartFilename(
  sourceFilename: string,
  partIndex: number,
  partCount: number,
  formatCode: string,
): string {
  const base = sourceFilename.replace(/\.[^.]+$/, "") || formatCode;
  const width = Math.max(2, String(partCount).length);
  const n = String(partIndex + 1).padStart(width, "0");
  const total = String(partCount).padStart(width, "0");
  return `${base}.part${n}of${total}.txt`;
}

export function stringifyPartitionIndex(index: PartitionIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function parsePartitionIndex(text: string): PartitionIndex {
  const data = JSON.parse(text) as PartitionIndex;
  if (data?.kind !== PARTITION_INDEX_KIND || data.version !== 1) {
    throw new Error("不是有效的分割索引（partition-index）檔");
  }
  if (!Array.isArray(data.partitions) || data.partitions.length === 0) {
    throw new Error("分割索引沒有 partitions");
  }
  return data;
}

function endingOf(schema: FormatSchema): string {
  return schema.lineEnding || "\r\n";
}

function amountFromDetailLine(line: string, schema: FormatSchema): number {
  const fields = parseRecordFields(line, schema.records.detail.fields);
  const amt = fields.find((f) => f.id === "AMT");
  return Math.floor(Number(safeDigits(amt?.value ?? "0") || 0));
}

function headerFromLine(line: string, schema: FormatSchema): HeaderValues {
  const header = emptyHeader(schema);
  const fields = parseRecordFields(line, schema.records.header.fields);
  for (const f of fields) {
    if (f.source === "header" && f.key) header[f.key] = f.value;
  }
  // PBANK 等可能只在明細；從 CDATA/TDATE 已足夠合併用
  const headerKeys = new Set(schema.form.header.map((f) => f.key));
  for (const k of Object.keys(header)) {
    if (!headerKeys.has(k)) delete header[k];
  }
  // SORG 對應 bankCode：若 header 無 bankCode，嘗試從 SORG 欄
  if (!header.bankCode) {
    const sorg = fields.find((f) => f.id === "SORG");
    if (sorg?.value) header.bankCode = safeDigits(sorg.value);
  }
  if (!header.date) {
    const tdate = fields.find((f) => f.id === "TDATE");
    if (tdate?.value) header.date = safeDigits(tdate.value);
  }
  return header;
}

function detailRowFromLine(line: string, schema: FormatSchema): DetailRow {
  const fields = parseRecordFields(line, schema.records.detail.fields);
  const row: DetailRow = { id: newRowId() };
  for (const f of schema.form.detail) {
    row[f.key] = "";
  }
  for (const f of fields) {
    if (f.source === "detail" && f.key) row[f.key] = f.value;
    if (f.source === "header" && f.key && !row[f.key]) {
      // P01：PBANK/PCLNO/TXID 來自 header source，一併帶入列供轉檔
    }
  }
  // ACHP01 detail 表單欄位對應 records.detail 的 detail-source
  for (const def of schema.records.detail.fields) {
    if (def.source === "detail" && def.key) {
      const parsed = fields.find((x) => x.id === def.id);
      if (parsed) row[def.key] = parsed.value;
    }
  }
  return row;
}

/** 自 header values 組控制首錄 */
export function buildHeaderLine(
  schema: FormatSchema,
  header: HeaderValues,
  totalCount: number,
  totalAmount: number,
  txids: Txid[],
  branches: Branch[],
): string {
  return buildRecord(schema.records.header.fields, {
    schema,
    header,
    seq: 0,
    totalCount,
    totalAmount,
    txids,
    branches,
  });
}

/** 自 header values 組控制尾錄（重算 TCOUNT／TAMT） */
export function buildTrailerLine(
  schema: FormatSchema,
  header: HeaderValues,
  totalCount: number,
  totalAmount: number,
  txids: Txid[],
  branches: Branch[],
): string {
  return buildRecord(schema.records.trailer.fields, {
    schema,
    header,
    seq: 0,
    totalCount,
    totalAmount,
    txids,
    branches,
  });
}

/**
 * 只改寫分割包的控制首／尾錄，保留明細列原文。
 * 用於工作區同步「共用首錄」到其餘包。
 */
export function patchPartitionControlRecords(
  schema: FormatSchema,
  content: string,
  header: HeaderValues,
  txids: Txid[],
  branches: Branch[],
): { content: string; detailCount: number; amount: number; headerLine: string } {
  const ending = endingOf(schema);
  const details = extractDetailLines(content, schema.recordLength);
  let amount = 0;
  for (const line of details) {
    amount += amountFromDetailLine(line, schema);
  }
  const headerLine = buildHeaderLine(
    schema,
    header,
    details.length,
    amount,
    txids,
    branches,
  );
  const trailer = buildTrailerLine(
    schema,
    header,
    details.length,
    amount,
    txids,
    branches,
  );
  return {
    content: [headerLine, ...details, trailer].join(ending) + ending,
    detailCount: details.length,
    amount,
    headerLine,
  };
}

function buildPartitionContent(
  schema: FormatSchema,
  headerLine: string,
  detailLines: string[],
  header: HeaderValues,
  amount: number,
  txids: Txid[],
  branches: Branch[],
): string {
  const ending = endingOf(schema);
  const trailer = buildTrailerLine(
    schema,
    header,
    detailLines.length,
    amount,
    txids,
    branches,
  );
  if (trailer.length !== schema.recordLength) {
    throw new Error(
      `分割尾錄長度 ${trailer.length} ≠ ${schema.recordLength}（fields=${schema.records.trailer.fields.length}）`,
    );
  }
  return (
    [headerLine, ...detailLines, trailer].join(ending) + ending
  );
}

/** 固定長度列右補空白至 recordLength（合併／讀檔時尾端空白常被吃掉） */
export function padRecordLine(line: string, recordLength: number): string {
  if (line.length === recordLength) return line;
  if (line.length > recordLength) return line.slice(0, recordLength);
  return line + " ".repeat(recordLength - line.length);
}

/** 以 latin1 讀取 File，避免 UTF-8 解碼造成固定長度位移 */
export async function readFileAsLatin1(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return new TextDecoder("latin1").decode(buf);
}

function fitFieldPiece(piece: string, def: RecordFieldDef): string {
  const len = def.length;
  if (piece.length === len) return piece;
  if (piece.length > len) return piece.slice(0, len);
  const padChar =
    def.pad?.char ??
    (def.charset === "digit" || def.pad?.side === "left" ? "0" : " ");
  if (def.pad?.side === "left" || def.charset === "digit") {
    return padChar.repeat(len - piece.length) + piece;
  }
  return piece + " ".repeat(len - piece.length);
}

/**
 * 在「原始明細列」上只覆寫表單相關欄位，保留 filler／專用區等原始內容。
 * （避免 generateFromSchema 整列重寫把 NOTE／MEMO 等吃成空白）
 */
export function patchDetailLine(
  schema: FormatSchema,
  rawLine: string,
  opts: {
    header: HeaderValues;
    detail: DetailRow;
    seq: number;
    totalCount: number;
    totalAmount: number;
    txids: Txid[];
    branches: Branch[];
  },
): string {
  const rl = schema.recordLength;
  const base = padRecordLine(rawLine, rl);
  const ctx = {
    schema,
    header: opts.header,
    detail: opts.detail,
    seq: opts.seq,
    totalCount: opts.totalCount,
    totalAmount: opts.totalAmount,
    txids: opts.txids,
    branches: opts.branches,
  };

  let offset = 0;
  let out = "";
  for (const def of schema.records.detail.fields) {
    const rawSlice = base.slice(offset, offset + def.length);
    // filler／runtime：保留原始切片（發動者專用區、備註等）
    if (def.source === "filler" || def.source === "runtime") {
      out += padRecordLine(rawSlice, def.length);
    } else {
      const piece = fitFieldPiece(buildRecord([def], ctx), def);
      out += piece;
    }
    offset += def.length;
  }
  return padRecordLine(out, rl);
}

/**
 * 以表單資料存回分割包：控制首／尾錄重算，明細在原始列上 patch。
 */
export function rebuildPartitionPreservingDetails(
  schema: FormatSchema,
  originalContent: string,
  header: HeaderValues,
  rows: DetailRow[],
  txids: Txid[],
  branches: Branch[],
): {
  content: string;
  detailCount: number;
  amount: number;
  headerLine: string;
} {
  const ending = endingOf(schema);
  const amountKey = schema.features.amountKey;
  const nonEmpty = rows.filter((r) => !isRowEmpty(r, schema));
  const rawDetails = extractDetailLines(originalContent).map((l) =>
    padRecordLine(l, schema.recordLength),
  );

  let totalAmount = 0;
  if (amountKey) {
    for (const r of nonEmpty) {
      totalAmount += Number(r[amountKey]) || 0;
    }
  }

  const details: string[] = [];
  let seq = 1;
  for (let i = 0; i < nonEmpty.length; i++) {
    const row = nonEmpty[i]!;
    const raw = rawDetails[i];
    if (raw) {
      details.push(
        patchDetailLine(schema, raw, {
          header,
          detail: row,
          seq,
          totalCount: nonEmpty.length,
          totalAmount,
          txids,
          branches,
        }),
      );
    } else {
      // 表單新增列：無原始列可保留，才整列產生
      details.push(
        buildRecord(schema.records.detail.fields, {
          schema,
          header,
          detail: row,
          seq,
          totalCount: nonEmpty.length,
          totalAmount,
          txids,
          branches,
        }),
      );
    }
    seq += 1;
  }

  const headerLine = buildHeaderLine(
    schema,
    header,
    nonEmpty.length,
    totalAmount,
    txids,
    branches,
  );
  const trailer = buildTrailerLine(
    schema,
    header,
    nonEmpty.length,
    totalAmount,
    txids,
    branches,
  );

  const content =
    [headerLine, ...details, trailer].join(ending) + ending;
  return {
    content,
    detailCount: nonEmpty.length,
    amount: totalAmount,
    headerLine,
  };
}

type LineHandler = (line: string, lineIndex: number) => void | Promise<void>;

async function streamFileLines(
  file: File,
  opts: {
    onLine: LineHandler;
    onProgress?: (p: {
      bytesRead: number;
      linesRead: number;
    }) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let bytesRead = 0;
  let lineIndex = 0;
  let lastProgressAt = 0;

  const report = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < PARTITION_LIMITS.progressIntervalMs) {
      return;
    }
    lastProgressAt = now;
    opts.onProgress?.({ bytesRead, linesRead: lineIndex });
  };

  try {
    while (true) {
      if (opts.signal?.aborted) throw new Error("已取消");
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (lineIndex === 0 && line.charCodeAt(0) === 0xfeff) {
          line = line.slice(1);
        }
        await opts.onLine(line, lineIndex);
        lineIndex += 1;
        if (lineIndex % 2000 === 0) {
          report();
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
      report();
    }
    buf += decoder.decode();
    if (buf.length) {
      let line = buf;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (lineIndex === 0 && line.charCodeAt(0) === 0xfeff) {
        line = line.slice(1);
      }
      await opts.onLine(line, lineIndex);
      lineIndex += 1;
    }
    report(true);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

async function countAchDetails(
  file: File,
  schema: FormatSchema,
  opts?: {
    onProgress?: (p: PartitionProgress) => void;
    signal?: AbortSignal;
  },
): Promise<{
  headerLine: string;
  header: HeaderValues;
  detailCount: number;
  totalAmount: number;
}> {
  let headerLine = "";
  let header: HeaderValues = emptyHeader(schema);
  let detailCount = 0;
  let totalAmount = 0;

  await streamFileLines(file, {
    signal: opts?.signal,
    onProgress: (p) =>
      opts?.onProgress?.({
        phase: "count",
        partIndex: 0,
        partCount: 0,
        bytesRead: p.bytesRead,
        totalBytes: file.size,
        linesRead: p.linesRead,
        detailCount,
        matchedCount: detailCount,
      }),
    onLine: (line) => {
      if (!line.trim()) return;
      if (line.startsWith("BOF")) {
        if (!headerLine) {
          headerLine = line;
          header = headerFromLine(line, schema);
        }
        return;
      }
      if (line.startsWith("EOF")) return;
      detailCount += 1;
      totalAmount += amountFromDetailLine(line, schema);
    },
  });

  if (!headerLine) throw new Error("找不到表頭列（BOF）");
  if (!detailCount) throw new Error("沒有明細列可分割");

  // 補齊提出行帳號：ACHP01 的 PCLNO 在明細
  if (!header.account || !header.txid || !header.taxId) {
    // 第二趟太貴；合併／轉檔時由呼叫端補。此處僅用首錄。
  }

  return { headerLine, header, detailCount, totalAmount };
}

/**
 * 串流分割 ACH 檔。每完成一包呼叫 onPartition；最後回傳 index。
 * 兩趟掃描：先計數以平均分配到 y 檔，再寫出。
 */
export async function partitionAchFile(
  file: File,
  schema: FormatSchema,
  txids: Txid[],
  branches: Branch[],
  opts: {
    partCount?: number;
    chunkSize?: number;
    onPartition: (part: PartitionFile) => void | Promise<void>;
    onProgress?: (p: PartitionProgress) => void;
    signal?: AbortSignal;
  },
): Promise<PartitionIndex> {
  const counted = await countAchDetails(file, schema, {
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

  // 自明細補 header（提出帳號／統編／交易代號）— 再掃時第一筆明細帶入
  const plan = planPartitions(counted.detailCount, {
    partCount: opts.partCount,
    chunkSize: opts.chunkSize,
  });
  if (plan.partCount === 0) throw new Error("分割規劃為 0 個檔");

  const header = { ...counted.header };
  const partitions: PartitionEntry[] = [];
  let partIndex = 0;
  let inPart = 0;
  let partAmount = 0;
  let detailLines: string[] = [];
  let globalSeq = 0;
  let partSeqFrom = 1;
  let enriched = false;

  const flush = async () => {
    if (detailLines.length === 0) return;
    const filename = partitionPartFilename(
      file.name,
      partIndex,
      plan.partCount,
      schema.code,
    );
    const seqFrom = partSeqFrom;
    const seqTo = globalSeq;
    const entry: PartitionEntry = {
      index: partIndex,
      filename,
      detailCount: detailLines.length,
      amount: partAmount,
      seqFrom,
      seqTo,
      detailOffset: seqFrom - 1,
    };
    const content = buildPartitionContent(
      schema,
      counted.headerLine,
      detailLines,
      header,
      partAmount,
      txids,
      branches,
    );
    partitions.push(entry);
    await opts.onPartition({ filename, content, entry });
    opts.onProgress?.({
      phase: "write",
      partIndex: partIndex + 1,
      partCount: plan.partCount,
      bytesRead: file.size,
      totalBytes: file.size,
      linesRead: 0,
      detailCount: counted.detailCount,
      matchedCount: globalSeq,
    });
    partIndex += 1;
    inPart = 0;
    partAmount = 0;
    detailLines = [];
    partSeqFrom = globalSeq + 1;
  };

  await streamFileLines(file, {
    signal: opts.signal,
    onProgress: (p) =>
      opts.onProgress?.({
        phase: "write",
        partIndex,
        partCount: plan.partCount,
        bytesRead: p.bytesRead,
        totalBytes: file.size,
        linesRead: p.linesRead,
        detailCount: counted.detailCount,
        matchedCount: globalSeq,
      }),
    onLine: async (line) => {
      if (!line.trim() || line.startsWith("BOF") || line.startsWith("EOF")) {
        return;
      }
      globalSeq += 1;
      if (!enriched) {
        const fields = parseRecordFields(line, schema.records.detail.fields);
        for (const f of fields) {
          if (!f.key || !f.value) continue;
          // 提出帳號／統編仍在 header source；交易代號已改 detail source
          const fromHeader = f.source === "header";
          const fromDetailTxid = f.source === "detail" && f.key === "txid";
          if (!fromHeader && !fromDetailTxid) continue;
          // 交易代號／提出帳號／統編：以全檔明細第一筆為準；其餘僅補空值
          if (
            f.key === "txid" ||
            f.key === "account" ||
            f.key === "taxId" ||
            !header[f.key]
          ) {
            header[f.key] = f.value;
          }
        }
        enriched = true;
      }
      const amt = amountFromDetailLine(line, schema);
      detailLines.push(line);
      partAmount += amt;
      inPart += 1;
      const target = plan.sizes[partIndex] ?? plan.chunkSize;
      if (inPart >= target) await flush();
    },
  });

  await flush();

  if (partitions.length !== plan.partCount) {
    // 容許因空檔略過；以實際為準
  }

  return {
    version: 1,
    kind: PARTITION_INDEX_KIND,
    sourceFilename: file.name,
    formatCode: schema.code,
    recordLength: schema.recordLength,
    lineEnding: endingOf(schema),
    createdAt: new Date().toISOString(),
    header,
    headerLine: counted.headerLine,
    totalDetailCount: counted.detailCount,
    totalAmount: counted.totalAmount,
    partCount: partitions.length,
    chunkSize: plan.chunkSize,
    partitions,
  };
}

export type MergeInput = {
  index: PartitionIndex;
  /** filename → 檔案內容（純文字） */
  parts: Map<string, string> | Record<string, string>;
};

function asPartMap(
  parts: Map<string, string> | Record<string, string>,
): Map<string, string> {
  return parts instanceof Map ? parts : new Map(Object.entries(parts));
}

function extractDetailLines(text: string, recordLength?: number): string[] {
  // 固定長度列尾常為空白 FILLER，不可 trimEnd
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .filter((l) => l.length > 0);
  const details = lines.filter(
    (l) => !l.startsWith("BOF") && !l.startsWith("EOF"),
  );
  if (!recordLength) return details;
  return details.map((l) => padRecordLine(l, recordLength));
}

/**
 * 依 index 合併分割檔 → 單一 ACH 大檔（重算尾錄總筆數／總金額）。
 * 可選 exclude：合併後、重算尾錄前剔除符合規則的明細。
 */
export function mergeAchPartitions(
  schema: FormatSchema,
  input: MergeInput,
  txids: Txid[],
  branches: Branch[],
  options?: { exclude?: ExcludeRulesDoc | null },
): {
  content: string;
  filename: string;
  detailCount: number;
  amount: number;
  excludedCount: number;
  totalBeforeExclude: number;
} {
  if (input.index.formatCode !== schema.code) {
    throw new Error(
      `索引格式為 ${input.index.formatCode}，與目前 ${schema.code} 不符`,
    );
  }
  const map = asPartMap(input.parts);
  const ending = endingOf(schema);
  const details: string[] = [];
  let amount = 0;

  const ordered = [...input.index.partitions].sort((a, b) => a.index - b.index);
  for (const entry of ordered) {
    const text = map.get(entry.filename);
    if (text == null) {
      throw new Error(`缺少分割檔：${entry.filename}`);
    }
    const lines = extractDetailLines(text, schema.recordLength);
    if (lines.length !== entry.detailCount) {
      throw new Error(
        `${entry.filename} 明細 ${lines.length} 筆，與索引 ${entry.detailCount} 不符`,
      );
    }
    for (const line of lines) {
      if (line.length !== schema.recordLength) {
        throw new Error(
          `${entry.filename} 列長 ${line.length} ≠ ${schema.recordLength}`,
        );
      }
      amount += amountFromDetailLine(line, schema);
      details.push(line);
    }
  }

  if (details.length !== input.index.totalDetailCount) {
    throw new Error(
      `合併後 ${details.length} 筆，與索引總計 ${input.index.totalDetailCount} 不符`,
    );
  }

  const filtered = filterExcludedDetailLines(
    schema,
    details,
    options?.exclude ?? null,
  );
  const kept = filtered.kept;
  let keptAmount = 0;
  for (const line of kept) {
    keptAmount += amountFromDetailLine(line, schema);
  }

  const header = { ...input.index.header };
  // 一律依目前索引 header 重算首錄，避免沿用分割當下的舊 headerLine
  const headerLine = buildHeaderLine(
    schema,
    header,
    kept.length,
    keptAmount,
    txids,
    branches,
  );
  const trailer = buildTrailerLine(
    schema,
    header,
    kept.length,
    keptAmount,
    txids,
    branches,
  );

  const base =
    input.index.sourceFilename.replace(/\.[^.]+$/, "") || schema.code;
  const filename = `${base}.merged.txt`;
  const content = [headerLine, ...kept, trailer].join(ending) + ending;

  return {
    content,
    filename,
    detailCount: kept.length,
    amount: keptAmount,
    excludedCount: filtered.excludedCount,
    totalBeforeExclude: filtered.totalBefore,
  };
}

/**
 * 大檔 P01→R01：串流分塊轉檔後依退件行合併為輸出檔（可同時產出 partition index）。
 */
export async function convertLargeP01FileToR01(
  file: File,
  p01Schema: FormatSchema,
  r01Schema: FormatSchema,
  txids: Txid[],
  branches: Branch[],
  options: ConvertP01ToR01Options & {
    /** 若提供，一併產出分割索引（以轉檔前 P01 視角） */
    alsoPartitionIndex?: boolean;
    partCount?: number;
    chunkSize?: number;
    onProgress?: (p: PartitionProgress) => void;
    signal?: AbortSignal;
  },
): Promise<{
  files: ConvertedR01File[];
  index: PartitionIndex | null;
  detailCount: number;
  rcode: string;
  ydate: string;
  pdate: string;
}> {
  if (p01Schema.code !== "ACHP01") {
    throw new Error("大檔轉 R01 僅支援 ACHP01 來源");
  }
  if (r01Schema.code !== "ACHR01") {
    throw new Error("轉檔目標須為 ACHR01");
  }

  type BankBuf = {
    detailLines: string[];
    count: number;
    amount: number;
    header: HeaderValues | null;
  };

  const byBank = new Map<string, BankBuf>();
  let headerLine = "";
  let header: HeaderValues = emptyHeader(p01Schema);
  let globalSeq = 0;
  let chunkRows: DetailRow[] = [];
  let chunkStartSeq = 1;
  let totalAmount = 0;
  let meta = { rcode: "", ydate: "", pdate: "" };

  const flushChunk = () => {
    if (chunkRows.length === 0) return;
    const converted = convertP01ToR01(
      r01Schema,
      header,
      chunkRows,
      txids,
      branches,
      {
        rcode: options.rcode,
        ydate: options.ydate,
        pdate: options.pdate,
        seqOffset: chunkStartSeq - 1,
      },
    );
    meta = {
      rcode: converted.rcode,
      ydate: converted.ydate,
      pdate: converted.pdate,
    };
    for (const f of converted.files) {
      let buf = byBank.get(f.returnBank);
      if (!buf) {
        buf = { detailLines: [], count: 0, amount: 0, header: null };
        byBank.set(f.returnBank, buf);
      }
      // lines: header, details..., trailer
      const details = f.lines.slice(1, -1);
      buf.detailLines.push(...details);
      buf.count += f.count;
      buf.amount += f.amount;
      if (!buf.header) {
        buf.header = {
          date: header.date ?? "",
          txid: header.txid ?? "",
          bankCode: f.returnBank,
          account: "",
          taxId: header.taxId ?? "",
          ydate: converted.ydate,
        };
      }
    }
    chunkRows = [];
  };

  await streamFileLines(file, {
    signal: options.signal,
    onProgress: (p) =>
      options.onProgress?.({
        phase: "convert",
        partIndex: 0,
        partCount: 0,
        bytesRead: p.bytesRead,
        totalBytes: file.size,
        linesRead: p.linesRead,
        detailCount: globalSeq,
        matchedCount: globalSeq,
      }),
    onLine: (line) => {
      if (!line.trim()) return;
      if (line.startsWith("BOF")) {
        if (!headerLine) {
          headerLine = line;
          header = headerFromLine(line, p01Schema);
        }
        return;
      }
      if (line.startsWith("EOF")) return;

      const fields = parseRecordFields(line, p01Schema.records.detail.fields);
      if (globalSeq === 0) {
        for (const f of fields) {
          if (f.source === "header" && f.key && !header[f.key]) {
            header[f.key] = f.value;
          }
        }
        // TXTYPE 驗證用
        void lookupTxid(header.txid ?? "", txids);
      }

      if (chunkRows.length === 0) chunkStartSeq = globalSeq + 1;
      globalSeq += 1;
      const row = detailRowFromLine(line, p01Schema);
      // P01 form keys
      for (const def of p01Schema.records.detail.fields) {
        if (def.source === "detail" && def.key) {
          const parsed = fields.find((x) => x.id === def.id);
          if (parsed) row[def.key] = parsed.value;
        }
      }
      totalAmount += Math.floor(Number(row.amount) || 0);
      chunkRows.push(row);

      if (chunkRows.length >= PARTITION_LIMITS.convertChunkSize) {
        flushChunk();
      }
    },
  });

  flushChunk();

  if (globalSeq === 0) throw new Error("沒有明細列可轉檔");
  if (byBank.size === 0 || !meta.rcode) throw new Error("轉檔結果為空");

  const multi = byBank.size > 1;
  const files: ConvertedR01File[] = [];
  const ending = endingOf(r01Schema);

  for (const [returnBank, buf] of byBank) {
    const h: HeaderValues = buf.header ?? {
      date: header.date ?? "",
      txid: header.txid ?? "",
      bankCode: returnBank,
      account: "",
      taxId: header.taxId ?? "",
      ydate: meta.ydate,
    };
    const hdr = buildRecord(r01Schema.records.header.fields, {
      schema: r01Schema,
      header: h,
      seq: 0,
      totalCount: buf.count,
      totalAmount: buf.amount,
      txids,
      branches,
    });
    const trl = buildTrailerLine(
      r01Schema,
      h,
      buf.count,
      buf.amount,
      txids,
      branches,
    );
    // 重新編號 SEQ（退件行序號 1..n）— 明細列內 SEQ 欄位在 offset 6-14
    const renumbered = buf.detailLines.map((line, i) => {
      if (line.length !== r01Schema.recordLength) return line;
      const seq = String(i + 1).padStart(8, "0");
      return line.slice(0, 6) + seq + line.slice(14);
    });
    const lines = [hdr, ...renumbered, trl];
    const content = lines.join(ending) + ending;
    let filename = r01Schema.filenamePattern
      .replace("{code}", r01Schema.code)
      .replace("{date}", h.date ?? "")
      .replace("{txid}", h.txid ?? "")
      .replace("{taxId}", h.taxId ?? "")
      .replace("{shortCode}", r01Schema.shortCode);
    if (multi) filename = filename.replace(/\.txt$/i, `_${returnBank}.txt`);
    files.push({
      content,
      filename,
      count: buf.count,
      amount: buf.amount,
      returnBank,
      lines,
    });
  }

  let index: PartitionIndex | null = null;
  if (options.alsoPartitionIndex) {
    // 僅描述來源規模；分割實體檔由 partitionAchFile 另外產出
    const plan = planPartitions(globalSeq, {
      partCount: options.partCount,
      chunkSize: options.chunkSize,
    });
    index = {
      version: 1,
      kind: PARTITION_INDEX_KIND,
      sourceFilename: file.name,
      formatCode: p01Schema.code,
      recordLength: p01Schema.recordLength,
      lineEnding: endingOf(p01Schema),
      createdAt: new Date().toISOString(),
      header,
      headerLine,
      totalDetailCount: globalSeq,
      totalAmount,
      partCount: plan.partCount,
      chunkSize: plan.chunkSize,
      partitions: [],
    };
  }

  return {
    files,
    index,
    detailCount: globalSeq,
    rcode: meta.rcode,
    ydate: meta.ydate,
    pdate: meta.pdate,
  };
}

/**
 * 將已分割的 P01 part 檔（＋ index）轉成 R01 後合併為大檔。
 * parts 的 filename 須與 index.partitions[].filename 對應。
 */
export function convertMergedP01PartitionsToR01(
  r01Schema: FormatSchema,
  p01Schema: FormatSchema,
  input: MergeInput,
  txids: Txid[],
  branches: Branch[],
  options: ConvertP01ToR01Options,
): {
  files: ConvertedR01File[];
  detailCount: number;
  rcode: string;
  ydate: string;
  pdate: string;
} {
  const map = asPartMap(input.parts);
  const ordered = [...input.index.partitions].sort((a, b) => a.index - b.index);
  const allRows: DetailRow[] = [];
  let header = { ...input.index.header };

  for (const entry of ordered) {
    const text = map.get(entry.filename);
    if (text == null) throw new Error(`缺少分割檔：${entry.filename}`);
    const lines = extractDetailLines(text, p01Schema.recordLength);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const fields = parseRecordFields(line, p01Schema.records.detail.fields);
      if (allRows.length === 0) {
        for (const f of fields) {
          if (f.source === "header" && f.key && !header[f.key]) {
            header[f.key] = f.value;
          }
        }
      }
      const row = detailRowFromLine(line, p01Schema);
      for (const def of p01Schema.records.detail.fields) {
        if (def.source === "detail" && def.key) {
          const parsed = fields.find((x) => x.id === def.id);
          if (parsed) row[def.key] = parsed.value;
        }
      }
      allRows.push(row);
    }
  }

  // 單次轉檔可能爆記憶體；分塊 + 合併
  const byBank = new Map<string, ConvertedR01File>();
  const chunk = PARTITION_LIMITS.convertChunkSize;
  let offset = 0;
  let meta = { rcode: "", ydate: "", pdate: "" };

  while (offset < allRows.length) {
    const slice = allRows.slice(offset, offset + chunk);
    const converted = convertP01ToR01(
      r01Schema,
      header,
      slice,
      txids,
      branches,
      { ...options, seqOffset: offset },
    );
    meta = {
      rcode: converted.rcode,
      ydate: converted.ydate,
      pdate: converted.pdate,
    };
    for (const f of converted.files) {
      const prev = byBank.get(f.returnBank);
      if (!prev) {
        byBank.set(f.returnBank, {
          ...f,
          lines: f.lines.slice(1, -1), // 先只留明細
          content: "",
        });
      } else {
        prev.lines.push(...f.lines.slice(1, -1));
        prev.count += f.count;
        prev.amount += f.amount;
      }
    }
    offset += chunk;
  }

  const ending = endingOf(r01Schema);
  const multi = byBank.size > 1;
  const files: ConvertedR01File[] = [];

  for (const [returnBank, buf] of byBank) {
    const h: HeaderValues = {
      date: header.date ?? "",
      txid: header.txid ?? "",
      bankCode: returnBank,
      account: "",
      taxId: header.taxId ?? "",
      ydate: meta.ydate,
    };
    const hdr = buildRecord(r01Schema.records.header.fields, {
      schema: r01Schema,
      header: h,
      seq: 0,
      totalCount: buf.count,
      totalAmount: buf.amount,
      txids,
      branches,
    });
    const trl = buildTrailerLine(
      r01Schema,
      h,
      buf.count,
      buf.amount,
      txids,
      branches,
    );
    const renumbered = buf.lines.map((line, i) => {
      if (line.length !== r01Schema.recordLength) return line;
      const seq = String(i + 1).padStart(8, "0");
      return line.slice(0, 6) + seq + line.slice(14);
    });
    const lines = [hdr, ...renumbered, trl];
    let filename = r01Schema.filenamePattern
      .replace("{code}", r01Schema.code)
      .replace("{date}", h.date ?? "")
      .replace("{txid}", h.txid ?? "")
      .replace("{taxId}", h.taxId ?? "")
      .replace("{shortCode}", r01Schema.shortCode);
    if (multi) filename = filename.replace(/\.txt$/i, `_${returnBank}.txt`);
    files.push({
      content: lines.join(ending) + ending,
      filename,
      count: buf.count,
      amount: buf.amount,
      returnBank,
      lines,
    });
  }

  return {
    files,
    detailCount: allRows.length,
    rcode: meta.rcode,
    ydate: meta.ydate,
    pdate: meta.pdate,
  };
}
