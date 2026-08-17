import type {
  Branch,
  DetailRow,
  FormatSchema,
  FormFieldDef,
  HeaderValues,
  RecordFieldDef,
  Txid,
  ValidationRule,
} from "./schema";
import { applyPad, filterByCharset, formatExportField, sanitizeInput } from "./field";
import { nowHms, prevRocDate, rocToDate, safeDigits, todayRoc } from "./utils";

export function lookupTxid(code: string, txids: Txid[]): Txid | undefined {
  return txids.find((t) => t.code === code);
}

export function lookupBranch(code: string, branches: Branch[]): Branch | undefined {
  return branches.find((b) => b.code === code);
}

/** 交易類別顯示：SD＝代收、SC＝代付（對照財金建檔小程式） */
export function formatTxTypeLabel(type: string): string {
  if (type === "SD") return "代收 SD";
  if (type === "SC") return "代付 SC";
  return type;
}

export function resolveSorg(bankCode: string, branches: Branch[]): string {
  if (bankCode.startsWith("822")) return "8220901";
  const b = lookupBranch(bankCode, branches);
  return b?.head || bankCode;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function emptyHeader(schema: FormatSchema): HeaderValues {
  const h: HeaderValues = {};
  for (const f of schema.form.header) {
    if (f.key === "date") {
      // 由 store 填 todayRoc
      h[f.key] = "";
    } else if (f.key === "admark") {
      h[f.key] = schema.authOptions?.[0]?.value ?? "A";
    } else if (f.key === "txid") {
      h[f.key] = "704";
    } else {
      h[f.key] = "";
    }
  }
  return h;
}

export function emptyDetailRow(schema: FormatSchema, id: string): DetailRow {
  const row: DetailRow = { id };
  for (const f of schema.form.detail) {
    row[f.key] = "";
  }
  return row;
}

/** 序號單獨填寫不視為有效明細（避免空白列被 SEQ 佔住） */
function detailKeysForContent(schema: FormatSchema): FormFieldDef[] {
  return schema.form.detail.filter((f) => f.key !== "seq");
}

export function isRowEmpty(row: DetailRow, schema: FormatSchema): boolean {
  return detailKeysForContent(schema).every(
    (f) => !String(row[f.key] ?? "").trim(),
  );
}

function rowHasOtherValues(
  schema: FormatSchema,
  row: DetailRow,
  exceptKey: string,
): boolean {
  return detailKeysForContent(schema).some(
    (f) => f.key !== exceptKey && String(row[f.key] ?? "").trim(),
  );
}

/** 以明細第一筆交易代號同步表頭（檔名／TXTYPE 後備） */
export function syncHeaderFromDetails(
  header: HeaderValues,
  rows: DetailRow[],
  schema: FormatSchema,
): HeaderValues {
  const first = rows.find((r) => !isRowEmpty(r, schema));
  if (!first) return header;
  const txid = String(first.txid ?? "").trim();
  if (!txid) return header;
  if (header.txid === txid) return header;
  return { ...header, txid };
}

export function runRule(
  rule: ValidationRule,
  value: string,
  ctx: {
    row?: DetailRow;
    header?: HeaderValues;
    schema: FormatSchema;
    section: "header" | "detail";
    field: FormFieldDef;
    txids: Txid[];
    branches: Branch[];
  },
): string | null {
  const v = value ?? "";

  switch (rule.type) {
    case "required":
      if (!v) return rule.message ?? "未輸入";
      return null;
    case "requiredIfAny": {
      if (v) return null;
      if (!ctx.row) return null;
      if (rowHasOtherValues(ctx.schema, ctx.row, ctx.field.key)) {
        return rule.message ?? `${ctx.field.label}未輸入`;
      }
      return null;
    }
    case "requiredIfTxType": {
      if (v) return null;
      if (!ctx.row) return null;
      const txidCode = (
        ctx.row.txid ??
        ctx.header?.txid ??
        ""
      ).trim();
      const txType = lookupTxid(txidCode, ctx.txids)?.type ?? "";
      if (!rule.txTypes.includes(txType as "SD" | "SC")) return null;
      if (rowHasOtherValues(ctx.schema, ctx.row, ctx.field.key)) {
        return rule.message ?? `${ctx.field.label}未輸入`;
      }
      return null;
    }
    case "exactLength":
      if (!v) return null;
      if (v.length !== rule.length) return rule.message ?? `長度應為 ${rule.length} 碼`;
      return null;
    case "maxLength":
      if (v.length > rule.length) return rule.message ?? `不可超過 ${rule.length} 個字`;
      return null;
    case "oneOfLengths":
      if (!v) return null;
      if (!rule.lengths.includes(v.length)) {
        return rule.message ?? `長度應為 ${rule.lengths.join(" 或 ")} 碼`;
      }
      return null;
    case "rocDate": {
      if (!v || v.length !== 8) return rule.message ?? "日期長度請輸入八碼";
      const dt = rocToDate(v);
      if (!dt) return "非合法日期";
      if (rule.notPast && dt < startOfToday()) return "不允許輸入過去日期";
      return null;
    }
    case "txid": {
      if (!v) return null;
      const found = lookupTxid(v, ctx.txids);
      if (!found) return rule.message ?? "交易代號錯誤";
      if (rule.minValue != null && Number(v) < rule.minValue) {
        return rule.message ?? "交易代號錯誤";
      }
      if (rule.txTypes && rule.txTypes.length > 0) {
        if (!rule.txTypes.includes(found.type as "SD" | "SC")) {
          return rule.message ?? "交易代號錯誤";
        }
      }
      return null;
    }
    case "branchCode": {
      if (!v) return null;
      if (!ctx.branches.some((b) => b.code === v)) {
        return rule.message ?? "銀行代號錯誤";
      }
      return null;
    }
    case "number": {
      if (!v) return null;
      if (!/^-?\d+(\.\d+)?$/.test(v) || Number.isNaN(Number(v))) {
        return rule.message ?? "必須是數字";
      }
      return null;
    }
    case "maxIntegerDigits": {
      if (!v) return null;
      const intPart = String(v).replace(/^-/, "").replace(/\..*$/, "");
      if (intPart.length > rule.length) {
        return rule.message ?? `整數最多 ${rule.length} 位數`;
      }
      return null;
    }
    default:
      return null;
  }
}

export function validateField(
  field: FormFieldDef,
  value: string,
  ctx: {
    row?: DetailRow;
    header?: HeaderValues;
    schema: FormatSchema;
    section: "header" | "detail";
    txids: Txid[];
    branches: Branch[];
  },
): string | null {
  const rules = field.validation?.rules ?? [];
  for (const rule of rules) {
    const err = runRule(rule, value, { ...ctx, field });
    if (err) return err;
  }
  return null;
}

export function validateHeader(
  schema: FormatSchema,
  header: HeaderValues,
  txids: Txid[],
  branches: Branch[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const f of schema.form.header) {
    out[f.key] = validateField(f, header[f.key] ?? "", {
      schema,
      header,
      section: "header",
      txids,
      branches,
    });
  }
  return out;
}

export function headerHasError(errs: Record<string, string | null>): boolean {
  return Object.values(errs).some(Boolean);
}

/** 依 records 欄位定義取出固定長度欄位原文 */
export function recordFieldRaw(
  line: string,
  fields: RecordFieldDef[],
  id: string,
): string {
  let offset = 0;
  for (const f of fields) {
    if (f.id === id) {
      return offset >= line.length ? "" : line.slice(offset, offset + f.length);
    }
    offset += f.length;
  }
  return "";
}

function controlDateFieldError(
  field: FormFieldDef | undefined,
  value: string,
  schema: FormatSchema,
  header: HeaderValues,
  txids: Txid[],
  branches: Branch[],
): string | null {
  const digits = safeDigits(value).slice(0, 8);
  if (!field) {
    if (!digits) return "未輸入";
    if (digits.length !== 8) return "日期長度請輸入八碼";
    if (!rocToDate(digits)) return "非合法日期";
    return null;
  }
  return validateField(field, digits, {
    schema,
    header: { ...header, [field.key]: digits },
    section: "header",
    txids,
    branches,
  });
}

/**
 * 輸出前檢核將寫入 BOF／EOF 的處理日期：八碼、合法民國日、須為今日。
 * 上傳原檔 TDATE 非今日時在此擋下（P01／R01 相同）。
 */
export function validateExportControlDates(
  schema: FormatSchema,
  header: HeaderValues,
  txids: Txid[],
  branches: Branch[],
): string[] {
  const errors: string[] = [];
  const dateField = schema.form.header.find((f) => f.key === "date");
  const raw = header.date ?? "";
  const dateErr = controlDateFieldError(
    dateField,
    raw,
    schema,
    header,
    txids,
    branches,
  );
  if (dateErr) {
    errors.push(`BOF／EOF 處理日期（TDATE）：${dateErr}`);
    return errors;
  }
  const digits = safeDigits(raw).slice(0, 8);
  if (digits !== todayRoc()) {
    errors.push("BOF／EOF 處理日期（TDATE）：處理日期須為今日");
  }
  return errors;
}

function legalRocDateError(value: string): string | null {
  const digits = safeDigits(value).slice(0, 8);
  if (!digits) return "未輸入";
  if (digits.length !== 8) return "日期長度請輸入八碼";
  if (!rocToDate(digits)) return "非合法日期";
  return null;
}

/** 八碼且為合法民國年月日時回傳數字，否則空字串 */
export function legalRoc8(value: string | undefined): string {
  const digits = safeDigits(value ?? "").slice(0, 8);
  if (digits.length === 8 && rocToDate(digits)) return digits;
  return "";
}

/**
 * R01 EOF YDATE＝TDATE 的前一日（簡易日曆日）。
 * 不論原 YDATE 是否有值，輸出一律套用此原則。
 */
export function resolveR01Ydate(
  _ydate: string | undefined,
  tdate: string | undefined,
): string {
  const t = legalRoc8(tdate);
  return (t && prevRocDate(t)) || "";
}

/** 檢核已組出的 BOF／EOF 列上的 TDATE（及 R01 YDATE）為合法民國日期 */
export function validateBuiltControlDates(
  schema: FormatSchema,
  headerLine: string,
  trailerLine: string,
): string[] {
  const bofDate = recordFieldRaw(
    headerLine,
    schema.records.header.fields,
    "TDATE",
  );
  const eofDate = recordFieldRaw(
    trailerLine,
    schema.records.trailer.fields,
    "TDATE",
  );
  const errors: string[] = [];
  const bofErr = legalRocDateError(bofDate);
  if (bofErr) errors.push(`BOF 處理日期（TDATE）：${bofErr}`);
  const eofErr = legalRocDateError(eofDate);
  if (eofErr) errors.push(`EOF 處理日期（TDATE）：${eofErr}`);
  const bofDigits = safeDigits(bofDate).slice(0, 8);
  const eofDigits = safeDigits(eofDate).slice(0, 8);
  if (!bofErr && !eofErr && bofDigits !== eofDigits) {
    errors.push(`BOF 與 EOF 處理日期不一致（${bofDigits}／${eofDigits}）`);
  }

  if (schema.code === "ACHR01") {
    const yRaw = recordFieldRaw(
      trailerLine,
      schema.records.trailer.fields,
      "YDATE",
    );
    const yErr = legalRocDateError(yRaw);
    if (yErr) {
      errors.push(`EOF 前一營業日（YDATE）：${yErr}`);
    } else {
      const expected = prevRocDate(eofDigits || bofDigits);
      const yDigits = safeDigits(yRaw).slice(0, 8);
      if (expected && yDigits !== expected) {
        errors.push(
          `EOF 前一營業日（YDATE）須為處理日期前一日（${expected}）`,
        );
      }
    }
  }
  return errors;
}

export function validateDetailRow(
  schema: FormatSchema,
  row: DetailRow,
  txids: Txid[],
  branches: Branch[],
  header?: HeaderValues,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (isRowEmpty(row, schema)) {
    for (const f of schema.form.detail) out[f.key] = null;
    return out;
  }
  for (const f of schema.form.detail) {
    out[f.key] = validateField(f, row[f.key] ?? "", {
      row,
      header,
      schema,
      section: "detail",
      txids,
      branches,
    });
  }
  return out;
}

export function rowErrorMessages(errs: Record<string, string | null>): string[] {
  return Object.values(errs).filter(Boolean) as string[];
}

type BuildCtx = {
  schema: FormatSchema;
  header: HeaderValues;
  detail?: DetailRow;
  seq: number;
  totalCount: number;
  totalAmount: number;
  txids: Txid[];
  branches: Branch[];
};

function resolveField(def: RecordFieldDef, ctx: BuildCtx): string {
  const pad = def.pad;
  const length = def.length;

  switch (def.source) {
    case "literal":
      return formatExportField(def.value ?? "", {
        length,
        pad: pad ?? { side: "right", char: " " },
      });
    case "formatCode":
      return formatExportField(ctx.schema.code, {
        length,
        pad: pad ?? { side: "right", char: " " },
      });
    case "version":
      return formatExportField(ctx.schema.version, {
        length,
        pad: pad ?? { side: "right", char: " " },
      });
    case "filler":
      return (def.fill ?? " ").repeat(length);
    case "runtime":
      if (def.fn === "nowHms") {
        return formatExportField(nowHms(), {
          length,
          charset: "digit",
          pad: pad ?? { side: "left", char: "0" },
        });
      }
      return " ".repeat(length);
    case "derived": {
      let raw = "";
      if (def.fn === "sorg") {
        raw = resolveSorg(ctx.header.bankCode ?? "", ctx.branches);
      } else if (def.fn === "txType") {
        const txidCode = (
          ctx.detail?.txid ??
          ctx.header.txid ??
          ""
        ).trim();
        raw = lookupTxid(txidCode, ctx.txids)?.type || "";
      } else if (def.fn === "seq") {
        // 舊 schema 後備：明細未改為 detail.seq 時仍可用
        const fromRow = String(ctx.detail?.seq ?? "").trim();
        raw = fromRow || String(ctx.seq);
      } else if (def.fn === "totalCount") {
        raw = String(ctx.totalCount);
      } else if (def.fn === "totalAmount") {
        raw = String(Math.floor(ctx.totalAmount));
      }
      return formatExportField(raw, {
        length,
        charset: def.charset,
        pad: pad ?? { side: "left", char: "0" },
        transform: def.transform,
      });
    }
    case "header": {
      const raw = ctx.header[def.key ?? ""] ?? "";
      return formatExportField(raw, {
        length,
        charset: def.charset,
        pad: pad ?? { side: "right", char: " " },
        transform: def.transform,
      });
    }
    case "detail": {
      let raw = ctx.detail?.[def.key ?? ""] ?? "";
      // 交易代號：明細未填時回退表頭（手動建檔／舊資料）
      if (!String(raw).trim() && def.key === "txid") {
        raw = ctx.header.txid ?? "";
      }
      // 序號：明細未填時依列序自動編號
      if (!String(raw).trim() && def.key === "seq") {
        raw = String(ctx.seq);
      }
      // 與原 VBA 對齊：銀行代號/帳號 charset 過濾後 pad.side=none 則不補長
      return formatExportField(raw, {
        length,
        charset: def.charset,
        pad: pad ?? { side: "right", char: " " },
        transform: def.transform,
      });
    }
    default:
      return " ".repeat(length);
  }
}

export function buildRecord(fields: RecordFieldDef[], ctx: BuildCtx): string {
  return fields.map((f) => resolveField(f, ctx)).join("");
}

export type GenerateResult = {
  content: string;
  count: number;
  amount: number;
  filename: string;
  lines: string[];
  recordLength: number;
};

/**
 * ACHR01 明細 1-based 第 15–37 碼（PBANK+PCLNO）與第 38–60 碼（RBANK+RCLNO）對調。
 * 僅輸出時對調；上傳 R01 依檔案原樣解析，不對調。
 */
export function swapR01DetailBankAccountBlocks(line: string): string {
  if (line.length < 60) return line;
  return (
    line.slice(0, 14) + line.slice(37, 60) + line.slice(14, 37) + line.slice(60)
  );
}

export function generateFromSchema(
  schema: FormatSchema,
  header: HeaderValues,
  rows: DetailRow[],
  txids: Txid[],
  branches: Branch[],
): GenerateResult {
  const amountKey = schema.features.amountKey;
  const nonEmpty = rows.filter((r) => !isRowEmpty(r, schema));
  let effectiveHeader = syncHeaderFromDetails(header, nonEmpty, schema);
  if (schema.code === "ACHR01") {
    effectiveHeader = {
      ...effectiveHeader,
      ydate: resolveR01Ydate(effectiveHeader.ydate, effectiveHeader.date),
    };
  }

  let totalAmount = 0;
  if (amountKey) {
    for (const r of nonEmpty) {
      totalAmount += Number(r[amountKey]) || 0;
    }
  }

  const baseCtx: Omit<BuildCtx, "seq" | "detail"> = {
    schema,
    header: effectiveHeader,
    totalCount: nonEmpty.length,
    totalAmount,
    txids,
    branches,
  };

  const lines: string[] = [];
  lines.push(
    buildRecord(schema.records.header.fields, {
      ...baseCtx,
      seq: 0,
      totalCount: nonEmpty.length,
    }),
  );

  let seq = 1;
  for (const row of nonEmpty) {
    let rec = buildRecord(schema.records.detail.fields, {
      ...baseCtx,
      detail: row,
      seq,
    });
    if (schema.code === "ACHR01") {
      rec = swapR01DetailBankAccountBlocks(rec);
    }
    lines.push(rec);
    seq += 1;
  }

  lines.push(
    buildRecord(schema.records.trailer.fields, {
      ...baseCtx,
      seq: 0,
      totalCount: nonEmpty.length,
    }),
  );

  const ending = schema.lineEnding || "\r\n";
  const content = lines.join(ending) + ending;

  // filename: {code}_{date}{txid}{taxId}.txt
  const filename = schema.filenamePattern
    .replace("{code}", schema.code)
    .replace("{date}", effectiveHeader.date ?? "")
    .replace("{txid}", effectiveHeader.txid ?? "")
    .replace("{taxId}", effectiveHeader.taxId ?? "")
    .replace("{shortCode}", schema.shortCode);

  return {
    content,
    count: nonEmpty.length,
    amount: totalAmount,
    filename,
    lines,
    recordLength: schema.recordLength,
  };
}

/** 套用 form field 的 pad onBlur */
export function applyFieldBlur(field: FormFieldDef, value: string): string {
  let v = value;
  if (field.charset && field.inputType !== "amount") {
    v = filterByCharset(v, field.charset);
  }
  if (field.pad?.onBlur && field.pad.side !== "none" && v) {
    v = applyPad(v, field.length, field.pad);
  }
  return v;
}

export function sanitizeFieldInput(field: FormFieldDef, raw: string): string {
  return sanitizeInput(raw, {
    charset: field.charset,
    length: field.length,
    inputType: field.inputType,
  });
}

export function assertRecordLengths(schema: FormatSchema): string[] {
  const errs: string[] = [];
  for (const section of ["header", "detail", "trailer"] as const) {
    const len = schema.records[section].fields.reduce((s, f) => s + f.length, 0);
    if (len !== schema.recordLength) {
      errs.push(
        `${schema.code} ${section} 欄位總長 ${len} ≠ recordLength ${schema.recordLength}`,
      );
    }
  }
  return errs;
}
