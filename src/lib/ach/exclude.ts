/**
 * 排除規則（JSON）：符合條件的明細於「輸出」時剔除
 *
 * 語意：
 * - 單一 rule 內多欄位 = AND（欄位 A 符合且 欄位 C 符合）
 * - rules 陣列 = OR（符合任一規則即排除）
 * - 比對：eq＝精確相等；like＝SQL LIKE（%／_，不分大小寫）
 * - 金額／數字欄另去千分位後再比
 */
import { parseRecordFields } from "./import";
import type { DetailRow, FormatSchema, FormFieldDef } from "./schema";

export const EXCLUDE_RULES_KIND = "ach-exclude-rules";

export type ExcludeCompareOp = "eq" | "like";

export type ExcludeFieldMatch = {
  op: ExcludeCompareOp;
  value: string;
};

/** 單一排除規則：form.detail key → 字串（視為 eq）或 { op, value } */
export type ExcludeRule = Record<string, string | ExcludeFieldMatch>;

export type ExcludeRulesDoc = {
  version: number;
  kind: typeof EXCLUDE_RULES_KIND;
  formatCode?: string;
  description?: string;
  rules: ExcludeRule[];
};

export type ExcludeFilterResult<T> = {
  kept: T[];
  excludedCount: number;
  totalBefore: number;
};

function formFieldByKey(
  schema: FormatSchema,
  key: string,
): FormFieldDef | undefined {
  return schema.form.detail.find((f) => f.key === key);
}

export function normalizeExcludeCell(
  raw: string,
  field?: FormFieldDef,
): string {
  let v = String(raw ?? "").trim();
  if (field?.inputType === "amount" || field?.charset === "digit") {
    v = v.replace(/,/g, "").replace(/\s/g, "");
  }
  return v;
}

export function normalizeExcludeMatch(
  raw: string | ExcludeFieldMatch | { like?: string; eq?: string; op?: string; value?: string } | null | undefined,
): ExcludeFieldMatch | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return null;
    return { op: "eq", value };
  }
  if (typeof raw !== "object") return null;
  const obj = raw as {
    op?: string;
    value?: string;
    like?: string;
    eq?: string;
  };
  if (typeof obj.like === "string" && obj.like.trim() && obj.value == null && obj.op == null) {
    return { op: "like", value: obj.like.trim() };
  }
  if (typeof obj.eq === "string" && obj.eq.trim() && obj.value == null && obj.op == null) {
    return { op: "eq", value: obj.eq.trim() };
  }
  const op: ExcludeCompareOp = obj.op === "like" ? "like" : "eq";
  const value = String(obj.value ?? "").trim();
  if (!value) return null;
  return { op, value };
}

/**
 * SQL LIKE：`%`＝任意字串、`_`＝單一字元；`\` 逸出。
 * 比對不分大小寫。
 */
export function matchLikePattern(actual: string, pattern: string): boolean {
  let i = 0;
  let re = "^";
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "\\") {
      i += 1;
      const next = pattern[i] ?? "";
      re += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
      continue;
    }
    if (ch === "%") {
      re += ".*";
      i += 1;
      continue;
    }
    if (ch === "_") {
      re += ".";
      i += 1;
      continue;
    }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    i += 1;
  }
  re += "$";
  try {
    return new RegExp(re, "i").test(actual);
  } catch {
    return false;
  }
}

export function matchExcludeValue(
  actualRaw: string,
  expect: ExcludeFieldMatch,
  field?: FormFieldDef,
): boolean {
  const actual = normalizeExcludeCell(actualRaw, field);
  const want = normalizeExcludeCell(expect.value, field);
  if (expect.op === "like") {
    return matchLikePattern(actual, want);
  }
  return actual === want;
}

function parseRuleObject(item: Record<string, unknown>, index: number): ExcludeRule {
  const rule: ExcludeRule = {};
  for (const [k, v] of Object.entries(item)) {
    if (v == null) continue;
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) continue;
      rule[k] = s;
      continue;
    }
    if (typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      // { op, value } 或 { like: "..." } / { eq: "..." }
      if ("value" in obj || "op" in obj) {
        const m = normalizeExcludeMatch({
          op: obj.op === "like" ? "like" : "eq",
          value: String(obj.value ?? ""),
        });
        if (m) rule[k] = m;
        continue;
      }
      if (typeof obj.like === "string" && obj.like.trim()) {
        rule[k] = { op: "like", value: obj.like.trim() };
        continue;
      }
      if (typeof obj.eq === "string" && obj.eq.trim()) {
        rule[k] = { op: "eq", value: obj.eq.trim() };
        continue;
      }
    }
    throw new Error(
      `rules[${index}].${k} 須為字串或 { "op": "eq"|"like", "value": "..." }`,
    );
  }
  return rule;
}

export function parseExcludeRules(text: string): ExcludeRulesDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("排除規則 JSON 無法解析");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("排除規則須為 JSON 物件");
  }
  const doc = raw as Record<string, unknown>;
  if (doc.kind != null && doc.kind !== EXCLUDE_RULES_KIND) {
    throw new Error(`排除規則 kind 須為 ${EXCLUDE_RULES_KIND}`);
  }
  if (!Array.isArray(doc.rules)) {
    throw new Error("排除規則須含 rules 陣列");
  }
  const rules: ExcludeRule[] = [];
  for (let i = 0; i < doc.rules.length; i++) {
    const item = doc.rules[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`rules[${i}] 須為物件（欄位 key → 值）`);
    }
    const rule = parseRuleObject(item as Record<string, unknown>, i);
    if (Object.keys(rule).length) rules.push(rule);
  }
  if (!rules.length) {
    throw new Error("排除規則 rules 為空（至少一條有效條件）");
  }
  return {
    version: Number(doc.version) || 1,
    kind: EXCLUDE_RULES_KIND,
    formatCode:
      typeof doc.formatCode === "string" ? doc.formatCode : undefined,
    description:
      typeof doc.description === "string" ? doc.description : undefined,
    rules,
  };
}

