/**
 * 排除後輸出 R01：轉檔前須套用 filterExcludedRows，筆數應少於整檔。
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
import { convertP01ToR01, convertR01ToP01 } from "../src/lib/ach/convertR01";
import {
  generateFromSchema,
  sumDetailRecordAmounts,
} from "../src/lib/ach/engine";
import { adaptP01ImportToR01, parseAchText } from "../src/lib/ach/import";
import { buildExportControlLines } from "../src/lib/ach/partition";
import type { DetailRow, HeaderValues } from "../src/lib/ach/schema";

function eofTamt(lines: string[]): number {
  const eof = lines.find((l) => l.startsWith("EOF"));
  assert.ok(eof, "missing EOF");
  return Number(eof.slice(39, 55));
}

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

const converted = convertP01ToR01(
  r01,
  header,
  filtered.kept,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  { rcode: "04", agentBank: "0040000" },
);
assert.equal(converted.detailCount, 2);
assert.equal(converted.files[0]!.lines[0]!.slice(23, 30), "9990250");
assert.equal(converted.files[0]!.lines[0]!.slice(30, 37), "0040000");
assert.equal(eofTamt(converted.files[0]!.lines), 5000, "R01 EOF TAMT after exclude");
assert.equal(
  sumDetailRecordAmounts(converted.files[0]!.lines, r01),
  5000,
  "R01 detail AMT sum after exclude",
);

const r01Form = adaptP01ImportToR01(
  parseAchText(gen.content, p01, { filename: "p01.txt" }),
  r01,
);
const r01Filtered = filterExcludedRows(
  r01,
  r01Form.rows,
  buildExcludeDocFromConditions(
    "ACHR01",
    [newExcludeCondition("amount", "1000", "eq")],
    "or",
  ),
);
assert.equal(r01Filtered.kept.length, 2);
const backToP01 = convertR01ToP01(
  p01,
  r01Form.header,
  r01Filtered.kept,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  { date: header.date },
);
assert.equal(eofTamt(backToP01.files[0]!.lines), 5000, "P01 EOF TAMT after exclude");
assert.equal(
  sumDetailRecordAmounts(backToP01.files[0]!.lines, p01),
  5000,
);

const fullP01 = generateFromSchema(
  p01,
  header,
  rows,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
assert.equal(eofTamt(fullP01.lines), 6000);
const keptP01 = generateFromSchema(
  p01,
  header,
  filtered.kept,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
const rebuilt = buildExportControlLines(p01, {
  sourceHeaderLine: fullP01.lines[0],
  sourceTrailerLine: fullP01.lines[fullP01.lines.length - 1],
  header,
  detailCount: keptP01.count,
  totalAmount: keptP01.amount,
  txids: EMBEDDED_TXIDS,
  branches: EMBEDDED_BRANCHES,
});
assert.equal(eofTamt([rebuilt.trailerLine]), 5000, "rebuilt EOF must not keep source TAMT");
assert.notEqual(eofTamt([rebuilt.trailerLine]), eofTamt(fullP01.lines));

const padded = [
  ...rows,
  { id: "empty-a", bankCode: "", account: "", taxId: "", userNo: "", amount: "" },
  { id: "empty-b", bankCode: "", account: "", taxId: "", userNo: "", amount: "" },
];
const filteredSkipEmpty = filterExcludedRows(p01, padded, doc);
assert.equal(filteredSkipEmpty.totalBefore, 3, "empty buffer rows excluded from total");
assert.equal(filteredSkipEmpty.kept.length, 2);

const decimals = generateFromSchema(
  p01,
  header,
  [
    { ...rows[0]!, amount: "1500.9" },
    { ...rows[1]!, amount: "200.2" },
  ],
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
assert.equal(eofTamt(decimals.lines), 1700, "TAMT = sum of floored AMT, not float sum");
assert.equal(sumDetailRecordAmounts(decimals.lines, p01), 1700);

console.log(
  "OK r01-exclude: before=",
  rows.length,
  "excluded=",
  filtered.excludedCount,
  "r01=",
  converted.detailCount,
  "tamt=",
  eofTamt(converted.files[0]!.lines),
);
