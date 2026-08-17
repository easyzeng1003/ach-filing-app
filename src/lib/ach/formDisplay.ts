import { loadEmbeddedFormats } from "@/data/embedded";
import type { FormatSchema, FormFieldDef } from "./schema";

let cachedP01: FormatSchema | null | undefined;

function p01Schema(): FormatSchema | null {
  if (cachedP01 !== undefined) return cachedP01;
  cachedP01 = loadEmbeddedFormats().ACHP01 ?? null;
  return cachedP01;
}

/**
 * 依 ACHP01 `form.detail` 重排顯示欄：共用 key 用 P01 標籤，
 * 來源格式多出的欄位接在後面。不改 `records.detail`（檔案位元組配置）。
 */
export function orderDetailFieldsLikeP01(
  schema: FormatSchema,
  p01: FormatSchema,
): FormFieldDef[] {
  if (schema.code === p01.code) return schema.form.detail;
  const ownByKey = new Map(schema.form.detail.map((f) => [f.key, f]));
  const seen = new Set<string>();
  const out: FormFieldDef[] = [];
  for (const p of p01.form.detail) {
    const own = ownByKey.get(p.key);
    if (!own) continue;
    out.push({
      ...own,
      label: p.label,
      placeholder: p.placeholder ?? own.placeholder,
    });
    seen.add(p.key);
  }
  for (const f of schema.form.detail) {
    if (!seen.has(f.key)) out.push(f);
  }
  return out;
}

/** 明細表／預覽／篩選下拉的顯示欄位（以 P01 為準） */
export function detailFieldsForDisplay(schema: FormatSchema): FormFieldDef[] {
  const p01 = p01Schema();
  if (!p01) return schema.form.detail;
  return orderDetailFieldsLikeP01(schema, p01);
}
