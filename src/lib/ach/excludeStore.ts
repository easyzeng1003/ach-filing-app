/**
 * 排除規則（僅記憶體；載入 JSON 後於輸出時套用）
 */
import { create } from "zustand";
import type { ExcludeRulesDoc } from "./exclude";

type ExcludeState = {
  doc: ExcludeRulesDoc | null;
  sourceName: string | null;
  setDoc: (doc: ExcludeRulesDoc, sourceName?: string) => void;
  clear: () => void;
};

export const useExcludeStore = create<ExcludeState>((set) => ({
  doc: null,
  sourceName: null,
  setDoc: (doc, sourceName) =>
    set({
      doc,
      sourceName: sourceName ?? null,
    }),
  clear: () => set({ doc: null, sourceName: null }),
}));
