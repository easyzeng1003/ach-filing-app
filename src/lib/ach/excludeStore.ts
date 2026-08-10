/**
 * 排除規則（記憶體）：前端條件列或 JSON 載入
 */
import { create } from "zustand";
import {
  buildExcludeDocFromConditions,
  newExcludeCondition,
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
};

type ExcludeState = {
  conditions: ExcludeUiCondition[];
  matchMode: ExcludeMatchMode;
  /** 由條件列或 JSON 同步出的文件（供合併／轉檔套用） */
  doc: ExcludeRulesDoc | null;
  sourceName: string | null;
  lastResult: ExcludeExportResult | null;
  setMatchMode: (mode: ExcludeMatchMode) => void;
  setConditions: (conditions: ExcludeUiCondition[]) => void;
  addCondition: (key?: string) => void;
  updateCondition: (
    id: string,
    patch: Partial<Pick<ExcludeUiCondition, "key" | "value">>,
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
): ExcludeRulesDoc | null {
  try {
    return buildExcludeDocFromConditions(formatCode, conditions, matchMode);
  } catch {
    return null;
  }
}

export const useExcludeStore = create<ExcludeState>((set, get) => ({
  conditions: [newExcludeCondition()],
  matchMode: "and",
  doc: null,
  sourceName: null,
  lastResult: null,

  setMatchMode: (mode) => set({ matchMode: mode, sourceName: null }),

  setConditions: (conditions) =>
    set({
      conditions: conditions.length ? conditions : [newExcludeCondition()],
      sourceName: null,
    }),

  addCondition: (key = "") =>
    set((s) => ({
      conditions: [...s.conditions, newExcludeCondition(key)],
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
    const { conditions, matchMode } = get();
    const doc = buildExcludeDocFromConditions(
      formatCode,
      conditions,
      matchMode,
    );
    set({ doc, sourceName: null });
    return doc;
  },

  setDoc: (doc, sourceName) => {
    // JSON 載入：展開成條件列（and 取第一條；多 rule 改為 or）
    const mode: ExcludeMatchMode = doc.rules.length > 1 ? "or" : "and";
    const conditions: ExcludeUiCondition[] = [];
    if (mode === "and") {
      const rule = doc.rules[0] ?? {};
      for (const [key, value] of Object.entries(rule)) {
        conditions.push(newExcludeCondition(key, value));
      }
    } else {
      for (const rule of doc.rules) {
        const [key, value] = Object.entries(rule)[0] ?? ["", ""];
        if (key) conditions.push(newExcludeCondition(key, value));
      }
    }
    set({
      doc,
      sourceName: sourceName ?? null,
      matchMode: mode,
      conditions: conditions.length ? conditions : [newExcludeCondition()],
    });
  },

  setLastResult: (result) => set({ lastResult: result }),

  clear: () =>
    set({
      conditions: [newExcludeCondition()],
      matchMode: "and",
      doc: null,
      sourceName: null,
      lastResult: null,
    }),
}));

/** 供外部讀取目前有效 doc（條件列優先同步） */
export function resolveExcludeDoc(formatCode: string): ExcludeRulesDoc | null {
  const s = useExcludeStore.getState();
  return syncDoc(formatCode, s.conditions, s.matchMode) ?? s.doc;
}
