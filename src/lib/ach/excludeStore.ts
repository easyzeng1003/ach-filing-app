/**
 * 篩選／排除規則（記憶體）：前端條件列或 JSON 載入
 */
import { create } from "zustand";
import {
  buildExcludeDocFromConditions,
  newExcludeCondition,
  normalizeExcludeMatch,
  resolveExcludeAction,
  type ExcludeActionMode,
  type ExcludeCompareOp,
  type ExcludeMatchMode,
  type ExcludeRulesDoc,
  type ExcludeUiCondition,
} from "./exclude";

export type ExcludeExportResult = {
  filename: string;
  content: string;
  totalBefore: number;
  excludedCount: number;
  detailCount: number;
  amount: number;
  /** 分割工作區套用時的包數；一般表單為 null */
  partCount: number | null;
  /** 本次套用的動作（篩選／排除） */
  action: ExcludeActionMode;
};

type ExcludeState = {
  conditions: ExcludeUiCondition[];
  matchMode: ExcludeMatchMode;
  /** exclude＝剔除符合；filter＝僅保留符合 */
  actionMode: ExcludeActionMode;
  /** 由條件列或 JSON 同步出的文件（供合併／轉檔套用） */
  doc: ExcludeRulesDoc | null;
  sourceName: string | null;
  lastResult: ExcludeExportResult | null;
  setMatchMode: (mode: ExcludeMatchMode) => void;
  setActionMode: (mode: ExcludeActionMode) => void;
  setConditions: (conditions: ExcludeUiCondition[]) => void;
  addCondition: (key?: string, op?: ExcludeCompareOp) => void;
  updateCondition: (
    id: string,
    patch: Partial<Pick<ExcludeUiCondition, "key" | "value" | "op">>,
  ) => void;
  removeCondition: (id: string) => void;
  syncDocFromConditions: (formatCode: string) => ExcludeRulesDoc;
  setDoc: (doc: ExcludeRulesDoc, sourceName?: string) => void;
  setLastResult: (result: ExcludeExportResult | null) => void;
  clear: () => void;
};

function syncDoc(
  formatCode: string,
  conditions: ExcludeUiCondition[],
  matchMode: ExcludeMatchMode,
  actionMode: ExcludeActionMode,
): ExcludeRulesDoc | null {
  try {
    return buildExcludeDocFromConditions(
      formatCode,
      conditions,
      matchMode,
      actionMode,
    );
  } catch {
    return null;
  }
}

function conditionsFromDoc(doc: ExcludeRulesDoc): ExcludeUiCondition[] {
  const mode: ExcludeMatchMode = doc.rules.length > 1 ? "or" : "and";
  const conditions: ExcludeUiCondition[] = [];
  if (mode === "and") {
    const rule = doc.rules[0] ?? {};
    for (const [key, raw] of Object.entries(rule)) {
      const m = normalizeExcludeMatch(raw);
      if (m) conditions.push(newExcludeCondition(key, m.value, m.op));
    }
  } else {
    for (const rule of doc.rules) {
      const [key, raw] = Object.entries(rule)[0] ?? ["", ""];
      const m = normalizeExcludeMatch(raw);
      if (key && m) conditions.push(newExcludeCondition(key, m.value, m.op));
    }
  }
  return conditions;
}

export const useExcludeStore = create<ExcludeState>((set, get) => ({
  conditions: [newExcludeCondition()],
  matchMode: "and",
  actionMode: "exclude",
  doc: null,
  sourceName: null,
  lastResult: null,

  setMatchMode: (mode) => set({ matchMode: mode, sourceName: null }),

  setActionMode: (mode) =>
    set({
      actionMode: mode === "filter" ? "filter" : "exclude",
      sourceName: null,
    }),

  setConditions: (conditions) =>
    set({
      conditions: conditions.length ? conditions : [newExcludeCondition()],
      sourceName: null,
    }),

  addCondition: (key = "", op = "eq") =>
    set((s) => ({
      conditions: [...s.conditions, newExcludeCondition(key, "", op)],
      sourceName: null,
    })),

  updateCondition: (id, patch) =>
    set((s) => ({
      conditions: s.conditions.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
      sourceName: null,
    })),

  removeCondition: (id) =>
    set((s) => {
      const next = s.conditions.filter((c) => c.id !== id);
      return {
        conditions: next.length ? next : [newExcludeCondition()],
        sourceName: null,
      };
    }),

  syncDocFromConditions: (formatCode) => {
    const { conditions, matchMode, actionMode } = get();
    const doc = buildExcludeDocFromConditions(
      formatCode,
      conditions,
      matchMode,
      actionMode,
    );
    set({ doc, sourceName: null });
    return doc;
  },

  setDoc: (doc, sourceName) => {
    const mode: ExcludeMatchMode = doc.rules.length > 1 ? "or" : "and";
    const conditions = conditionsFromDoc(doc);
    set({
      doc,
      sourceName: sourceName ?? null,
      matchMode: mode,
      actionMode: resolveExcludeAction(doc),
      conditions: conditions.length ? conditions : [newExcludeCondition()],
    });
  },

  setLastResult: (result) => set({ lastResult: result }),

  clear: () =>
    set({
      conditions: [newExcludeCondition()],
      matchMode: "and",
      actionMode: "exclude",
      doc: null,
      sourceName: null,
      lastResult: null,
    }),
}));

/** 供外部讀取目前有效 doc（條件列優先同步） */
export function resolveExcludeDoc(formatCode: string): ExcludeRulesDoc | null {
  const s = useExcludeStore.getState();
  return (
    syncDoc(formatCode, s.conditions, s.matchMode, s.actionMode) ?? s.doc
  );
}
