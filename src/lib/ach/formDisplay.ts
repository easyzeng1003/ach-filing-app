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

/** @deprecated 改用 detailFieldsForDisplay */
export function orderDetailFieldsForEdit(schema: FormatSchema): FormFieldDef[] {
  return detailFieldsForDisplay(schema);
}
