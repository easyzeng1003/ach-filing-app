/**
 * P01 → R01 轉檔煙霧測試（vite-node）
 */
import assert from "node:assert/strict";
import { convertP01ToR01 } from "../src/lib/ach/convertR01";
import { generateFromSchema } from "../src/lib/ach/engine";
import { loadEmbeddedFormats, EMBEDDED_TXIDS, EMBEDDED_BRANCHES } from "../src/data/embedded";
import type { DetailRow, HeaderValues } from "../src/lib/ach/schema";

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
const r01 = formats.ACHR01!;
assert.ok(p01 && r01, "schemas loaded");

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
  {
    id: "r2",
    bankCode: "8120053",
    account: "0000000111222333",
    taxId: "B987654321",
    userNo: "USER002",
    amount: "200",
  },
];

// 先確認 P01 可正常產生
const p01Out = generateFromSchema(p01, header, rows, EMBEDDED_TXIDS, EMBEDDED_BRANCHES);
assert.equal(p01Out.lines[0]!.slice(0, 9), "BOFACHP01");
assert.equal(p01Out.lines[1]![0], "N");
assert.equal(p01Out.lines.every((l) => l.length === 250), true);

const converted = convertP01ToR01(
  r01,
  header,
  rows,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  { rcode: "04", ydate: "01150803", pdate: "01150804" },
);

assert.equal(converted.files.length, 1);
assert.equal(converted.detailCount, 2);
assert.equal(converted.rcode, "04");
assert.equal(converted.ydate, "01150803");

const file = converted.files[0]!;
assert.equal(file.returnBank, "8120053");
assert.equal(file.lines.length, 4); // header + 2 detail + trailer
assert.ok(file.lines.every((l) => l.length === 250), "record length 250");

const hdr = file.lines[0]!;
assert.equal(hdr.slice(0, 3), "BOF");
assert.equal(hdr.slice(3, 9), "ACHR01");
assert.equal(hdr.slice(9, 17), "01150804");

const d1 = file.lines[1]!;
assert.equal(d1[0], "R", "TYPE=R");
assert.equal(d1.slice(1, 3), "SD", "TXTYPE from txid 704");
assert.equal(d1.slice(3, 6), "704");
// SEQ
assert.equal(d1.slice(6, 14), "00000001");
// PBANK = 原 RBANK（退件行）
assert.equal(d1.slice(14, 21), "8120053");
// PCLNO = 原 RCLNO
assert.equal(d1.slice(21, 37), "0000000987654321");
// RBANK = 原 PBANK
assert.equal(d1.slice(37, 44), "0040000");
// RCLNO = 原 PCLNO
assert.equal(d1.slice(44, 60), "0000001234567890");
// AMT
assert.equal(d1.slice(60, 70), "0000001500");
// RCODE
assert.equal(d1.slice(70, 72), "04");
// SCHD
assert.equal(d1.slice(72, 73), "B");
// CID
assert.equal(d1.slice(73, 83), "12345678  ");
// PID
assert.equal(d1.slice(83, 93), "A123456789");
// PDATE
assert.equal(d1.slice(99, 107), "01150804");
// PSEQ = 原序號
assert.equal(d1.slice(107, 115), "00000001");
// PSCHD
assert.equal(d1.slice(115, 116), "B");

const trl = file.lines[3]!;
assert.equal(trl.slice(0, 3), "EOF");
assert.equal(trl.slice(3, 9), "ACHR01");
assert.equal(trl.slice(55, 63), "01150803", "YDATE");

// 多收受行：仍輸出單一檔（不依收受行分檔）
const multiRows: DetailRow[] = [
  { ...rows[0]!, id: "a", bankCode: "8120053" },
  { ...rows[1]!, id: "b", bankCode: "0070000", account: "0000000555666777" },
];
const multi = convertP01ToR01(r01, header, multiRows, EMBEDDED_TXIDS, EMBEDDED_BRANCHES, {
  rcode: "99",
});
assert.equal(multi.files.length, 1);
assert.equal(multi.detailCount, 2);
assert.equal(multi.files[0]!.count, 2);
assert.ok(!multi.files[0]!.filename.includes("_812"));
assert.ok(!multi.files[0]!.filename.includes("_007"));

console.log("OK convert P01→R01: lengths, TYPE/CDATA, bank swap, RCODE/PDATE/PSEQ/YDATE");
