import type {
  DetailRow,
  FormatSchema,
  HeaderValues,
  RecordFieldDef,
} from "./schema";
import { emptyDetailRow, emptyHeader } from "./engine";
import { newRowId, toHalfWidthAlnum } from "./utils";
import {
  emptyDetailFilters,
  hasActiveFilters,
  rowMatchesFilters,
  type DetailFilters,
} from "./filter";

/** 匯入記憶體／表單上限（超過則僅預覽＋檢核摘要，不載入可編輯表單） */
export const IMPORT_LIMITS = {
  /** 可套用到表單的最大明細筆數 */
  maxFormDetailRows: 5_000,
  /** 未篩選時預覽列數 */
  maxPreviewDetailRows: 50,
  /** 固定長度欄位預覽：明細樣本數 */
  maxDetailLineSamples: 2,
  /** 警告訊息筆數上限 */
  maxWarningSamples: 40,
  /** 進度回報最小間隔 ms */
  progressIntervalMs: 80,
} as const;

export type ImportParseOptions = {
  filename?: string;
  fileSize?: number;
  /** 明細欄位預先篩選（大檔：先篩再載入符合列） */
  filters?: DetailFilters;
  /** 全域關鍵字（任一可篩選欄位） */
  filterGlobal?: string;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
};

export type ParsedRecordField = {
  id: string;
  source: RecordFieldDef["source"];
  key?: string;
  length: number;
  raw: string;
  value: string;
};

export type ParsedLine = {
  index: number;
  kind: "header" | "detail" | "trailer" | "unknown";
  raw: string;
  length: number;
  lengthOk: boolean;
  fields: ParsedRecordField[];
};

export type ImportProgress = {
  bytesRead: number;
  totalBytes: number;
  linesRead: number;
  detailCount: number;
  matchedCount: number;
};

export type ImportResult = {
  detectedCode: string | null;
  schema: FormatSchema;
  filename: string;
  header: HeaderValues;
  /**
   * 可套用到表單的完整明細。檔案過大（tooLargeForForm）時為空陣列。
   * 有預先篩選時為「符合篩選」的全部列（未超上限時）。
   */
  rows: DetailRow[];
  /**
   * 預覽用明細。
   * 未篩選：最多 maxPreviewDetailRows。
   * 已篩選：符合條件的全部列（最多 maxFormDetailRows，供確認後套用）。
   */
  previewRows: DetailRow[];
  /** 固定長度預覽用列（首錄＋少量明細＋尾錄） */
  lines: ParsedLine[];
  trailer: Record<string, string>;
  warnings: string[];
  errors: string[];
  /** 檔案內明細總筆數 */
  detailCount: number;
  /** 符合篩選的筆數（未篩選時等於 detailCount） */
  matchedCount: number;
  lengthErrorCount: number;
  /** 超過可編輯上限，不可套用到表單 */
  tooLargeForForm: boolean;
  /** 是否已套用預先篩選 */
  filterActive: boolean;
  appliedFilters: DetailFilters;
  appliedGlobal: string;
  fileSize: number;
};

function splitLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l, i, arr) => !(l === "" && i === arr.length - 1));
}

/** 從首筆 BOF 列的 CDATA（第 4–9 碼）偵測檔案代號（僅掃前幾列） */
export function detectFormatCode(text: string): string | null {
  const lines = splitLines(text.slice(0, 2048));
  const header = lines.find((l) => l.startsWith("BOF"));
  if (!header || header.length < 9) return null;
  const code = header.slice(3, 9).trim();
  return code || null;
}

export async function detectFormatCodeFromFile(file: File): Promise<string | null> {
  const head = await file.slice(0, 2048).text();
  return detectFormatCode(head);
}

