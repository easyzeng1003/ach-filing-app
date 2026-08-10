/**
 * 使用者偏好（localStorage）
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  detectOsLineEndingId,
  type LineEndingId,
} from "./lineEnding";

type PrefsState = {
  /** 輸出檔分行符號；首次依 OS 推斷 */
  lineEnding: LineEndingId;
  setLineEnding: (id: LineEndingId) => void;
};

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      lineEnding: detectOsLineEndingId(),
      setLineEnding: (id) => set({ lineEnding: id }),
    }),
    {
      name: "ach-filing-prefs-v1",
      partialize: (s) => ({ lineEnding: s.lineEnding }),
    },
  ),
);
