/**
 * ACH 輸出分行符號（依 OS／使用者選擇）
 */
import type { FormatSchema } from "./schema";

export type LineEndingId = "crlf" | "lf" | "cr";

export type LineEndingOption = {
  id: LineEndingId;
  value: "\r\n" | "\n" | "\r";
  label: string;
  shortLabel: string;
};

export const LINE_ENDING_OPTIONS: readonly LineEndingOption[] = [
  {
    id: "crlf",
    value: "\r\n",
    label: "Windows (CRLF)",
    shortLabel: "Windows",
  },
  {
    id: "lf",
    value: "\n",
    label: "macOS／Linux (LF)",
    shortLabel: "macOS／Linux",
  },
  {
    id: "cr",
    value: "\r",
    label: "舊版 Mac (CR)",
    shortLabel: "舊版 Mac",
  },
] as const;

export function lineEndingById(id: LineEndingId): "\r\n" | "\n" | "\r" {
  return (
    LINE_ENDING_OPTIONS.find((o) => o.id === id)?.value ??
    LINE_ENDING_OPTIONS[0]!.value
  );
}

export function lineEndingIdFromValue(value: string): LineEndingId {
  if (value === "\n") return "lf";
  if (value === "\r") return "cr";
  return "crlf";
}

/** 依瀏覽器／OS 推斷預設分行符號：Windows→CRLF，其餘→LF */
export function detectOsLineEndingId(): LineEndingId {
  if (typeof navigator === "undefined") return "crlf";
  const platform =
    (
      navigator as Navigator & {
        userAgentData?: { platform?: string };
      }
    ).userAgentData?.platform ||
    navigator.platform ||
    "";
  const ua = navigator.userAgent || "";
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "crlf";
  return "lf";
}

/** 淺拷貝 schema，覆寫 lineEnding（不改動內嵌 JSON 參照） */
export function withLineEnding(
  schema: FormatSchema,
  ending: string,
): FormatSchema {
  if ((schema.lineEnding || "\r\n") === ending) return schema;
  return { ...schema, lineEnding: ending };
}

export function withLineEndingId(
  schema: FormatSchema,
  id: LineEndingId,
): FormatSchema {
  return withLineEnding(schema, lineEndingById(id));
}
