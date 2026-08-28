/**
 * 大檔分割／索引／合併
 *
 * 流程：
 * 1. 將共 x 筆明細的 ACH 檔 partition 成 y 個小檔（各含 BOF＋明細＋EOF）
 * 2. 產出 index JSON（dictionary）：記錄來源、各 part 檔名、序號區間、筆數／金額
 * 3. 分批改檔（例如 P01→R01）後，依 index 合併回單一輸出大檔
 */

import {
  ACHR01_SORG,
  convertP01ToR01,
  convertR01ToP01,
  requireAgentBank,
  type ConvertP01ToR01Options,
  type ConvertR01ToP01Options,
  type ConvertedP01File,
  type ConvertedR01File,
} from "./convertR01";
import {
  amountFromDetailRecord,
  amountFromDetailRow,
  buildRecord,
  emptyHeader,
  isRowEmpty,
  lookupTxid,
  resolveR01Ydate,
  validateBuiltControlDates,
} from "./engine";
import {
  IMPORT_LIMITS,
  attachP01PresenterFromFields,
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
  /** 目前工作區控制首錄（存回編輯後可能更新） */
  headerLine: string;
  /**
   * 來源檔原始控制首錄（篩選／排除／合併輸出優先使用，不受表單編輯覆寫）
   */
  sourceHeaderLine?: string;
  /**
   * 來源檔原始控制尾錄（輸出時保留非合計欄；TCOUNT／TAMT 依實際輸出明細重算）
   */
  sourceTrailerLine?: string;
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

/** 計算固定長度欄位在列上的起訖位置 */
export function recordFieldSpans(
  fields: RecordFieldDef[],
): { id: string; start: number; length: number }[] {
  const spans: { id: string; start: number; length: number }[] = [];
  let offset = 0;
  for (const f of fields) {
    spans.push({ id: f.id, start: offset, length: f.length });
    offset += f.length;
  }
  return spans;
}

/** 覆寫列上指定欄位（依欄位 id；值不足則右／左填空白以符合長度） */
export function patchRecordFieldById(
  line: string,
  fields: RecordFieldDef[],
  fieldId: string,
  value: string,
): string {
  const spans = recordFieldSpans(fields);
  const span = spans.find((s) => s.id === fieldId);
  if (!span || line.length < span.start + span.length) return line;
  const piece = String(value ?? "");
  const padded =
    piece.length >= span.length
      ? piece.slice(0, span.length)
      : piece.padEnd(span.length, " ");
  return (
    line.slice(0, span.start) + padded + line.slice(span.start + span.length)
  );
}

/** 從來源列讀取欄位值（依來源欄位定義），寫入目標列（依目標欄位定義） */
export function copyRecordFieldValues(
  target: string,
  targetFields: RecordFieldDef[],
  source: string | null | undefined,
  sourceFields: RecordFieldDef[],
  fieldIds: string[],
): string {
  if (!source) return target;
  let out = target;
  const srcSpans = recordFieldSpans(sourceFields);
  const dstSpans = recordFieldSpans(targetFields);
  for (const id of fieldIds) {
    const src = srcSpans.find((s) => s.id === id);
    const dst = dstSpans.find((s) => s.id === id);
    if (!src || !dst || source.length < src.start + src.length) continue;
    if (out.length < dst.start + dst.length) continue;
    let piece = source.slice(src.start, src.start + src.length);
    if (piece.length >= dst.length) piece = piece.slice(0, dst.length);
    else piece = piece.padEnd(dst.length, " ");
    out = out.slice(0, dst.start) + piece + out.slice(dst.start + dst.length);
  }
  return out;
}

/**
 * 組出輸出用控制首／尾錄：
 * - 首錄以來源 BOF 為底，可覆寫 TDATE（處理日期）
 * - ACHP01：SORG／RORG **只**從來源 BOF／EOF 位元組複製，绝不依明細／表單 bankCode 重算
 * - ACHR01：SORG 固定 9990250；RORG＝代表行代號（agentBank）
 */
export function buildExportControlLines(
  schema: FormatSchema,
  opts: {
    sourceHeaderLine?: string | null;
    sourceTrailerLine?: string | null;
    header: HeaderValues;
    processDate?: string | null;
    /** ACHR01 接收單位（代表行）；未傳則用 header.agentBank */
    agentBank?: string | null;
    detailCount: number;
    totalAmount: number;
    txids: Txid[];
    branches: Branch[];
  },
): { headerLine: string; trailerLine: string } {
  const date = safeDigits(opts.processDate ?? opts.header.date ?? "").slice(
    0,
    8,
  );
  const isR01 = schema.code === "ACHR01";
  const agentBankRaw = opts.agentBank ?? opts.header.agentBank ?? "";
  const agentBank = isR01
    ? requireAgentBank(agentBankRaw, opts.branches)
    : "";
  // 組尾錄合計時不要用可能被明細覆寫的 bankCode 去推 SORG；
  // ACHP01：實際 SORG／RORG 稍後從來源列貼上；ACHR01：用固定 SORG＋代表行。
  const ydate = isR01
    ? resolveR01Ydate(opts.header.ydate, date || opts.header.date)
    : "";
  const headerValues: HeaderValues = {
    ...opts.header,
    ...(date.length === 8 ? { date } : {}),
    ...(isR01 ? { agentBank, ydate } : {}),
  };

  const srcH =
    !isR01 &&
    opts.sourceHeaderLine &&
    opts.sourceHeaderLine.startsWith("BOF") &&
    opts.sourceHeaderLine.length === schema.recordLength
      ? opts.sourceHeaderLine
      : null;
  const srcT =
    !isR01 &&
    opts.sourceTrailerLine &&
    opts.sourceTrailerLine.startsWith("EOF") &&
    opts.sourceTrailerLine.length === schema.recordLength
      ? opts.sourceTrailerLine
      : null;

  let headerLine =
    srcH ??
    buildHeaderLine(
      schema,
      headerValues,
      opts.detailCount,
      opts.totalAmount,
      opts.txids,
      opts.branches,
    );
  if (date.length === 8) {
    headerLine = patchRecordFieldById(
      headerLine,
      schema.records.header.fields,
      "TDATE",
      date.padStart(8, "0").slice(-8),
    );
  }
  if (isR01) {
    headerLine = patchRecordFieldById(
      headerLine,
      schema.records.header.fields,
      "SORG",
      ACHR01_SORG,
    );
    headerLine = patchRecordFieldById(
      headerLine,
      schema.records.header.fields,
      "RORG",
      agentBank,
    );
  } else if (srcH) {
    // ACHP01：發送／接收單位代號優先來源 BOF，其次來源 EOF
    headerLine = copyRecordFieldValues(
      headerLine,
      schema.records.header.fields,
      srcH,
      schema.records.header.fields,
      ["SORG", "RORG"],
    );
  } else if (srcT) {
    headerLine = copyRecordFieldValues(
      headerLine,
      schema.records.header.fields,
      srcT,
      schema.records.trailer.fields,
      ["SORG", "RORG"],
    );
  }

  let trailerLine = buildTrailerLine(
    schema,
    headerValues,
    opts.detailCount,
    opts.totalAmount,
    opts.txids,
    opts.branches,
  );
  if (isR01) {
    trailerLine = patchRecordFieldById(
      trailerLine,
      schema.records.trailer.fields,
      "SORG",
      ACHR01_SORG,
    );
    trailerLine = patchRecordFieldById(
      trailerLine,
      schema.records.trailer.fields,
      "RORG",
      agentBank,
    );
  } else if (srcT) {
    // 尾錄 SORG／RORG：優先來源 EOF，否則來源 BOF
    trailerLine = copyRecordFieldValues(
      trailerLine,
      schema.records.trailer.fields,
      srcT,
      schema.records.trailer.fields,
      ["SORG", "RORG"],
    );
  } else if (srcH) {
    trailerLine = copyRecordFieldValues(
      trailerLine,
      schema.records.trailer.fields,
      srcH,
      schema.records.header.fields,
      ["SORG", "RORG"],
    );
  }
  if (date.length === 8) {
    trailerLine = patchRecordFieldById(
      trailerLine,
      schema.records.trailer.fields,
      "TDATE",
      date.padStart(8, "0").slice(-8),
    );
  }
  if (isR01 && ydate.length === 8) {
    trailerLine = patchRecordFieldById(
      trailerLine,
      schema.records.trailer.fields,
      "YDATE",
      ydate,
    );
  }

  return { headerLine, trailerLine };
}

function endingOf(schema: FormatSchema): string {
  return schema.lineEnding || "\r\n";
}

function amountFromDetailLine(line: string, schema: FormatSchema): number {
  return amountFromDetailRecord(line, schema);
}

export function headerFromLine(line: string, schema: FormatSchema): HeaderValues {
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
  // SORG 對應 bankCode：若 header 無 bankCode，嘗試從 SORG 欄（略過財金 9990250）
  if (!header.bankCode) {
    const sorg = fields.find((f) => f.id === "SORG");
    const sorgDigits = safeDigits(sorg?.value ?? "");
    if (sorgDigits.length === 7 && sorgDigits !== ACHR01_SORG) {
      header.bankCode = sorgDigits;
    }
  }
  if (!header.date) {
    const tdate = fields.find((f) => f.id === "TDATE");
    if (tdate?.value) header.date = safeDigits(tdate.value);
  }
  return header;
}

/** 自 EOF 補入僅存在於尾錄的 header 欄（如 ACHR01 YDATE） */
export function mergeHeaderFromTrailerLine(
  header: HeaderValues,
  trailerLine: string | null | undefined,
  schema: FormatSchema,
): HeaderValues {
  if (!trailerLine || !trailerLine.startsWith("EOF")) return header;
  const line = padRecordLine(trailerLine, schema.recordLength);
  if (line.length !== schema.recordLength) return header;
  const fields = parseRecordFields(line, schema.records.trailer.fields);
  const next = { ...header };
  for (const f of fields) {
    if (f.source !== "header" || !f.key) continue;
    const v = String(f.value ?? "").trim();
    if (!v) continue;
    if (!String(next[f.key] ?? "").trim()) next[f.key] = f.value;
  }
  return next;
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
      // P01：提出行已改為 detail.orig*；此處僅保留舊 header.source 後備
    }
  }
  // ACHP01 detail 表單欄位對應 records.detail 的 detail-source
  for (const def of schema.records.detail.fields) {
    if (def.source === "detail" && def.key) {
      const parsed = fields.find((x) => x.id === def.id);
      if (parsed) row[def.key] = parsed.value;
    }
  }
  if (schema.code === "ACHP01") {
    attachP01PresenterFromFields(row, fields);
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
    // TYPE：保留原列 N／R，不套 schema literal（否則存回分割包會把 N 誤寫成 R，
    // 導致整檔轉換時該包被當成 R 反向轉回 N）。
    if (
      def.source === "filler" ||
      def.source === "runtime" ||
      def.id === "TYPE"
    ) {
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
      totalAmount += amountFromDetailRow(r, amountKey);
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

  totalAmount = 0;
  for (const line of details) {
    totalAmount += amountFromDetailRecord(line, schema);
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
  trailerLine: string;
  header: HeaderValues;
  detailCount: number;
  totalAmount: number;
}> {
  let headerLine = "";
  let trailerLine = "";
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
      if (line.startsWith("EOF")) {
        trailerLine = line;
        header = mergeHeaderFromTrailerLine(header, line, schema);
        return;
      }
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

  return { headerLine, trailerLine, header, detailCount, totalAmount };
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
    sourceHeaderLine: counted.headerLine,
    sourceTrailerLine: counted.trailerLine || undefined,
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
 * 可選 exclude：合併後、重算尾錄前依 action 篩選或剔除符合規則的明細。
 */
export function mergeAchPartitions(
  schema: FormatSchema,
  input: MergeInput,
  txids: Txid[],
  branches: Branch[],
  options?: {
    exclude?: ExcludeRulesDoc | null;
    /** 輸出處理日期（覆寫首／尾錄 TDATE） */
    processDate?: string | null;
    /** ACHR01 代表行代號（RORG） */
    agentBank?: string | null;
  },
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

  // 僅使用不可被表單編輯覆寫的來源 BOF／EOF（勿回退到 index.headerLine，
  // 存回後 headerLine 可能已依明細 bankCode 重算 SORG）
  const sourceHeaderLine =
    input.index.sourceHeaderLine?.startsWith("BOF") &&
    input.index.sourceHeaderLine.length === schema.recordLength
      ? input.index.sourceHeaderLine
      : null;
  const sourceTrailerLine =
    input.index.sourceTrailerLine?.startsWith("EOF") &&
    input.index.sourceTrailerLine.length === schema.recordLength
      ? input.index.sourceTrailerLine
      : null;

  const headerFromSource = sourceHeaderLine
    ? headerFromLine(sourceHeaderLine, schema)
    : { ...input.index.header };
  // 合計／日期用；ACHP01 SORG／RORG 由 buildExportControlLines 從來源列貼上
  const header: HeaderValues = {
    ...headerFromSource,
    ...(options?.processDate
      ? { date: safeDigits(options.processDate).slice(0, 8) }
      : {}),
    ...(options?.agentBank
      ? { agentBank: safeDigits(options.agentBank).slice(0, 7) }
      : {}),
  };

  const { headerLine, trailerLine: trailer } = buildExportControlLines(schema, {
    sourceHeaderLine,
    sourceTrailerLine,
    header,
    processDate: options?.processDate,
    agentBank: options?.agentBank,
    detailCount: kept.length,
    totalAmount: keptAmount,
    txids,
    branches,
  });
  const builtDateErrs = validateBuiltControlDates(
    schema,
    headerLine,
    trailer,
  );
  if (builtDateErrs.length) {
    throw new Error(builtDateErrs[0] ?? "BOF／EOF 處理日期有誤");
  }

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
 * 大檔 P01→R01：串流分塊轉檔後合併為單一輸出檔（不依收受行分檔；可同時產出 partition index）。
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

  const detailLines: string[] = [];
  let headerLine = "";
  let header: HeaderValues = emptyHeader(p01Schema);
  let outHeader: HeaderValues | null = null;
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
        agentBank: options.agentBank,
        seqOffset: chunkStartSeq - 1,
      },
    );
    meta = {
      rcode: converted.rcode,
      ydate: converted.ydate,
      pdate: converted.pdate,
    };
    const f = converted.files[0];
    if (!f) return;
    // lines: header, details..., trailer
    for (const dl of f.lines.slice(1, -1)) detailLines.push(dl);
    if (!outHeader) {
      outHeader = {
        date: header.date ?? "",
        txid: header.txid ?? "",
        bankCode: f.returnBank,
        agentBank: requireAgentBank(options.agentBank, branches),
        account: "",
        taxId: header.taxId ?? "",
        ydate: converted.ydate,
      };
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
        void lookupTxid(header.txid ?? "", txids);
      }

      if (chunkRows.length === 0) chunkStartSeq = globalSeq + 1;
      globalSeq += 1;
      const row = detailRowFromLine(line, p01Schema);
      for (const def of p01Schema.records.detail.fields) {
        if (def.source === "detail" && def.key) {
          const parsed = fields.find((x) => x.id === def.id);
          if (parsed) row[def.key] = parsed.value;
        }
      }
      totalAmount += amountFromDetailRow(row, "amount");
      chunkRows.push(row);

      if (chunkRows.length >= PARTITION_LIMITS.convertChunkSize) {
        flushChunk();
      }
    },
  });

  flushChunk();

  if (globalSeq === 0) throw new Error("沒有明細列可轉檔");
  if (detailLines.length === 0 || !meta.rcode || outHeader == null) {
    throw new Error("轉檔結果為空");
  }

  const ending = endingOf(r01Schema);
  const h: HeaderValues = outHeader;
  const hdr = buildRecord(r01Schema.records.header.fields, {
    schema: r01Schema,
    header: h,
    seq: 0,
    totalCount: globalSeq,
    totalAmount,
    txids,
    branches,
  });
  const trl = buildTrailerLine(
    r01Schema,
    h,
    globalSeq,
    totalAmount,
    txids,
    branches,
  );
  // 整檔序號 1..n（分塊轉檔時 PSEQ 已用 seqOffset；此處重編 SEQ 欄）
  const renumbered = detailLines.map((line, i) => {
    if (line.length !== r01Schema.recordLength) return line;
    const seq = String(i + 1).padStart(8, "0");
    return line.slice(0, 6) + seq + line.slice(14);
  });
  const lines = [hdr, ...renumbered, trl];
  const content = lines.join(ending) + ending;
  const filename = r01Schema.filenamePattern
    .replace("{code}", r01Schema.code)
    .replace("{date}", h.date ?? "")
    .replace("{txid}", h.txid ?? "")
    .replace("{taxId}", h.taxId ?? "")
    .replace("{shortCode}", r01Schema.shortCode);

  const files: ConvertedR01File[] = [
    {
      content,
      filename,
      count: globalSeq,
      amount: totalAmount,
      returnBank: h.bankCode ?? "",
      lines,
    },
  ];

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
      sourceHeaderLine: headerLine,
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
 * 大檔 R01→P01：串流分塊轉檔後合併為單一輸出檔（不依收受行分檔）。
 */