function unpadField(raw: string, def: RecordFieldDef): string {
  // 固定長度常見尾端 null／空白；先清控制字元再依 pad 規則
  let s = String(raw ?? "").replace(/\u0000/g, " ");
  const pad = def.pad ?? { side: "right" as const, char: " " };

  if (def.transform === "firstChar") {
    return s.trim().charAt(0);
  }

  if (pad.side === "right" || (!def.pad && def.source !== "filler")) {
    s = s.replace(/[ \t]+$/g, "");
  }

  if (
    def.transform === "floorInt" ||
    (pad.side === "left" && (pad.char ?? "0") === "0")
  ) {
    const trimmed = s.replace(/^0+/, "");
    if (
      def.transform === "floorInt" ||
      def.fn === "totalCount" ||
      def.fn === "totalAmount" ||
      def.fn === "seq"
    ) {
      return trimmed === "" ? "0" : trimmed;
    }
  }

  if (def.charset === "digit" || def.charset === "alnum") {
    s = s.replace(/[ \t]+$/g, "");
  }

  // 文數字欄位：全形英數字轉半形（不在此過濾，避免匯入預覽丟字）
  if (def.charset === "alnum" || def.charset === "digit") {
    s = toHalfWidthAlnum(s);
  }

  return s;
}

export function parseRecordFields(
  line: string,
  fields: RecordFieldDef[],
): ParsedRecordField[] {
  const out: ParsedRecordField[] = [];
  let offset = 0;
  for (const def of fields) {
    const raw =
      offset >= line.length ? "" : line.slice(offset, offset + def.length);
    offset += def.length;
    out.push({
      id: def.id,
      source: def.source,
      key: def.key,
      length: def.length,
      raw,
      value: unpadField(raw, def),
    });
  }
  return out;
}

function collectKeyedValues(
  fields: ParsedRecordField[],
  source: "header" | "detail",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.source === source && f.key) {
      out[f.key] = f.value;
    }
  }
  return out;
}

