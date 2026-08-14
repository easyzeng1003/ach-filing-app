/**
 * 上傳判定：BOF／EOF CDATA + 明細 TYPE（完整欄位規則不在上傳阻斷）
 */
import assert from "node:assert/strict";
import {
  detectFormatCodesFromText,
  expectedDetailType,
  inferUniformR01ReturnBank,
  parseAchText,
} from "../src/lib/ach/import";
import {
  generateFromSchema,
  headerHasError,
  validateHeader,
} from "../src/lib/ach/engine";
import { convertP01ToR01 } from "../src/lib/ach/convertR01";
import { buildExportControlLines } from "../src/lib/ach/partition";
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

// 上傳 R01 後無條件重出：BOF 無 bankCode，須由首筆明細補參考欄，且不可當必填擋輸出
{
  const r01File = convertP01ToR01(
    r01,
    header,
    rows,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
    { rcode: "04", ydate: "01150813", pdate: "01150814", agentBank: "0040000" },
  );
  const parsedR = parseAchText(r01File.files[0]!.content, r01, {
    filename: "back.txt",
  });
  assert.equal(parsedR.errors.length, 0, parsedR.errors.join("; "));
  assert.equal(parsedR.header.agentBank, "0040000");
  assert.equal(parsedR.header.ydate, "01150813");
  assert.equal(parsedR.header.bankCode, "8120053", "R01 參考 bankCode 由首筆 PBANK 補");
  assert.equal(parsedR.header.account, "0000000987654321");

  const bankField = r01.form.header.find((f) => f.key === "bankCode");
  assert.equal(bankField?.required, false, "R01 表頭 bankCode 為參考、非必填");

  const headerErrs = validateHeader(
    r01,
    parsedR.header,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  delete headerErrs.bankCode;
  delete headerErrs.account;
  assert.equal(headerErrs.date, null, "R01 處理日期允許已發生（提回檔）");
  assert.equal(headerHasError(headerErrs), false, JSON.stringify(headerErrs));

  const regenerated = generateFromSchema(
    r01,
    { ...parsedR.header, agentBank: "0040000" },
    parsedR.rows,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  assert.ok(regenerated.lines.every((l) => l.length === 250));
  const ctrl = buildExportControlLines(r01, {
    sourceHeaderLine: parsedR.lines.find((l) => l.kind === "header")?.raw,
    sourceTrailerLine: parsedR.lines.find((l) => l.kind === "trailer")?.raw,
    header: { ...parsedR.header, agentBank: "0040000" },
    processDate: parsedR.header.date,
    agentBank: "0040000",
    detailCount: regenerated.count,
    totalAmount: regenerated.amount,
    txids: EMBEDDED_TXIDS,
    branches: EMBEDDED_BRANCHES,
  });
  assert.equal(ctrl.headerLine.length, 250);
  assert.equal(ctrl.trailerLine.length, 250);
  assert.equal(ctrl.headerLine.slice(3, 9), "ACHR01");
  assert.equal(ctrl.trailerLine.slice(55, 63), "01150813");
}

// 上傳 R01：各明細提回行代號（RBANK）相同 → 自動填代表行
{
  assert.equal(inferUniformR01ReturnBank(["0040000", "0040000"]), "0040000");
  assert.equal(inferUniformR01ReturnBank(["0040000", "8120001"]), null);
  assert.equal(inferUniformR01ReturnBank([]), null);

  const r01File = convertP01ToR01(
    r01,
    header,
    rows,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
    { rcode: "04", ydate: "01150813", pdate: "01150814", agentBank: "0040000" },
  );
  const lines = r01File.files[0]!.content
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n");
  const detail = lines[1]!;
  // RBANK 在 TYPE1+TXTYPE2+TXID3+SEQ8+PBANK7+PCLNO16 = 37
  assert.equal(detail.slice(37, 44), "0040000", "fixture RBANK = 提出行");

  /** 清空 BOF（offset 30）／EOF（offset 24，無 TTIME）的 RORG */
  const blankCtrlRorg = (line: string) =>
    line.startsWith("BOF")
      ? line.slice(0, 30) + "       " + line.slice(37)
      : line.startsWith("EOF")
        ? line.slice(0, 24) + "       " + line.slice(31)
        : line;

  // 首／尾錄 RORG 空白時，仍由明細提回行帶入
  const blankRorg = [
    blankCtrlRorg(lines[0]!),
    ...lines.slice(1, -1),
    blankCtrlRorg(lines.at(-1)!),
  ].join("\r\n") + "\r\n";
  const parsedBlank = parseAchText(blankRorg, r01, { filename: "blank-rorg.txt" });
  assert.equal(parsedBlank.errors.length, 0, parsedBlank.errors.join("; "));
  assert.equal(
    parsedBlank.header.agentBank,
    "0040000",
    "R01 代表行由統一提回行代號帶入",
  );

  // 提回行不一致：保留 BOF RORG，不覆寫
  const otherRbank = detail.slice(0, 37) + "8120001" + detail.slice(44);
  const mixed = [lines[0]!, detail, otherRbank, lines.at(-1)!].join("\r\n") + "\r\n";
  const parsedMixed = parseAchText(mixed, r01, { filename: "mixed-rbank.txt" });
  assert.equal(parsedMixed.detailCount, 2);
  assert.equal(
    parsedMixed.header.agentBank,
    "0040000",
    "提回行不一致時保留 BOF 代表行",
  );

  const blankMixed = [
    blankCtrlRorg(lines[0]!),
    detail,
    otherRbank,
    blankCtrlRorg(lines.at(-1)!),
  ].join("\r\n") + "\r\n";
  const parsedBlankMixed = parseAchText(blankMixed, r01, {
    filename: "blank-mixed.txt",
  });
  assert.equal(
    String(parsedBlankMixed.header.agentBank ?? "").trim(),
    "",
    "提回行不一致且首／尾錄無 RORG 時不填代表行",
  );

  // 大檔略過欄位解析時仍掃每一列 RBANK
  const many = [lines[0]!, ...Array(5001).fill(detail), lines.at(-1)!].join(
    "\r\n",
  ) + "\r\n";
  const parsedMany = parseAchText(many, r01, { filename: "many-r01.txt" });
  assert.equal(parsedMany.tooLargeForForm, true);
  assert.equal(parsedMany.header.agentBank, "0040000");

  const manyMixed = [
    lines[0]!,
    ...Array(5000).fill(detail),
    otherRbank,
    lines.at(-1)!,
  ].join("\r\n") + "\r\n";
  const parsedManyMixed = parseAchText(manyMixed, r01, {
    filename: "many-mixed.txt",
  });
  assert.equal(parsedManyMixed.tooLargeForForm, true);
  assert.equal(
    parsedManyMixed.header.agentBank,
    "0040000",
    "大檔提回行不一致時不覆寫 BOF RORG",
  );
}

console.log("OK upload-detect: BOF/EOF CDATA, detail TYPE gate, no full-field block on upload");
