/**
 * R01 整檔：即使有排除條件，轉檔仍應使用完整明細（不套用 filterExcludedRows）。
 */
import assert from "node:assert/strict";
import {
  EMBEDDED_BRANCHES,
  EMBEDDED_TXIDS,
  loadEmbeddedFormats,
} from "../src/data/embedded";
import {
  buildExcludeDocFromConditions,
  filterExcludedRows,
  newExcludeCondition,
} from "../src/lib/ach/exclude";
import { convertP01ToR01 } from "../src/lib/ach/convertR01";
import { generateFromSchema } from "../src/lib/ach/engine";
import type { DetailRow, HeaderValues } from "../src/lib/ach/schema";

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
const r01 = formats.ACHR01!;

const header: HeaderValues = {
  date: "01150820",
  txid: "704",
  bankCode: "0040000",
  account: "0000001234567890",
  taxId: "12345678",
};

const rows: DetailRow[] = [
  {
    id: "1",
    bankCode: "8120000",
    account: "0000001234567890",
    taxId: "11111111",
    userNo: "U001",
    amount: "1000",
  },
  {
    id: "2",
    bankCode: "8120000",
    account: "0000001234567891",
    taxId: "22222222",
    userNo: "U002",
    amount: "2000",
  },
  {
    id: "3",
    bankCode: "0040000",
    account: "0000009999999999",
    taxId: "33333333",
    userNo: "U003",
    amount: "3000",
  },
];

const gen = generateFromSchema(p01, header, rows, EMBEDDED_TXIDS, EMBEDDED_BRANCHES);
assert.equal(gen.count, 3);

const doc = buildExcludeDocFromConditions(
  "ACHP01",
  [newExcludeCondition("amount", "1000", "eq")],
  "or",
);
const filtered = filterExcludedRows(p01, rows, doc);
assert.equal(filtered.excludedCount, 1);
assert.equal(filtered.kept.length, 2);

// 模擬修正後的 handleConvertToR01：一律整檔
const full = convertP01ToR01(r01, header, rows, EMBEDDED_TXIDS, EMBEDDED_BRANCHES, {
  rcode: "04",
});
assert.equal(full.detailCount, 3);

// 舊行為（套用排除）會變少筆 —— 用來對照
const oldBehavior = convertP01ToR01(
  r01,
  header,
  filtered.kept,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  { rcode: "04" },
);
assert.equal(oldBehavior.detailCount, 2);

console.log(
  "OK r01-full-file: full=",
  full.detailCount,
  "after-exclude-would-be=",
  oldBehavior.detailCount,
);
