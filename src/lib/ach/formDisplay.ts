import type { FormatSchema, FormFieldDef } from "./schema";

export function isHiddenDetailField(field: FormFieldDef): boolean {
  return field.hidden === true;
}

/**
 * 明細表欄序＝該格式 JSON 的 form.detail，略過 hidden。
 * 不在 TS 另寫欄位表或重排。
 */
export function detailFieldsForDisplay(schema: FormatSchema): FormFieldDef[] {
  return schema.form.detail.filter((f) => !isHiddenDetailField(f));
}

/** @deprecated 改用 detailFieldsForDisplay */
export function orderDetailFieldsForEdit(schema: FormatSchema): FormFieldDef[] {
  return detailFieldsForDisplay(schema);
}

/**
 * 上傳後顯示欄用「來源檔」那份 JSON（P01→ACHP01.json，R01→ACHR01.json）。
 */
export function resolveDetailDisplaySchema(
  workspaceSchema: FormatSchema,
  formats: Record<string, FormatSchema | undefined>,
  sourceFormatCode?: string | null,
): FormatSchema {
  const fromSource = sourceFormatCode
    ? formats[sourceFormatCode]
    : undefined;
  return fromSource ?? workspaceSchema;
}
