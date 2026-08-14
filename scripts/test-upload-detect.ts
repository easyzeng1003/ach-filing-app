/**
 * 上傳判定：BOF／EOF CDATA + 明細 TYPE（完整欄位規則不在上傳阻斷）
 */
import assert from "node:assert/strict";
import {
  detectFormatCodesFromText,
  expectedDetailType,
  parseAchText,
} from "../src/lib/ach/import";
import { generateFromSchema } from "../src/lib/ach/engine";
import {
  EMBEDDED_BRANCHES,
  EMBEDDED_TXIDS,
  loadEmbeddedFormats,
} from "../src/data/embedded";
import type { DetailRow, HeaderValues } from "../src/lib/ach/schema";

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
const r01 = formats.ACHR01!;

assert.equal(expectedDetailType(p01), "N");
assert.equal(expectedDetailType(r01), "R");

const header: HeaderValues = {
  date: "01150804",
  txid: "704",
  bankCode: "0040000",
  account: "0000001234567890",
  taxId: "12345678",
};
const rows: DetailRow[] = [
  {
    id: "r1",
    bankCode: "8120053",
    account: "0000000987654321",
    taxId: "A123456789",
    userNo: "USER001",
    amount: "1500",
  },
];

const p01Out = generateFromSchema(p01, header, rows, EMBEDDED_TXIDS, EMBEDDED_BRANCHES);
const detectedP = detectFormatCodesFromText(p01Out.content);
assert.equal(detectedP.bofCode, "ACHP01");
assert.equal(detectedP.eofCode, "ACHP01");
assert.equal(detectedP.code, "ACHP01");

const parsedP = parseAchText(p01Out.content, p01, { filename: "p.txt" });
assert.equal(parsedP.errors.length, 0, parsedP.errors.join("; "));
assert.equal(parsedP.detailCount, 1);

// 用 R01 schema 解析 P01 內容 → TYPE=N 不符 R → error
const mismatch = parseAchText(p01Out.content, r01, { filename: "p-as-r.txt" });
assert.ok(
  mismatch.errors.some((e) => e.includes("TYPE") && e.includes("不符")),
  mismatch.errors.join("; "),
);

// BOF／EOF CDATA 不一致
{
  const lines = p01Out.content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const badEof = "EOFACHR01" + lines.at(-1)!.slice(9);
  const mixed = [...lines.slice(0, -1), badEof].join("\r\n") + "\r\n";
  const codes = detectFormatCodesFromText(mixed);
  assert.equal(codes.bofCode, "ACHP01");
  assert.equal(codes.eofCode, "ACHR01");
  const parsed = parseAchText(mixed, p01, { filename: "mixed.txt" });
  assert.ok(
    parsed.errors.some((e) => e.includes("不一致")),
    parsed.errors.join("; "),
  );
}

// 僅有 EOF（無 BOF）仍可由 EOF 判定代號
{
  const lines = p01Out.content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const noBof = lines.slice(1).join("\r\n") + "\r\n";
  const codes = detectFormatCodesFromText(noBof);
  assert.equal(codes.bofCode, null);
  assert.equal(codes.eofCode, "ACHP01");
  assert.equal(codes.code, "ACHP01");
}

console.log("OK upload-detect: BOF/EOF CDATA, detail TYPE gate, no full-field block on upload");
