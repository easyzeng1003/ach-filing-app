import type { Charset, PadSpec } from "./schema";
import { padLeft, padRight, safeAlnum, safeDigits } from "./utils";

/** 依 charset 過濾輸入字元 */
export function filterByCharset(value: string, charset: Charset): string {
  const s = String(value ?? "");
  if (charset === "digit") return safeDigits(s);
  if (charset === "alnum") return safeAlnum(s);
  return s;
}

/** 表單輸入時即時過濾並截斷 */
export function sanitizeInput(
  raw: string,
  opts: { charset: Charset; length: number; inputType?: string },
): string {
  let v = filterByCharset(raw, opts.charset);
  if (opts.inputType === "amount") {
    // 金額允許一個小數點（輸入階段）
    v = String(raw ?? "").replace(/[^\d.]/g, "");
    const parts = v.split(".");
    if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
  }
  if (opts.length > 0 && opts.inputType !== "amount") {
    v = v.slice(0, opts.length);
  }
  return v;
}

export function applyPad(value: string, length: number, pad?: PadSpec): string {
  const s = String(value ?? "");
  if (!pad || pad.side === "none" || length <= 0) {
    if (length > 0 && s.length > length) return s.slice(0, length);
    return s;
  }
  const ch = pad.char ?? (pad.side === "left" ? "0" : " ");
  if (pad.side === "left") return padLeft(s, length, ch);
  return padRight(s, length, ch);
}

/** 匯出固定長度欄位：charset 過濾 → transform → pad */
export function formatExportField(
  raw: string | number,
  opts: {
    length: number;
    charset?: Charset;
    pad?: PadSpec;
    transform?: "floorInt" | "firstChar";
    fill?: string;
  },
): string {
  let s = String(raw ?? "");

  if (opts.transform === "floorInt") {
    const n = Math.floor(Number(s) || 0);
    s = String(n);
  } else if (opts.transform === "firstChar") {
    s = s.charAt(0);
  }

  if (opts.charset === "digit") s = safeDigits(s);
  else if (opts.charset === "alnum") s = safeAlnum(s);

  if (opts.fill !== undefined && s === "") {
    return (opts.fill || " ").repeat(opts.length);
  }

  const pad: PadSpec = opts.pad ?? { side: "right", char: " " };
  if (pad.side === "none") {
    // 原 VBA SafeCHR 後不強制 pad 到固定長（帳號銀行代號常直接串接）
    // 但仍需確保不超過 length
    if (s.length > opts.length) return s.slice(0, opts.length);
    return s;
  }
  return applyPad(s, opts.length, pad);
}

export function recordLengthOf(fields: { length: number }[]): number {
  return fields.reduce((sum, f) => sum + f.length, 0);
}

/** 財金規格 1-based 欄位起迄（含端點）。有 digitStart／digitEnd 時優先採用。 */
export function digitRangeOf(field: {
  length: number;
  digitStart?: number;
  digitEnd?: number;
}): { start: number; end: number } | null {
  if (
    Number.isInteger(field.digitStart) &&
    Number.isInteger(field.digitEnd) &&
    (field.digitStart as number) > 0 &&
    (field.digitEnd as number) >= (field.digitStart as number)
  ) {
    return { start: field.digitStart as number, end: field.digitEnd as number };
  }
  if (field.length > 0) {
    return { start: 1, end: field.length };
  }
  return null;
}

/** 依欄位順序推算／核對 1-based 起迄（含端點） */
export function digitRangesOf(
  fields: { length: number; digitStart?: number; digitEnd?: number }[],
): { start: number; end: number }[] {
  let cursor = 1;
  return fields.map((f) => {
    const start = Number.isInteger(f.digitStart) ? (f.digitStart as number) : cursor;
    const end = Number.isInteger(f.digitEnd)
      ? (f.digitEnd as number)
      : start + f.length - 1;
    cursor = end + 1;
    return { start, end };
  });
}
