import type {
  DetailRow,
  FormatSchema,
  HeaderValues,
  RecordFieldDef,
} from "./schema";
import { emptyDetailRow, emptyHeader } from "./engine";
import { digitRangeOf } from "./field";
import { newRowId, safeDigits, toHalfWidthAlnum } from "./utils";
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
  /** 檔案原始格式（P01 匯入後 schema 會改為 R01 供編輯） */
  sourceFormatCode?: string;
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
  /**
   * ACHR01：所有明細提回行／退件行代號（PBANK）相同時為該 7 碼；
   * 不一致、缺碼或非 R01 為 null。大檔略過欄位解析時仍會掃描。
   */
  uniformReturnBank: string | null;
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
  return detectFormatCodesFromText(text).bofCode;
}

export type DetectedFormatCodes = {
  bofCode: string | null;
  eofCode: string | null;
  /** 優先 BOF，其次 EOF */
  code: string | null;
};

function cdataFromControlLine(line: string | undefined): string | null {
  if (!line || line.length < 9) return null;
  if (!(line.startsWith("BOF") || line.startsWith("EOF"))) return null;
  const code = line.slice(3, 9).trim();
  return code || null;
}

/** 自文字掃描 BOF／EOF 的 CDATA（檔案代號） */
export function detectFormatCodesFromText(text: string): DetectedFormatCodes {
  const head = splitLines(text.slice(0, 4096));
  const bof = head.find((l) => l.startsWith("BOF"));
  const bofCode = cdataFromControlLine(bof);

  // 尾端亦掃 EOF（大檔呼叫端應傳入 head+tail 拼接或全文）
  const tailSlice =
    text.length > 8192 ? text.slice(-4096) : text;
  const tailLines = splitLines(tailSlice);
  let eofCode: string | null = null;
  for (let i = tailLines.length - 1; i >= 0; i--) {
    const line = tailLines[i]!;
    if (line.startsWith("EOF")) {
      eofCode = cdataFromControlLine(line);
      break;
    }
  }

  return {
    bofCode,
    eofCode,
    code: bofCode ?? eofCode,
  };
}

export async function detectFormatCodeFromFile(file: File): Promise<string | null> {
  const detected = await detectFormatCodesFromFile(file);
  return detected.code;
}

/** 讀檔首／尾各約 4KB，依 BOF／EOF CDATA 判定 P01／R01 */
export async function detectFormatCodesFromFile(
  file: File,
): Promise<DetectedFormatCodes> {
  const headBytes = Math.min(file.size, 4096);
  const tailStart = Math.max(0, file.size - 4096);
  const head = await file.slice(0, headBytes).text();
  const tail =
    tailStart > 0 ? await file.slice(tailStart).text() : head;
  const fromHead = detectFormatCodesFromText(head);
  const fromTail = detectFormatCodesFromText(tail);
  const bofCode = fromHead.bofCode;
  const eofCode = fromTail.eofCode ?? fromHead.eofCode;
  return {
    bofCode,
    eofCode,
    code: bofCode ?? eofCode,
  };
}