export function assertExcludeFormat(
  doc: ExcludeRulesDoc,
  formatCode: string,
): void {
  if (doc.formatCode && doc.formatCode !== formatCode) {
    throw new Error(
      `排除規則格式為 ${doc.formatCode}，與目前 ${formatCode} 不符`,
    );
  }
}

export function countExcludeRuleFields(doc: ExcludeRulesDoc): number {
  return doc.rules.reduce((n, r) => n + Object.keys(r).length, 0);
}

/** 前端條件列（下拉欄位＋運算子＋輸入值） */
export type ExcludeUiCondition = {
  id: string;
  key: string;
  op: ExcludeCompareOp;
  value: string;
};

export type ExcludeMatchMode = "and" | "or";

export function newExcludeCondition(
  key = "",
  value = "",
  op: ExcludeCompareOp = "eq",
): ExcludeUiCondition {
  return {
    id: `ex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    key,
    op,
    value,
  };
}

/**
 * 由前端條件列組出排除規則文件。
 * - and：全部條件組成單一 rule（多欄位同時符合才排除）
 * - or：每一條件各自一條 rule（符合任一即排除）
 */
export function buildExcludeDocFromConditions(
  formatCode: string,
  conditions: ExcludeUiCondition[],
  mode: ExcludeMatchMode = "and",
): ExcludeRulesDoc {
  const cleaned = conditions
    .map((c) => ({
      key: c.key.trim(),
      op: (c.op === "like" ? "like" : "eq") as ExcludeCompareOp,
      value: String(c.value ?? "").trim(),
    }))
    .filter((c) => c.key && c.value);
  if (!cleaned.length) {
    throw new Error("請至少選擇欄位並輸入排除內容");
  }
  const toMatch = (c: {
    op: ExcludeCompareOp;
    value: string;
  }): string | ExcludeFieldMatch =>
    c.op === "eq" ? c.value : { op: c.op, value: c.value };

  if (mode === "and") {
    const rule: ExcludeRule = {};
    for (const c of cleaned) rule[c.key] = toMatch(c);
    return {
      version: 1,
      kind: EXCLUDE_RULES_KIND,
      formatCode,
      rules: [rule],
    };
  }
  return {
    version: 1,
    kind: EXCLUDE_RULES_KIND,
    formatCode,
    rules: cleaned.map((c) => ({ [c.key]: toMatch(c) })),
  };
}

/** 列值是否符合單一規則（AND） */
export function rowMatchesExcludeRule(
  values: Record<string, string>,
  rule: ExcludeRule,
  schema: FormatSchema,
): boolean {
  const entries = Object.entries(rule);
  if (!entries.length) return false;
  for (const [key, expectRaw] of entries) {
    const expect = normalizeExcludeMatch(expectRaw);
    if (!expect) return false;
    const field = formFieldByKey(schema, key);
    if (!matchExcludeValue(values[key] ?? "", expect, field)) return false;
  }
  return true;
}

export function rowMatchesAnyExcludeRule(
  values: Record<string, string>,
  doc: ExcludeRulesDoc,
  schema: FormatSchema,
): boolean {
  return doc.rules.some((rule) => rowMatchesExcludeRule(values, rule, schema));
}

export function detailValuesFromRow(row: DetailRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "id") continue;
    out[k] = String(v ?? "");
  }
  return out;
}

export function detailValuesFromLine(
  schema: FormatSchema,
  line: string,
): Record<string, string> {
  const fields = parseRecordFields(line, schema.records.detail.fields);
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.source === "detail" && f.key) {
      out[f.key] = f.value;
    }
  }
  return out;
}

export function filterExcludedRows(
  schema: FormatSchema,
  rows: DetailRow[],
  doc: ExcludeRulesDoc | null | undefined,
): ExcludeFilterResult<DetailRow> {
  if (!doc?.rules.length) {
    return { kept: rows, excludedCount: 0, totalBefore: rows.length };
  }
  const kept: DetailRow[] = [];
  let excludedCount = 0;
  for (const row of rows) {
    if (rowMatchesAnyExcludeRule(detailValuesFromRow(row), doc, schema)) {
      excludedCount += 1;
    } else {
      kept.push(row);
    }
  }
  return { kept, excludedCount, totalBefore: rows.length };
}

export function filterExcludedDetailLines(
  schema: FormatSchema,
  lines: string[],
  doc: ExcludeRulesDoc | null | undefined,
): ExcludeFilterResult<string> {
  if (!doc?.rules.length) {
    return { kept: lines, excludedCount: 0, totalBefore: lines.length };
  }
  const kept: string[] = [];
  let excludedCount = 0;
  for (const line of lines) {
    if (
      rowMatchesAnyExcludeRule(detailValuesFromLine(schema, line), doc, schema)
    ) {
      excludedCount += 1;
    } else {
      kept.push(line);
    }
  }
  return { kept, excludedCount, totalBefore: lines.length };
}

export type MergeExcludeStats = {
  excludedCount: number;
  totalBefore: number;
};
