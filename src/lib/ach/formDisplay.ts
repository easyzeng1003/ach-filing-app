import type { FormatSchema, FormFieldDef } from "./schema";

/** 明細表不顯示的 form.detail key（仍寫入固定長度檔） */
const HIDDEN_DETAIL_KEYS = new Set(["pschd"]);

/**
 * R01 編輯欄序：提示行（提出）在前，提回行（收受）在後。
 * 不改 `records.detail`（檔案位元組配置）。
 */
const R01_DISPLAY_ORDER = [
  "seq",
  "txid",
  "origBankCode",
  "origAccount",
  "bankCode",
  "account",
  "taxId",
  "userNo",
  "amount",
  "rcode",
  "pdate",
  "pseq",
] as const;

export function orderDetailFieldsForEdit(schema: FormatSchema): FormFieldDef[] {
  const visible = schema.form.detail.filter(
    (f) => !HIDDEN_DETAIL_KEYS.has(f.key),
  );
  if (schema.code !== "ACHR01") return visible;
  const byKey = new Map(visible.map((f) => [f.key, f]));
  const out: FormFieldDef[] = [];
  const seen = new Set<string>();
  for (const key of R01_DISPLAY_ORDER) {
    const f = byKey.get(key);
    if (!f) continue;
    out.push(f);
    seen.add(key);
  }
  for (const f of visible) {
    if (!seen.has(f.key)) out.push(f);
  }
  return out;
}

/** @deprecated 改用 orderDetailFieldsForEdit */
export function orderDetailFieldsLikeP01(
  schema: FormatSchema,
  _p01?: FormatSchema,
): FormFieldDef[] {
  return orderDetailFieldsForEdit(schema);
}

/** 明細表／預覽／篩選下拉的顯示欄位 */
export function detailFieldsForDisplay(schema: FormatSchema): FormFieldDef[] {
  return orderDetailFieldsForEdit(schema);
}
