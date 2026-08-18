import type { FormatSchema, FormFieldDef } from "./schema";

export function isHiddenDetailField(field: FormFieldDef): boolean {
  return field.hidden === true;
}

/** 明細表欄序＝form.detail（與 records.detail 同步），略過 hidden */
export function orderDetailFieldsForEdit(schema: FormatSchema): FormFieldDef[] {
  return schema.form.detail.filter((f) => !isHiddenDetailField(f));
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
