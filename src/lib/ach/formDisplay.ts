import type { FormatSchema, FormFieldDef } from "./schema";

export function isHiddenDetailField(field: FormFieldDef): boolean {
  return field.hidden === true;
}

/**
 * 編輯／預覽明細欄＝目前工作區 JSON 的 form.detail（略過 hidden）。
 * 畫面只留 R01，故此處為 ACHR01.json。
 */
export function detailFieldsForDisplay(schema: FormatSchema): FormFieldDef[] {
  return schema.form.detail.filter((f) => !isHiddenDetailField(f));
}

/**
 * 篩選／排除（FILTER）可選欄位＝目前工作區 JSON 的 form.detail「全部欄位」（含 hidden）。
 * 與編輯／預覽不同：FILTER 需可依任一 JSON 明細欄位篩選（含隱藏的 literal／衍生／filler 欄），
 * 故此處不濾除 hidden。列值由匯入時依 form.detail id 切片取得。
 */
export function detailFieldsForFilter(schema: FormatSchema): FormFieldDef[] {
  return schema.form.detail.slice();
}

/** @deprecated 改用 detailFieldsForDisplay */
export function orderDetailFieldsForEdit(schema: FormatSchema): FormFieldDef[] {
  return detailFieldsForDisplay(schema);
}
