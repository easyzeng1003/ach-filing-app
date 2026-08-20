import type { DetailRow, FormatSchema, FormFieldDef } from "./schema";
import { isRowEmpty } from "./engine";

/** 每個明細欄位一個篩選值（key → 關鍵字） */
export type DetailFilters = Record<string, string>;

export type FilterOptions = {
  /** 隱藏完全空白的明細列 */
  hideEmpty?: boolean;
  /** 只顯示有檢核錯誤的列 */
  onlyErrors?: boolean;
  /** 全域關鍵字：比對任一 filterable 欄位 */
  global?: string;
};

/** 欄位是否可篩選：預設 true，JSON 可設 filterable: false 關閉 */
export function isFieldFilterable(field: FormFieldDef): boolean {
  if (field.hidden) return false;
  return field.filterable !== false;
}

export function filterableDetailFields(schema: FormatSchema): FormFieldDef[] {
  return schema.form.detail.filter(isFieldFilterable);
}

export function emptyDetailFilters(schema: FormatSchema): DetailFilters {
  const out: DetailFilters = {};
  for (const f of filterableDetailFields(schema)) {
    out[f.key] = "";
  }
  return out;
}

export function hasActiveFilters(
  filters: DetailFilters,
  options: FilterOptions = {},
): boolean {
  if (options.hideEmpty || options.onlyErrors) return true;
  if ((options.global ?? "").trim()) return true;
  return Object.values(filters).some((v) => String(v ?? "").trim() !== "");
}

/** 不分大小寫的包含比對；空關鍵字視為通過 */
export function matchFieldValue(
  cell: string,
  query: string,
  field?: FormFieldDef,
): boolean {
  const q = String(query ?? "").trim();
  if (!q) return true;
  // 比對任何欄位一律先 trim（去除固定長度補齊或匯入殘留的前後空白）
  const value = String(cell ?? "").trim();
  // 金額欄：允許比對數字字串（去千分位空白）
  if (field?.inputType === "amount") {
    const nv = value.replace(/,/g, "").trim();
    const nq = q.replace(/,/g, "").trim();
    return nv.includes(nq) || value.toLowerCase().includes(q.toLowerCase());
  }
  return value.toLowerCase().includes(q.toLowerCase());
}

export type RowFilterContext = {
  schema: FormatSchema;
  filters: DetailFilters;
  options?: FilterOptions;
  /** 該列是否有錯誤（由呼叫端計算） */
  hasError?: boolean;
};

/** 單列是否通過篩選（僅明細） */
export function rowMatchesFilters(
  row: DetailRow,
  ctx: RowFilterContext,
): boolean {
  const { schema, filters, options = {} } = ctx;

  if (options.hideEmpty && isRowEmpty(row, schema)) return false;
  if (options.onlyErrors && !ctx.hasError) return false;

  const fields = filterableDetailFields(schema);

  // 各欄位 AND
  for (const field of fields) {
    const q = filters[field.key] ?? "";
    if (!matchFieldValue(row[field.key] ?? "", q, field)) return false;
  }

  // 全域：任一 filterable 欄位命中即可
  const g = (options.global ?? "").trim();
  if (g) {
    const hit = fields.some((field) =>
      matchFieldValue(row[field.key] ?? "", g, field),
    );
    if (!hit) return false;
  }

  return true;
}

export function filterDetailRows(
  rows: DetailRow[],
  schema: FormatSchema,
  filters: DetailFilters,
  options: FilterOptions = {},
  rowHasError?: (row: DetailRow, index: number) => boolean,
): { row: DetailRow; index: number }[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) =>
      rowMatchesFilters(row, {
        schema,
        filters,
        options,
        hasError: rowHasError?.(row, index) ?? false,
      }),
    );
}
