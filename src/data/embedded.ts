/**
 * 內嵌參考資料與格式定義 — 客戶版無需另外載入 JSON 檔，
 * 可直接開啟單一 HTML（file:// 或本機伺服器皆可）。
 */
import type { Branch, FormatIndex, FormatSchema, Txid } from "@/lib/ach/schema";

import txidJson from "../../public/data/txid.json";
import branchJson from "../../public/data/branch.json";
import formatIndexJson from "../../public/data/formats/index.json";
import achp01 from "../../public/data/formats/ACHP01.json";
import achr01 from "../../public/data/formats/ACHR01.json";

/** 編譯期已打包的格式 schema（新增檔案代號時在此登記） */
const BUNDLED_SCHEMAS: Record<string, FormatSchema> = {
  ACHP01: achp01 as FormatSchema,
  ACHR01: achr01 as FormatSchema,
};

export const EMBEDDED_TXIDS = txidJson as Txid[];
export const EMBEDDED_BRANCHES = branchJson as Branch[];
export const EMBEDDED_FORMAT_INDEX = formatIndexJson as FormatIndex;

export function loadEmbeddedFormats(): Record<string, FormatSchema> {
  const formats: Record<string, FormatSchema> = { ...BUNDLED_SCHEMAS };
  // 若 index 有登記但尚未 import 的，略過（避免執行期 fetch）
  for (const entry of EMBEDDED_FORMAT_INDEX.formats) {
    if (!formats[entry.code] && BUNDLED_SCHEMAS[entry.code]) {
      formats[entry.code] = BUNDLED_SCHEMAS[entry.code]!;
    }
  }
  return formats;
}

export function hasEmbeddedData(): boolean {
  return (
    EMBEDDED_TXIDS.length > 0 &&
    EMBEDDED_BRANCHES.length > 0 &&
    EMBEDDED_FORMAT_INDEX.formats.length > 0
  );
}