export async function convertLargeR01FileToP01(
  file: File,
  r01Schema: FormatSchema,
  p01Schema: FormatSchema,
  txids: Txid[],
  branches: Branch[],
  options: ConvertR01ToP01Options & {
    onProgress?: (p: PartitionProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{
  files: ConvertedP01File[];
  detailCount: number;
}> {
  if (r01Schema.code !== "ACHR01") {
    throw new Error("大檔轉 P01 僅支援 ACHR01 來源");
  }
  if (p01Schema.code !== "ACHP01") {
    throw new Error("轉檔目標須為 ACHP01");
  }

  const detailLines: string[] = [];
  let headerLine = "";
  let header: HeaderValues = emptyHeader(r01Schema);
  let outHeader: HeaderValues | null = null;
  let globalSeq = 0;
  let chunkRows: DetailRow[] = [];
  let totalAmount = 0;
  let presenterBank = "";

  const flushChunk = () => {
    if (chunkRows.length === 0) return;
    const converted = convertR01ToP01(
      p01Schema,
      header,
      chunkRows,
      txids,
      branches,
      { date: options.date },
    );
    const f = converted.files[0];
    if (!f) return;
    for (const dl of f.lines.slice(1, -1)) detailLines.push(dl);
    if (!outHeader) {
      presenterBank = f.presenterBank;
      outHeader = {
        date: options.date?.trim()
          ? requireRocDateLocal(options.date)
          : (header.date ?? ""),
        txid: header.txid ?? "",
        bankCode: f.presenterBank,
        account: "",
        taxId: header.taxId ?? "",
      };
      // 從首塊明細補提出帳號
      const firstDetail = f.lines[1];
      if (firstDetail && firstDetail.length === p01Schema.recordLength) {
        // PCLNO at 21..37 (TYPE1+TXTYPE2+TXID3+SEQ8+PBANK7 = 21)
        outHeader.account = firstDetail.slice(21, 37);
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
          header = headerFromLine(line, r01Schema);
        }
        return;
      }
      if (line.startsWith("EOF")) {
        header = mergeHeaderFromTrailerLine(header, line, r01Schema);
        return;
      }

      const fields = parseRecordFields(line, r01Schema.records.detail.fields);
      if (globalSeq === 0) {
        for (const f of fields) {
          if (f.source === "header" && f.key && !header[f.key]) {
            header[f.key] = f.value;
          }
          if (f.id === "TXID" || f.key === "txid") {
            const v = String(f.value ?? "").trim();
            if (v && !header.txid) header.txid = v;
          }
        }
        void lookupTxid(header.txid ?? "", txids);
      }

      globalSeq += 1;
      const row = detailRowFromLine(line, r01Schema);
      for (const def of r01Schema.records.detail.fields) {
        if (def.source === "detail" && def.key) {
          const parsed = fields.find((x) => x.id === def.id);
          if (parsed) row[def.key] = parsed.value;
        }
      }
      totalAmount += amountFromDetailRow(row, "amount");
      chunkRows.push(row);

      if (chunkRows.length >= PARTITION_LIMITS.convertChunkSize) {
        flushChunk();
      }
    },
  });

  flushChunk();

  if (globalSeq === 0) throw new Error("沒有明細列可轉檔");
  if (detailLines.length === 0 || outHeader == null) {
    throw new Error("轉檔結果為空");
  }

  const ending = endingOf(p01Schema);
  // 巢狀 flushChunk 賦值使 CFA 可能將 outHeader 收斂為 never；此處顯式斷言
  const baseHeader: HeaderValues = outHeader as HeaderValues;
  const h: HeaderValues = options.date?.trim()
    ? { ...baseHeader, date: requireRocDateLocal(options.date) }
    : baseHeader;
  const hdr = buildRecord(p01Schema.records.header.fields, {
    schema: p01Schema,
    header: h,
    seq: 0,
    totalCount: globalSeq,
    totalAmount,
    txids,
    branches,
  });
  const trl = buildTrailerLine(
    p01Schema,
    h,
    globalSeq,
    totalAmount,
    txids,
    branches,
  );
  const renumbered = detailLines.map((line, i) => {
    if (line.length !== p01Schema.recordLength) return line;
    const seq = String(i + 1).padStart(8, "0");
    return line.slice(0, 6) + seq + line.slice(14);
  });
  const lines = [hdr, ...renumbered, trl];
  const content = lines.join(ending) + ending;
  const filename = p01Schema.filenamePattern
    .replace("{code}", p01Schema.code)
    .replace("{date}", h.date ?? "")
    .replace("{txid}", h.txid ?? "")
    .replace("{taxId}", h.taxId ?? "")
    .replace("{shortCode}", p01Schema.shortCode);

  return {
    files: [
      {
        content,
        filename,
        count: globalSeq,
        amount: totalAmount,
        presenterBank,
        lines,
      },
    ],
    detailCount: globalSeq,
  };
}

/** 僅供大檔轉檔內部覆寫日期用（與 convertR01.requireRoc8 同規則） */
function requireRocDateLocal(value: string): string {
  const d = safeDigits(value);
  if (d.length !== 8) {
    throw new Error(`處理日期（TDATE）須為 8 碼民國年月日（目前 ${d.length || 0} 碼）`);
  }
  return d;
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

  // 單次轉檔可能爆記憶體；分塊後合併為單一檔（不依收受行分檔）
  const detailLines: string[] = [];
  const chunk = PARTITION_LIMITS.convertChunkSize;
  let offset = 0;
  let meta = { rcode: "", ydate: "", pdate: "" };
  let returnBank = "";
  let totalAmount = 0;

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
    const f = converted.files[0];
    if (f) {
      if (!returnBank) returnBank = f.returnBank;
      for (const dl of f.lines.slice(1, -1)) detailLines.push(dl);
      totalAmount += f.amount;
    }
    offset += chunk;
  }

  if (detailLines.length === 0 || !meta.rcode) {
    throw new Error("轉檔結果為空");
  }

  const ending = endingOf(r01Schema);
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
    totalCount: allRows.length,
    totalAmount,
    txids,
    branches,
  });
  const trl = buildTrailerLine(
    r01Schema,
    h,
    allRows.length,
    totalAmount,
    txids,
    branches,
  );
  const renumbered = detailLines.map((line, i) => {
    if (line.length !== r01Schema.recordLength) return line;
    const seq = String(i + 1).padStart(8, "0");
    return line.slice(0, 6) + seq + line.slice(14);
  });
  const lines = [hdr, ...renumbered, trl];
  const filename = r01Schema.filenamePattern
    .replace("{code}", r01Schema.code)
    .replace("{date}", h.date ?? "")
    .replace("{txid}", h.txid ?? "")
    .replace("{taxId}", h.taxId ?? "")
    .replace("{shortCode}", r01Schema.shortCode);

  return {
    files: [
      {
        content: lines.join(ending) + ending,
        filename,
        count: allRows.length,
        amount: totalAmount,
        returnBank,
        lines,
      },
    ],
    detailCount: allRows.length,
    rcode: meta.rcode,
    ydate: meta.ydate,
    pdate: meta.pdate,
  };
}
