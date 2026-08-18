/**
 * 篩選／排除規則 JSON 煙霧測試
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMBEDDED_BRANCHES, EMBEDDED_TXIDS, loadEmbeddedFormats } from "../src/data/embedded";
import {
  generateFromSchema,
  sumDetailRecordAmounts,
} from "../src/lib/ach/engine";
import {
  buildExcludeDocFromConditions,
  filterExcludedDetailLines,
  filterExcludedRows,
  matchLikeIncludes,
  newExcludeCondition,
  parseExcludeRules,
  resolveExcludeAction,
  rowMatchesExcludeRule,
} from "../src/lib/ach/exclude";
import {
  mergeAchPartitions,
  partitionAchFile,
} from "../src/lib/ach/partition";
import type { DetailRow, HeaderValues } from "../src/lib/ach/schema";

const example = readFileSync(
  new URL("../public/data/exclude-rules.example.json", import.meta.url),
  "utf8",
);
const doc = parseExcludeRules(example);
assert.equal(doc.kind, "ach-exclude-rules");
assert.ok(doc.rules.length >= 2);

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;

assert.equal(
  rowMatchesExcludeRule(
    { bankCode: "0040000", amount: "0000001000", account: "x" },
    { bankCode: "0040000", amount: "1000" },
    p01,
  ),
  true,
  "amount eq must ignore leading zeros",
);
assert.equal(
  rowMatchesExcludeRule(
    { bankCode: "0040000", amount: "1000", account: "x" },
    { bankCode: "0040000", amount: "1000" },
    p01,
  ),
  true,
);
assert.equal(
  rowMatchesExcludeRule(
    { bankCode: "0040000", amount: "2000" },
    { bankCode: "0040000", amount: "1000" },
    p01,
  ),
  false,
);

assert.equal(matchLikeIncludes("0000001234567890", "1234567890"), true);
assert.equal(matchLikeIncludes("ABCDE", "bcd"), true);
assert.equal(matchLikeIncludes("abc", "A_C"), false);
assert.equal(matchLikeIncludes("a_c", "A_C"), true);
assert.equal(matchLikeIncludes("100%", "%"), true);
assert.equal(matchLikeIncludes("1000", "100%"), false);
assert.equal(matchLikeIncludes("hello", ""), false);

assert.equal(
  rowMatchesExcludeRule(
    { account: "0000001234567890" },
    { account: { op: "like", value: "7890" } },
    p01,
  ),
  true,
);
assert.equal(
  rowMatchesExcludeRule(
    { userNo: "U12" },
    { userNo: { like: "U1" } },
    p01,
  ),
  true,
);
assert.equal(
  rowMatchesExcludeRule(
    { userNo: "X12" },
    { userNo: { like: "U1" } },
    p01,
  ),
  false,
);

const header: HeaderValues = {
  date: "01150804",
  txid: "704",
  bankCode: "0040000",
  account: "0000001234567890",
  taxId: "12345678",
};

const rows: DetailRow[] = [
  {
    id: "1",
    bankCode: "0040000",
    account: "0000000000001001",
    taxId: "A123456789",
    userNo: "U0",
    amount: "1000",
  },
  {
    id: "2",
    bankCode: "8120053",
    account: "0000001234567890",
    taxId: "A123456789",
    userNo: "U1",
    amount: "200",
  },
  {
    id: "3",
    bankCode: "0070000",
    account: "0000000000001003",
    taxId: "A123456789",
    userNo: "U2",
    amount: "300",
  },
];

assert.equal(resolveExcludeAction(doc), "exclude", "example defaults to exclude");
assert.equal(doc.action, "exclude");

const filtered = filterExcludedRows(p01, rows, doc);
// rule1 bank+amount → row1; rule2 account → row2; row3 kept
assert.equal(filtered.excludedCount, 2);
assert.equal(filtered.kept.length, 1);
assert.equal(filtered.kept[0]!.id, "3");

const filterDoc = { ...doc, action: "filter" as const };
assert.equal(resolveExcludeAction(filterDoc), "filter");
const keepMatches = filterExcludedRows(p01, rows, filterDoc);
assert.equal(keepMatches.kept.length, 2, "filter keeps matching rows");
assert.equal(keepMatches.excludedCount, 1, "filter drops non-matching");
assert.deepEqual(
  keepMatches.kept.map((r) => r.id).sort(),
  ["1", "2"],
);

const generated = generateFromSchema(
  p01,
  header,
  rows,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
const file = new File([generated.content], "ex.txt");
const parts: { filename: string; content: string }[] = [];
const index = await partitionAchFile(
  file,
  p01,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  {
    partCount: 2,
    onPartition: (p) => parts.push({ filename: p.filename, content: p.content }),
  },
);
const partMap = Object.fromEntries(parts.map((p) => [p.filename, p.content]));
const merged = mergeAchPartitions(
  p01,
  { index, parts: partMap },
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  { exclude: doc },
);
assert.equal(merged.totalBeforeExclude, 3);
assert.equal(merged.excludedCount, 2);
assert.equal(merged.detailCount, 1);
assert.equal(merged.amount, 300, "merge exclude TAMT = kept AMT");
{
  const eof = merged.content
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .find((l) => l.startsWith("EOF"));
  assert.ok(eof);
  assert.equal(Number(eof.slice(39, 55)), 300, "merged EOF TAMT after exclude");
  const details = merged.content
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .filter((l) => !l.startsWith("BOF") && !l.startsWith("EOF"));
  assert.equal(sumDetailRecordAmounts(details, p01), 300);
}
assert.equal(parts.length, 2, "應涵蓋多個分割包");
assert.equal(
  parts.reduce((n, p) => {
    const lines = p.content
      .replace(/\r\n/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .filter((l) => !l.startsWith("BOF") && !l.startsWith("EOF"));
    return n + lines.length;
  }, 0),
  merged.totalBeforeExclude,
  "排除前筆數須等於全部分割包明細合計",
);

const mergedFilter = mergeAchPartitions(
  p01,
  { index, parts: partMap },
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  { exclude: filterDoc },
);
assert.equal(mergedFilter.detailCount, 2, "merge filter keeps matches");
assert.equal(mergedFilter.excludedCount, 1);
assert.equal(mergedFilter.amount, 1200, "merge filter TAMT = 1000+200");
{
  const eof = mergedFilter.content
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .find((l) => l.startsWith("EOF"));
  assert.ok(eof);
  assert.equal(Number(eof.slice(39, 55)), 1200, "merged EOF TAMT after filter");
}

const lineFilter = filterExcludedDetailLines(
  p01,
  generated.content
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .filter((l) => !l.startsWith("BOF") && !l.startsWith("EOF")),
  doc,
);
assert.equal(lineFilter.excludedCount, 2);
assert.equal(lineFilter.kept.length, 1);

const uiDoc = buildExcludeDocFromConditions(
  "ACHP01",
  [
    newExcludeCondition("bankCode", "0040000"),
    newExcludeCondition("amount", "1000"),
  ],
  "and",
);
assert.equal(uiDoc.rules.length, 1);
assert.equal(uiDoc.rules[0]!.bankCode, "0040000");
assert.equal(uiDoc.action, "exclude");
assert.equal(resolveExcludeAction(undefined), "exclude");
assert.equal(resolveExcludeAction(null), "exclude");

const uiFilterDoc = buildExcludeDocFromConditions(
  "ACHP01",
  [newExcludeCondition("bankCode", "0040000")],
  "and",
  "filter",
);
assert.equal(uiFilterDoc.action, "filter");

const likeDoc = buildExcludeDocFromConditions(
  "ACHP01",
  [newExcludeCondition("account", "7890", "like")],
  "or",
);
assert.deepEqual(likeDoc.rules[0]!.account, {
  op: "like",
  value: "7890",
});
const likeFiltered = filterExcludedRows(p01, rows, likeDoc);
assert.equal(likeFiltered.excludedCount, 1);
assert.equal(likeFiltered.kept.length, 2);

console.log(
  "OK exclude-rules: excluded=",
  merged.excludedCount,
  "kept=",
  merged.detailCount,
  "filterKept=",
  keepMatches.kept.length,
);