function fieldText(f: ParsedRecordField): string {
  const primary = (f.value ?? "").trim();
  if (primary) return primary;
  // value 被 charset 處理成空時，回退原始切片（去尾空白／null）
  return String(f.raw ?? "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+$/g, "")
    .trim();
}

function detailRowFromFields(
  schema: FormatSchema,
  fields: ParsedRecordField[],
): DetailRow {
  const values = collectKeyedValues(fields, "detail");
  const row = emptyDetailRow(schema, newRowId());
  for (const f of schema.form.detail) {
    row[f.key] = values[f.key] ?? "";
  }
  // 以欄位 ID／key 再對一次，避免 source/key 對應疏漏（CNO／USERNO→userNo）
  for (const f of fields) {
    if (f.id === "CNO" || f.id === "USERNO" || f.key === "userNo") {
      const v = fieldText(f);
      if (v) row.userNo = v;
    }
    if (f.id === "SEQ") {
      const v = fieldText(f);
      if (v) row.seq = v;
    }
    if (f.id === "TXTYPE") {
      const v = fieldText(f);
      if (v) row.txType = v;
    }
    if (f.id === "TYPE") {
      const v = fieldText(f);
      if (v) row.type = v;
    }
    if (f.id === "TXID" || f.id === "TIX" || f.key === "txid") {
      const v = fieldText(f);
      if (v) row.txid = v;
    }
  }
  return row;
}

function trailerFromFields(
  fields: ParsedRecordField[],
): Record<string, string> {
  const trailer: Record<string, string> = {};
  for (const f of fields) {
    if (f.source === "derived" && f.id) {
      trailer[f.id] = f.value;
    } else if (f.source === "header" && f.key) {
      trailer[f.key] = f.value;
    } else {
      trailer[f.id] = f.value;
    }
  }
  return trailer;
}

function pushWarning(warnings: string[], msg: string): void {
  if (warnings.length < IMPORT_LIMITS.maxWarningSamples) {
    warnings.push(msg);
  }
}

type ParseAcc = {
  schema: FormatSchema;
  warnings: string[];
  errors: string[];
  headerLine: ParsedLine | null;
  trailerLine: ParsedLine | null;
  detailSamples: ParsedLine[];
  previewRows: DetailRow[];
  rows: DetailRow[];
  detailCount: number;
  matchedCount: number;
  lengthErrorCount: number;
  tooLargeForForm: boolean;
  collectingRows: boolean;
  sawNonEmpty: boolean;
  filterActive: boolean;
  filters: DetailFilters;
  filterGlobal: string;
};

function createAcc(
  schema: FormatSchema,
  opts?: { filters?: DetailFilters; filterGlobal?: string },
): ParseAcc {
  const filters = opts?.filters ?? emptyDetailFilters(schema);
  const filterGlobal = opts?.filterGlobal ?? "";
  const filterActive = hasActiveFilters(filters, { global: filterGlobal });
  return {
    schema,
    warnings: [],
    errors: [],
    headerLine: null,
    trailerLine: null,
    detailSamples: [],
    previewRows: [],
    rows: [],
    detailCount: 0,
    matchedCount: 0,
    lengthErrorCount: 0,
    tooLargeForForm: false,
    collectingRows: true,
    sawNonEmpty: false,
    filterActive,
    filters,
    filterGlobal,
  };
}

function collectMatchedRow(acc: ParseAcc, row: DetailRow): void {
  acc.matchedCount += 1;

  // 篩選模式：預覽列出全部符合列（上限內）；未篩選：僅前 N 筆樣本
  const previewCap = acc.filterActive
    ? IMPORT_LIMITS.maxFormDetailRows
    : IMPORT_LIMITS.maxPreviewDetailRows;
  if (acc.previewRows.length < previewCap) {
    acc.previewRows.push(row);
  }

  if (!acc.collectingRows) return;

  if (acc.matchedCount <= IMPORT_LIMITS.maxFormDetailRows) {
    acc.rows.push(row);
  } else {
    acc.tooLargeForForm = true;
    acc.collectingRows = false;
    acc.rows = [];
  }
}

/**
 * 處理一列原始文字；若為多筆固定長度黏貼（無換行），拆成多列再解析。
 * 回傳實際消耗的列數（供串流列號累加）。
 */
function consumeRawLine(acc: ParseAcc, raw: string, index: number): number {
  const rl = acc.schema.recordLength;
  if (
    raw.length > rl &&
    raw.length % rl === 0 &&
    (raw.startsWith("BOF") ||
      raw.startsWith("N") ||
      raw.startsWith("R") ||
      raw.startsWith("EOF"))
  ) {
    let n = 0;
    for (let i = 0; i < raw.length; i += rl) {
      consumeLine(acc, raw.slice(i, i + rl), index + n);
      n += 1;
    }
    return n;
  }
  consumeLine(acc, raw, index);
  return raw || acc.sawNonEmpty ? 1 : 0;
}

/**
 * 串流／逐行處理一列。
 */
function consumeLine(acc: ParseAcc, raw: string, index: number): void {
  if (!raw && !acc.sawNonEmpty) return;
  if (raw) acc.sawNonEmpty = true;

  let kind: ParsedLine["kind"];
  if (raw.startsWith("BOF")) kind = "header";
  else if (raw.startsWith("EOF")) kind = "trailer";
  else if (raw.trim()) kind = "detail";
  else kind = "unknown";

  if (kind === "unknown") return;

  const lengthOk = raw.length === acc.schema.recordLength;
  if (!lengthOk) {
    acc.lengthErrorCount += 1;
    pushWarning(
      acc.warnings,
      `第 ${index + 1} 列（${kind}）長度 ${raw.length} ≠ 定義 ${acc.schema.recordLength}`,
    );
  }

  const section =
    kind === "header" || kind === "detail" || kind === "trailer"
      ? acc.schema.records[kind].fields
      : null;

  if (kind === "header" || kind === "trailer") {
    let line = raw;
    if (line.length < acc.schema.recordLength) {
      line = line + " ".repeat(acc.schema.recordLength - line.length);
    }
    const fields = section ? parseRecordFields(line, section) : [];
    const sample: ParsedLine = {
      index,
      kind,
      raw,
      length: raw.length,
      lengthOk,
      fields,
    };
    if (kind === "header") acc.headerLine = sample;
    else acc.trailerLine = sample;
    return;
  }

  // detail
  acc.detailCount += 1;

  const needParse =
    acc.filterActive ||
    acc.previewRows.length < IMPORT_LIMITS.maxPreviewDetailRows ||
    (acc.collectingRows &&
      acc.matchedCount < IMPORT_LIMITS.maxFormDetailRows) ||
    acc.detailSamples.length < IMPORT_LIMITS.maxDetailLineSamples;

  if (!needParse) {
    // 未篩選且已超過收集上限：只計數／列長，並丟掉已物化的 rows
    if (
      !acc.filterActive &&
      acc.detailCount > IMPORT_LIMITS.maxFormDetailRows
    ) {
      acc.tooLargeForForm = true;
      acc.collectingRows = false;
      acc.rows = [];
    }
    return;
  }

  // 固定長度以「位元組／字元一對一」切片；尾端不足則右補空白，避免 CNO 等後段欄讀成空
  let line = raw;
  if (line.length < acc.schema.recordLength) {
    line = line + " ".repeat(acc.schema.recordLength - line.length);
  }

  const fields = section ? parseRecordFields(line, section) : [];
  if (acc.detailSamples.length < IMPORT_LIMITS.maxDetailLineSamples) {
    acc.detailSamples.push({
      index,
      kind: "detail",
      raw,
      length: raw.length,
      lengthOk,
      fields,
    });
  }

  const row = detailRowFromFields(acc.schema, fields);

  if (acc.filterActive) {
    if (
      !rowMatchesFilters(row, {
        schema: acc.schema,
        filters: acc.filters,
        options: { global: acc.filterGlobal },
      })
    ) {
      return;
    }
  }

  collectMatchedRow(acc, row);
}

/** 提出資料中應以「明細第一筆」為準的欄位（ACHP01：TXID／PCLNO／CID） */
const HEADER_FROM_FIRST_DETAIL = new Set(["txid", "account", "taxId"]);

function finalizeHeader(acc: ParseAcc): HeaderValues {
  const header: HeaderValues = emptyHeader(acc.schema);
  if (acc.headerLine) {
    Object.assign(header, collectKeyedValues(acc.headerLine.fields, "header"));
  }
  if (acc.detailSamples[0]) {
    const fromDetailHeader = collectKeyedValues(
      acc.detailSamples[0].fields,
      "header",
    );
    const fromDetailBody = collectKeyedValues(
      acc.detailSamples[0].fields,
      "detail",
    );
    // 交易代號已改為 detail.source；其餘提出欄仍為 header.source
    const fromDetail = {
      ...fromDetailHeader,
      ...(fromDetailBody.txid ? { txid: fromDetailBody.txid } : {}),
    };
    for (const [k, v] of Object.entries(fromDetail)) {
      if (!v) continue;
      // 交易代號等：分割／匯入後一律以明細第一筆為主
      if (HEADER_FROM_FIRST_DETAIL.has(k) || !header[k]) {
        header[k] = v;
      }
    }
  }

  const headerKeys = new Set(acc.schema.form.header.map((f) => f.key));
  for (const k of Object.keys(header)) {
    if (!headerKeys.has(k)) delete header[k];
  }
  for (const f of acc.schema.form.header) {
    if (header[f.key] === undefined) header[f.key] = "";
  }
  return header;
}

function buildResult(
  acc: ParseAcc,
  opts: { filename: string; detectedCode: string | null; fileSize: number },
): ImportResult {
  if (!acc.headerLine) {
    acc.errors.push("找不到表頭列（BOF）");
  }
  if (!acc.trailerLine) {
    pushWarning(acc.warnings, "找不到尾筆列（EOF）");
  }
  if (!acc.detailCount) {
    pushWarning(acc.warnings, "沒有明細列");
  }

  const matchedCount = acc.filterActive ? acc.matchedCount : acc.detailCount;

  if (acc.tooLargeForForm) {
    if (acc.filterActive) {
      pushWarning(
        acc.warnings,
        `符合篩選 ${matchedCount.toLocaleString("zh-TW")} 筆，仍超過可載入上限 ${IMPORT_LIMITS.maxFormDetailRows.toLocaleString("zh-TW")} 筆；請再縮小表頭篩選條件`,
      );
    }
    // 未篩選之大檔：不在警告區重複提示，改由明細表頭篩選操作
  } else if (acc.filterActive) {
    pushWarning(
      acc.warnings,
      `已套用篩選：符合 ${matchedCount.toLocaleString("zh-TW")}／總計 ${acc.detailCount.toLocaleString("zh-TW")} 筆，可套用到表單`,
    );
  }

  if (acc.lengthErrorCount > IMPORT_LIMITS.maxWarningSamples) {
    pushWarning(
      acc.warnings,
      `另有列長不符共 ${acc.lengthErrorCount.toLocaleString("zh-TW")} 筆（僅顯示前 ${IMPORT_LIMITS.maxWarningSamples} 則）`,
    );
  }

  const lines: ParsedLine[] = [];
  if (acc.headerLine) lines.push(acc.headerLine);
  lines.push(...acc.detailSamples);
  if (acc.trailerLine) lines.push(acc.trailerLine);

  const trailer = acc.trailerLine
    ? trailerFromFields(acc.trailerLine.fields)
    : {};

  return {
    detectedCode: opts.detectedCode,
    schema: acc.schema,
    filename: opts.filename,
    header: finalizeHeader(acc),
    rows: acc.tooLargeForForm ? [] : acc.rows,
    previewRows: acc.previewRows,
    lines,
    trailer,
    warnings: acc.warnings,
    errors: acc.errors,
    detailCount: acc.detailCount,
    matchedCount,
    lengthErrorCount: acc.lengthErrorCount,
    tooLargeForForm: acc.tooLargeForForm,
    filterActive: acc.filterActive,
    appliedFilters: { ...acc.filters },
    appliedGlobal: acc.filterGlobal,
    fileSize: opts.fileSize,
  };
}

/**
 * 小字串同步解析（測試／貼上）。大檔請用 parseAchFile 串流，避免 OOM。
 */
export function parseAchText(
  text: string,
  schema: FormatSchema,
  opts?: ImportParseOptions,
): ImportResult {
  const filename = opts?.filename ?? "";
  const fileSize = opts?.fileSize ?? text.length;
  const detectedCode = detectFormatCode(text);
  const acc = createAcc(schema, {
    filters: opts?.filters,
    filterGlobal: opts?.filterGlobal,
  });

  if (detectedCode && detectedCode !== schema.code) {
    pushWarning(
      acc.warnings,
      `檔案代號為 ${detectedCode}，目前以 ${schema.code} 格式解析`,
    );
  } else if (!detectedCode) {
    pushWarning(acc.warnings, "無法從 BOF 列辨識檔案代號（CDATA）");
  }

  const rawLines = splitLines(text);
  if (!rawLines.length) {
    acc.errors.push("檔案沒有內容");
    return buildResult(acc, { filename, detectedCode, fileSize });
  }

  let lineIndex = 0;
  for (const raw of rawLines) {
    lineIndex += consumeRawLine(acc, raw ?? "", lineIndex);
  }

  return buildResult(acc, { filename, detectedCode, fileSize });
}

/**
 * 串流解析 File，避免 file.text() 將整檔載入記憶體造成 OOM。
 * 可帶 filters／filterGlobal：大檔先篩選再收集符合列。
 */
export async function parseAchFile(
  file: File,
  schema: FormatSchema,
  opts?: ImportParseOptions,
): Promise<ImportResult> {
  const filename = opts?.filename ?? file.name;
  const detectedCode = await detectFormatCodeFromFile(file);
  const acc = createAcc(schema, {
    filters: opts?.filters,
    filterGlobal: opts?.filterGlobal,
  });

  if (detectedCode && detectedCode !== schema.code) {
    pushWarning(
      acc.warnings,
      `檔案代號為 ${detectedCode}，目前以 ${schema.code} 格式解析`,
    );
  } else if (!detectedCode) {
    pushWarning(acc.warnings, "無法從 BOF 列辨識檔案代號（CDATA）");
  }

  const reader = file.stream().getReader();
  // ACH 固定長度以 byte 定位；用 latin1 讓 1 byte = 1 JS char，避免 UTF-8 多位元組位移
  const decoder = new TextDecoder("latin1");
  let buf = "";
  let bytesRead = 0;
  let lineIndex = 0;
  let lastProgressAt = 0;

  const report = (force = false) => {
    const now = Date.now();
    if (
      !force &&
      now - lastProgressAt < IMPORT_LIMITS.progressIntervalMs
    ) {
      return;
    }
    lastProgressAt = now;
    opts?.onProgress?.({
      bytesRead,
      totalBytes: file.size,
      linesRead: lineIndex,
      detailCount: acc.detailCount,
      matchedCount: acc.filterActive ? acc.matchedCount : acc.detailCount,
    });
  };

  /** 取出下一完整列（支援 \n、\r\n、僅 \r） */
  const takeLine = (): string | null => {
    const nl = buf.indexOf("\n");
    const cr = buf.indexOf("\r");
    if (nl < 0 && cr < 0) return null;

    // 有 \n：以 \n 為界（若前一字為 \r 一併去掉）
    if (nl >= 0 && (cr < 0 || nl <= cr)) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      return line;
    }

    // 僅見 \r：若是緩衝最後一字，可能是未讀完的 \r\n，先等下一 chunk
    if (cr === buf.length - 1) return null;
    let skip = 1;
    if (buf[cr + 1] === "\n") skip = 2;
    const line = buf.slice(0, cr);
    buf = buf.slice(cr + skip);
    return line;
  };

  const emitLine = async (line: string) => {
    if (lineIndex === 0 && line.charCodeAt(0) === 0xfeff) {
      line = line.slice(1);
    }
    const prev = lineIndex;
    const consumed = consumeRawLine(acc, line, lineIndex);
    if (consumed > 0) lineIndex += consumed;
    if (Math.floor(lineIndex / 2000) > Math.floor(prev / 2000)) {
      report();
      // 讓出主執行緒，避免長檔解析時頁面完全卡死
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  };

  try {
    while (true) {
      if (opts?.signal?.aborted) {
        acc.errors.push("匯入已取消");
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      buf += decoder.decode(value, { stream: true });

      let line: string | null;
      while ((line = takeLine()) !== null) {
        await emitLine(line);
      }
      report();
    }

    buf += decoder.decode();
    if (buf.length) {
      let rest = buf;
      if (rest.endsWith("\r")) rest = rest.slice(0, -1);
      buf = "";
      await emitLine(rest);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }

  if (!lineIndex) {
    acc.errors.push("檔案沒有內容");
  }

  report(true);
  return buildResult(acc, {
    filename,
    detectedCode,
    fileSize: file.size,
  });
}

/** 在多個格式中選出最適合解析的 schema（優先 CDATA 代號，其次列長） */
export function resolveImportSchema(
  text: string,
  formats: Record<string, FormatSchema>,
  preferred?: FormatSchema,
): FormatSchema | null {
  const code = detectFormatCode(text);
  if (code && formats[code]) return formats[code];

  const lines = splitLines(text.slice(0, 4096));
  const sample = lines.find((l) => l.startsWith("BOF")) ?? lines[0] ?? "";
  const byLength = Object.values(formats).find(
    (s) => s.recordLength === sample.length,
  );
  if (byLength) return byLength;

  return preferred ?? Object.values(formats)[0] ?? null;
}

export async function resolveImportSchemaFromFile(
  file: File,
  formats: Record<string, FormatSchema>,
  preferred?: FormatSchema,
): Promise<FormatSchema | null> {
  const head = await file.slice(0, 4096).text();
  return resolveImportSchema(head, formats, preferred);
}