/** 依 schema 明細 TYPE 字面值（N／R）判斷期望交易型態 */
export function expectedDetailType(schema: FormatSchema): "N" | "R" | null {
  const typeField = schema.records.detail.fields.find((f) => f.id === "TYPE");
  if (typeField?.source === "literal") {
    const v = String(typeField.value ?? "").trim();
    if (v === "N" || v === "R") return v;
  }
  if (schema.code === "ACHP01") return "N";
  if (schema.code === "ACHR01") return "R";
  return null;
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
    const range = digitRangeOf(def);
    const raw =
      range
        ? line.slice(range.start - 1, range.end)
        : offset >= line.length
          ? ""
          : line.slice(offset, offset + def.length);
    offset = range ? range.end : offset + def.length;
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

/** 明細指定欄位的固定長度偏移（依 schema records.detail 累加） */
export function detailFieldOffset(
  schema: FormatSchema,
  fieldId: string,
): number | null {
  let offset = 0;
  for (const f of schema.records.detail.fields) {
    if (f.id === fieldId) return offset;
    offset += f.length;
  }
  return null;
}

/**
 * 若所有明細「提回行／退件行代號」（ACHR01 PBANK／bankCode）皆為同一組 7 碼，回傳該代號；
 * 否則（空、缺碼、不一致）回傳 null。
 */
export function inferUniformR01ReturnBank(
  codes: Array<string | null | undefined>,
): string | null {
  let found: string | null = null;
  for (const raw of codes) {
    const d = safeDigits(String(raw ?? "")).slice(0, 7);
    if (d.length !== 7) return null;
    if (found == null) found = d;
    else if (found !== d) return null;
  }
  return found;
}

/** 上傳 R01 且提回行一致時，改以 P01 模式編輯（已停用：編輯畫面只留 R01） */
export function shouldOpenR01AsP01(_result: ImportResult): boolean {
  return false;
}

/** 將 P01 匯入結果轉成 R01 表單（提出行→orig*，收受者→bankCode/account） */
export function adaptP01ImportToR01(
  result: ImportResult,
  r01: FormatSchema,
): ImportResult {
  if (result.schema.code !== "ACHP01") return result;
  if (r01.code !== "ACHR01") return result;

  const mapRow = (row: DetailRow): DetailRow => {
    const next = emptyDetailRow(r01, row.id || newRowId());
    // 欄位對應依 R01 JSON form.detail key，不另寫欄位表
    for (const f of r01.form.detail) {
      next[f.key] = String(row[f.key] ?? "");
    }
    if (!String(next.txid ?? "").trim()) {
      next.txid = String(result.header.txid ?? "");
    }
    if (!String(next.origBankCode ?? "").trim()) {
      next.origBankCode = String(result.header.bankCode ?? "");
    }
    if (!String(next.origAccount ?? "").trim()) {
      next.origAccount = String(result.header.account ?? "");
    }
    return next;
  };

  const rows = result.rows.map(mapRow);
  const previewRows = result.previewRows.map(mapRow);
  const first = rows[0] ?? previewRows[0];
  const header = emptyHeader(r01);
  for (const f of r01.form.header) {
    header[f.key] = String(result.header[f.key] ?? "");
  }
  if (!String(header.txid ?? "").trim()) {
    header.txid = String(first?.txid ?? "");
  }
  if (!String(header.bankCode ?? "").trim()) {
    header.bankCode = String(first?.bankCode ?? "");
  }
  if (!String(header.account ?? "").trim()) {
    header.account = String(first?.account ?? "");
  }
  if (!String(header.agentBank ?? "").trim()) {
    header.agentBank =
      result.uniformReturnBank ??
      inferUniformR01ReturnBank(
        (rows.length ? rows : previewRows).map((r) => r.bankCode),
      ) ??
      "";
  }

  return {
    ...result,
    sourceFormatCode: result.sourceFormatCode ?? "ACHP01",
    schema: r01,
    header,
    rows,
    previewRows,
  };
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

/** ACHP01 明細 PBANK/PCLNO（origBankCode／origAccount）寫入列供逐筆對調 */
export function attachP01PresenterFromFields(
  row: DetailRow,
  fields: ParsedRecordField[],
): void {
  for (const f of fields) {
    if (f.id === "PBANK") {
      const v = fieldText(f);
      if (v) row.origBankCode = v;
    }
    if (f.id === "PCLNO") {
      const v = fieldText(f);
      if (v) row.origAccount = v;
    }
  }
}

function detailRowFromFields(
  schema: FormatSchema,
  fields: ParsedRecordField[],
): DetailRow {
  const values = collectKeyedValues(fields, "detail");
  // 依 records.detail 欄位 ID 建索引，供 form.detail 逐欄依 id 切片取值。
  const byId = new Map<string, ParsedRecordField>();
  for (const f of fields) {
    if (f.id) byId.set(f.id, f);
  }
  const row = emptyDetailRow(schema, newRowId());
  // 匯入依 form.detail id 切片取值：優先用該欄 id 對應的檔案切片（含 hidden 欄，供 FILTER 篩選），
  // 缺 id／檔內無對應欄時回退 records.detail 同 key 值。
  for (const f of schema.form.detail) {
    const sliced = f.id ? byId.get(f.id) : undefined;
    row[f.key] = sliced ? sliced.value : (values[f.key] ?? "");
  }
  if (schema.code === "ACHP01") {
    attachP01PresenterFromFields(row, fields);
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
    if (f.id === "PSEQ") {
      row.pseq = fieldText(f);
    }
    if (f.id === "RCODE") {
      row.rcode = fieldText(f);
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
  /** 明細 TYPE 與 schema 期望不符筆數（上傳僅檢此結構規則） */
  detailTypeMismatchCount: number;
  /** 明細首字非 N／R 筆數 */
  detailTypeOtherCount: number;
  bofCode: string | null;
  eofCode: string | null;
  tooLargeForForm: boolean;
  collectingRows: boolean;
  sawNonEmpty: boolean;
  filterActive: boolean;
  filters: DetailFilters;
  filterGlobal: string;
  /** ACHR01 明細 PBANK（退件行）偏移；非 R01 為 null */
  returnBankOffset: number | null;
  /** 串流所見第一個有效提回行代號 */
  uniformReturnBank: string | null;
  /** 提回行代號不一致或有列非 7 碼 */
  returnBankConflict: boolean;
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
    detailTypeMismatchCount: 0,
    detailTypeOtherCount: 0,
    bofCode: null,
    eofCode: null,
    tooLargeForForm: false,
    collectingRows: true,
    sawNonEmpty: false,
    filterActive,
    filters,
    filterGlobal,
    returnBankOffset:
      schema.code === "ACHR01" ? detailFieldOffset(schema, "PBANK") : null,
    uniformReturnBank: null,
    returnBankConflict: false,
  };
}

function noteDetailReturnBank(acc: ParseAcc, raw: string): void {
  if (acc.returnBankOffset == null || acc.returnBankConflict) return;
  const code = raw
    .slice(acc.returnBankOffset, acc.returnBankOffset + 7)
    .trim();
  if (!/^\d{7}$/.test(code)) {
    acc.returnBankConflict = true;
    return;
  }
  if (acc.uniformReturnBank == null) {
    acc.uniformReturnBank = code;
    return;
  }
  if (acc.uniformReturnBank !== code) {
    acc.returnBankConflict = true;
  }
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
    if (kind === "header") {
      acc.headerLine = sample;
      if (!acc.bofCode) acc.bofCode = cdataFromControlLine(raw);
    } else {
      acc.trailerLine = sample;
      acc.eofCode = cdataFromControlLine(raw);
    }
    return;
  }

  // detail — 上傳階段僅檢 TYPE（N＝P01／R＝R01），完整欄位規則延至編輯／輸出
  acc.detailCount += 1;
  const expectedType = expectedDetailType(acc.schema);
  const typeChar = raw.charAt(0);
  if (expectedType && (typeChar === "N" || typeChar === "R")) {
    if (typeChar !== expectedType) acc.detailTypeMismatchCount += 1;
  } else if (raw.trim()) {
    acc.detailTypeOtherCount += 1;
  }

  // R01：每列提回行／退件行代號（PBANK）都掃，即使大檔略過欄位解析
  noteDetailReturnBank(acc, raw);

  const needParse =
    acc.filterActive ||
    acc.previewRows.length < IMPORT_LIMITS.maxPreviewDetailRows ||
    (acc.collectingRows &&
      acc.matchedCount < IMPORT_LIMITS.maxFormDetailRows) ||
    acc.detailSamples.length < IMPORT_LIMITS.maxDetailLineSamples;

  if (!needParse) {
    // 未篩選且已超過收集上限：只計數／列長／TYPE，並丟掉已物化的 rows
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

/** 提出資料中應以「明細第一筆」為準的欄位。ACHP01 僅強制 TXID（帳號／統編留在提出行／發動者）。 */
const HEADER_FROM_FIRST_DETAIL = new Set(["txid", "account", "taxId"]);

function finalizeHeader(acc: ParseAcc): HeaderValues {
  const header: HeaderValues = emptyHeader(acc.schema);
  if (acc.headerLine) {
    Object.assign(header, collectKeyedValues(acc.headerLine.fields, "header"));
  }
  // R01 的 YDATE 等欄位在尾錄；缺時從來源 EOF 補入
  if (acc.trailerLine) {
    const fromTrailer = collectKeyedValues(acc.trailerLine.fields, "header");
    for (const [k, v] of Object.entries(fromTrailer)) {
      if (!v?.trim()) continue;
      if (!String(header[k] ?? "").trim()) header[k] = v;
    }
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
    const isP01 = acc.schema.code === "ACHP01";
    const fromDetail = {
      ...fromDetailHeader,
      ...(fromDetailBody.txid ? { txid: fromDetailBody.txid } : {}),
      // 統編（CID）自 1.4.78 起為明細欄 cid；表頭統編以首筆明細 cid 補入
      // （還原「匯入時填入表頭統編」行為，避免輸出時被「公司／機關統編：未輸入」擋下）
      ...(fromDetailBody.cid ? { taxId: fromDetailBody.cid } : {}),
      // ACHR01 BOF 無 bankCode／account；參考欄由首筆明細 RBANK／RCLNO（檔案原樣）補
      // ACHP01 表頭提出行／發動者＝首筆 PBANK／PCLNO（orig*），不可用收受者覆蓋
      ...(!isP01 && fromDetailBody.bankCode
        ? { bankCode: fromDetailBody.bankCode }
        : {}),
      ...(!isP01 && fromDetailBody.account
        ? { account: fromDetailBody.account }
        : {}),
      ...(isP01 && fromDetailBody.origBankCode
        ? { bankCode: fromDetailBody.origBankCode }
        : {}),
      ...(isP01 && fromDetailBody.origAccount
        ? { account: fromDetailBody.origAccount }
        : {}),
    };
    const forceFromFirst = isP01
      ? new Set(["txid"])
      : HEADER_FROM_FIRST_DETAIL;
    for (const [k, v] of Object.entries(fromDetail)) {
      if (!v) continue;
      // 交易代號等：分割／匯入後一律以明細第一筆為主
      if (forceFromFirst.has(k) || !header[k]) {
        header[k] = v;
      }
    }
  }

  // R01：所有明細提回行代號相同時，自動填入代表行（可覆寫空白／不一致的 BOF RORG）
  if (
    acc.schema.code === "ACHR01" &&
    !acc.returnBankConflict &&
    acc.uniformReturnBank
  ) {
    header.agentBank = acc.uniformReturnBank;
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

  const bofCode = acc.bofCode ?? cdataFromControlLine(acc.headerLine?.raw);
  const eofCode = acc.eofCode ?? cdataFromControlLine(acc.trailerLine?.raw);
  if (bofCode && eofCode && bofCode !== eofCode) {
    acc.errors.push(
      `BOF 檔案代號為 ${bofCode}，EOF 為 ${eofCode}，兩者不一致`,
    );
  }

  const expectedType = expectedDetailType(acc.schema);
  if (expectedType && acc.detailCount > 0) {
    if (acc.detailTypeMismatchCount > 0) {
      const got = expectedType === "N" ? "R" : "N";
      const label =
        expectedType === "N" ? "ACHP01（TYPE=N）" : "ACHR01（TYPE=R）";
      // 只判斷明細 N/R：四種檔（P01/N、P01/R、R01/N、R01/R）皆可上傳編輯，
      // 首錄與明細 TYPE 不一致僅提示（不擋套用），輸出時依明細 N/R 處理。
      pushWarning(
        acc.warnings,
        `首錄為 ${acc.schema.code}，但有 ${acc.detailTypeMismatchCount.toLocaleString("zh-TW")} 筆明細為 TYPE=${got}（可依明細 N/R 輸出）`,
      );
    }
    if (acc.detailTypeOtherCount > 0) {
      pushWarning(
        acc.warnings,
        `有 ${acc.detailTypeOtherCount.toLocaleString("zh-TW")} 筆明細首字非 N／R（略過完整欄位檢核；請於編輯頁修正）`,
      );
    }
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
    sourceFormatCode: acc.schema.code,
    uniformReturnBank:
      acc.schema.code === "ACHR01" &&
      !acc.returnBankConflict &&
      acc.uniformReturnBank
        ? acc.uniformReturnBank
        : null,
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
  const detected = detectFormatCodesFromText(text);
  const detectedCode = detected.code;
  const acc = createAcc(schema, {
    filters: opts?.filters,
    filterGlobal: opts?.filterGlobal,
  });
  acc.bofCode = detected.bofCode;
  acc.eofCode = detected.eofCode;

  applyUploadDetectWarnings(acc, schema, detected);

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
  const detected = await detectFormatCodesFromFile(file);
  const detectedCode = detected.code;
  const acc = createAcc(schema, {
    filters: opts?.filters,
    filterGlobal: opts?.filterGlobal,
  });
  acc.bofCode = detected.bofCode;
  acc.eofCode = detected.eofCode;

  applyUploadDetectWarnings(acc, schema, detected);

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

/** 上傳頁：僅提示 BOF／EOF 判定結果（完整欄位規則不在此檢） */
function applyUploadDetectWarnings(
  acc: ParseAcc,
  schema: FormatSchema,
  detected: DetectedFormatCodes,
): void {
  if (detected.code && detected.code !== schema.code) {
    pushWarning(
      acc.warnings,
      `檔案代號為 ${detected.code}（BOF／EOF），目前以 ${schema.code} 格式解析`,
    );
  } else if (!detected.code) {
    pushWarning(acc.warnings, "無法從 BOF／EOF 列辨識檔案代號（CDATA）");
  }
}

/** 在多個格式中選出最適合解析的 schema（優先 BOF／EOF CDATA，其次列長） */
export function resolveImportSchema(
  text: string,
  formats: Record<string, FormatSchema>,
  preferred?: FormatSchema,
): FormatSchema | null {
  const detected = detectFormatCodesFromText(text);
  if (detected.code && formats[detected.code]) return formats[detected.code];

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
  const detected = await detectFormatCodesFromFile(file);
  if (detected.code && formats[detected.code]) return formats[detected.code];

  const head = await file.slice(0, 4096).text();
  return resolveImportSchema(head, formats, preferred);
}
