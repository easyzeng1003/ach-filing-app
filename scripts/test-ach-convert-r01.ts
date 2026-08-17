/**
 * P01 ⇄ R01 轉檔煙霧測試（vite-node）
 */
import assert from "node:assert/strict";
import { convertP01ToR01, convertR01ToP01 } from "../src/lib/ach/convertR01";
import { generateFromSchema } from "../src/lib/ach/engine";
import { parseAchText } from "../src/lib/ach/import";
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
  { rcode: "04", ydate: "01150803", pdate: "01150804", agentBank: "0040000" },
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
// SORG 固定 9990250；RORG＝代表行
assert.equal(hdr.slice(23, 30), "9990250", "ACHR01 SORG fixed");
assert.equal(hdr.slice(30, 37), "0040000", "ACHR01 RORG = agentBank");

const d1 = file.lines[1]!;
assert.equal(d1[0], "R", "TYPE=R");
assert.equal(d1.slice(1, 3), "SD", "TXTYPE from txid 704");
assert.equal(d1.slice(3, 6), "704");
// SEQ
assert.equal(d1.slice(6, 14), "00000001");
// 退件對調：PBANK/PCLNO ← 原收受者；RBANK/RCLNO ← 原提出行
assert.equal(d1.slice(14, 21), "8120053");
assert.equal(d1.slice(21, 37), "0000000987654321");
assert.equal(d1.slice(37, 44), "0040000");
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

const d2 = file.lines[2]!;
assert.equal(d2[0], "R");
assert.equal(d2.slice(14, 21), "8120053", "第2列 PBANK＝該列收受者");
assert.equal(d2.slice(21, 37), "0000000111222333", "第2列 PCLNO＝該列收受者帳號");
assert.equal(d2.slice(37, 44), "0040000", "第2列 RBANK＝提出行（表頭後備）");
assert.equal(d2.slice(44, 60), "0000001234567890", "第2列 RCLNO＝發動者帳號（表頭後備）");

const trl = file.lines[3]!;
assert.equal(trl.slice(0, 3), "EOF");
assert.equal(trl.slice(3, 9), "ACHR01");
assert.equal(trl.slice(55, 63), "01150803", "YDATE");

// 每列自帶 orig（R01 再輸出／P01 列上 PBANK 不同）不可被首列蓋掉
{
  const mixedOrig: DetailRow[] = [
    {
      id: "m1",
      bankCode: "8120053",
      account: "0000000987654321",
      taxId: "A123456789",
      userNo: "USER001",
      amount: "1500",
      origBankCode: "0040000",
      origAccount: "0000001234567890",
    },
    {
      id: "m2",
      bankCode: "0070000",
      account: "0000000555666777",
      taxId: "B987654321",
      userNo: "USER002",
      amount: "200",
      origBankCode: "8120001",
      origAccount: "0000001111222333",
    },
  ];
  const mixedOut = convertP01ToR01(
    r01,
    header,
    mixedOrig,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
    { rcode: "04", pdate: "01150804", agentBank: "0040000" },
  );
  const md1 = mixedOut.files[0]!.lines[1]!;
  const md2 = mixedOut.files[0]!.lines[2]!;
  assert.equal(md1.slice(14, 21), "8120053");
  assert.equal(md1.slice(37, 44), "0040000");
  assert.equal(md1.slice(44, 60), "0000001234567890");
  assert.equal(md2.slice(14, 21), "0070000", "第2列 PBANK＝該列收受者");
  assert.equal(md2.slice(21, 37), "0000000555666777");
  assert.equal(md2.slice(37, 44), "8120001", "第2列 RBANK＝該列提出行，不可抄第1列");
  assert.equal(md2.slice(44, 60), "0000001111222333", "第2列 RCLNO＝該列發動者帳號");
}

// 匯入 P01：每列 PBANK/PCLNO 留下，轉 R01 時逐筆對調
{
  const p01Gen = generateFromSchema(
    p01,
    header,
    [
      { ...rows[0]!, id: "p1", bankCode: "0070000", account: "0000000555666777" },
      { ...rows[1]!, id: "p2", bankCode: "8120053", account: "0000000111222333" },
    ],
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  const pLines = p01Gen.lines.slice();
  // 第2列提出行／帳號改成與表頭不同（模擬檔內逐列 PBANK）
  pLines[2] =
    pLines[2]!.slice(0, 14) + "8120001" + "0000001111222333" + pLines[2]!.slice(37);
  const parsedP = parseAchText(pLines.join("\r\n") + "\r\n", p01, {
    filename: "p01-mixed-pbank.txt",
  });
  assert.equal(parsedP.rows[0]!.origBankCode, "0040000");
  assert.equal(parsedP.rows[0]!.origAccount, "0000001234567890");
  assert.equal(parsedP.rows[1]!.origBankCode, "8120001", "P01 第2列 PBANK 須留下");
  assert.equal(parsedP.rows[1]!.origAccount, "0000001111222333");
  const fromParsed = convertP01ToR01(
    r01,
    parsedP.header,
    parsedP.rows,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
    { rcode: "99", pdate: "01150804", agentBank: "0040000" },
  );
  const pd2 = fromParsed.files[0]!.lines[2]!;
  assert.equal(pd2.slice(14, 21), "8120053", "第2列對調後 PBANK＝原 RBANK");
  assert.equal(pd2.slice(21, 37), "0000000111222333", "第2列對調後 PCLNO＝原 RCLNO");
  assert.equal(pd2.slice(37, 44), "8120001", "第2列對調後 RBANK＝該列原 PBANK");
  assert.equal(pd2.slice(44, 60), "0000001111222333", "第2列對調後 RCLNO＝該列原 PCLNO");
}

// 多收受行：仍輸出單一檔（不依收受行分檔）
const multiRows: DetailRow[] = [
  { ...rows[0]!, id: "a", bankCode: "8120053" },
  { ...rows[1]!, id: "b", bankCode: "0070000", account: "0000000555666777" },
];
const multi = convertP01ToR01(r01, header, multiRows, EMBEDDED_TXIDS, EMBEDDED_BRANCHES, {
  rcode: "99",
  agentBank: "8220017",
});
assert.equal(multi.files.length, 1);
assert.equal(multi.detailCount, 2);
assert.equal(multi.files[0]!.count, 2);
assert.ok(!multi.files[0]!.filename.includes("_812"));
assert.ok(!multi.files[0]!.filename.includes("_007"));
const multiHdr = multi.files[0]!.lines[0]!;
assert.equal(multiHdr.slice(23, 30), "9990250");
assert.equal(multiHdr.slice(30, 37), "8220901", "822* → 代表行 8220901");
const multiTrl = multi.files[0]!.lines[multi.files[0]!.lines.length - 1]!;
assert.equal(multiTrl.slice(17, 24), "9990250", "EOF SORG");
assert.equal(multiTrl.slice(24, 31), "8220901", "EOF RORG");

// 空／非法 YDATE 時套用 TDATE，尾錄仍須固定 250
{
  const emptyY = generateFromSchema(
    r01,
    {
      date: "01150804",
      txid: "704",
      bankCode: "8120053",
      agentBank: "0040000",
      account: "0000000987654321",
      taxId: "12345678",
      ydate: "",
    },
    [
      {
        id: "r1",
        bankCode: "8120053",
        account: "0000000987654321",
        taxId: "A123456789",
        userNo: "U1",
        amount: "100",
        origBankCode: "0040000",
        origAccount: "0000001234567890",
        rcode: "04",
        pdate: "01150804",
        pseq: "00000001",
        pschd: "B",
      },
    ],
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  assert.ok(emptyY.lines.every((l) => l.length === 250), "empty YDATE trailer/header length");
  assert.equal(emptyY.lines.at(-1)!.slice(55, 63), "01150803", "empty YDATE → TDATE-1");

  const viaConvert = convertP01ToR01(
    r01,
    header,
    rows,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
    { rcode: "04", ydate: "01159999", pdate: "01150804", agentBank: "0040000" },
  );
  assert.equal(viaConvert.ydate, "01150803", "轉檔非法 YDATE → TDATE-1");
  assert.equal(viaConvert.files[0]!.lines.at(-1)!.slice(55, 63), "01150803");
}

// —— R01 → P01 往返 ——
{
  const back = convertR01ToP01(
    p01,
    {
      date: "01150804",
      txid: "704",
      bankCode: "8120053",
      agentBank: "0040000",
      account: "0000000987654321",
      taxId: "12345678",
      ydate: "01150803",
    },
    [
      {
        id: "r1",
        bankCode: "8120053",
        account: "0000000987654321",
        taxId: "A123456789",
        userNo: "USER001",
        amount: "1500",
        txid: "704",
        origBankCode: "0040000",
        origAccount: "0000001234567890",
        rcode: "04",
        pdate: "01150804",
        pseq: "00000001",
        pschd: "B",
      },
      {
        id: "r2",
        bankCode: "8120053",
        account: "0000000111222333",
        taxId: "B987654321",
        userNo: "USER002",
        amount: "200",
        txid: "704",
        origBankCode: "0040000",
        origAccount: "0000001234567890",
        rcode: "04",
        pdate: "01150804",
        pseq: "00000002",
        pschd: "B",
      },
    ],
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  assert.equal(back.files.length, 1);
  assert.equal(back.detailCount, 2);
  const pf = back.files[0]!;
  assert.equal(pf.presenterBank, "0040000");
  assert.ok(pf.lines.every((l) => l.length === 250));
  assert.equal(pf.lines[0]!.slice(0, 9), "BOFACHP01");
  assert.equal(pf.lines[0]!.slice(23, 30), "0040000", "P01 SORG from presenter");
  assert.equal(pf.lines[0]!.slice(30, 37), "9990250", "P01 RORG fixed");
  const pd1 = pf.lines[1]!;
  assert.equal(pd1[0], "N", "TYPE=N");
  assert.equal(pd1.slice(14, 21), "0040000", "PBANK = R01 原提示行（對調後 RBANK）");
  assert.equal(pd1.slice(21, 37), "0000001234567890", "PCLNO");
  assert.equal(pd1.slice(37, 44), "8120053", "RBANK = R01 退件行（對調後 PBANK）");
  assert.equal(pd1.slice(44, 60), "0000000987654321", "RCLNO");
  assert.equal(pd1.slice(70, 72), "  ", "RCODE cleared");
  assert.equal(pd1.slice(99, 107), "        ", "PDATE cleared");
  const ptr = pf.lines.at(-1)!;
  assert.equal(ptr.slice(0, 9), "EOFACHP01");
}

// round-trip P01→R01→P01
{
  const round = convertR01ToP01(
    p01,
    {
      date: converted.ydate ? "01150804" : "01150804",
      txid: "704",
      bankCode: file.returnBank,
      agentBank: "0040000",
      account: "",
      taxId: "12345678",
      ydate: converted.ydate,
    },
    // 從轉出 R01 明細反解（簡化：用已知欄位）
    [
      {
        id: "x1",
        bankCode: "8120053",
        account: "0000000987654321",
        taxId: "A123456789",
        userNo: "USER001",
        amount: "1500",
        txid: "704",
        origBankCode: "0040000",
        origAccount: "0000001234567890",
        rcode: "04",
        pdate: "01150804",
        pseq: "00000001",
        pschd: "B",
      },
      {
        id: "x2",
        bankCode: "8120053",
        account: "0000000111222333",
        taxId: "B987654321",
        userNo: "USER002",
        amount: "200",
        txid: "704",
        origBankCode: "0040000",
        origAccount: "0000001234567890",
        rcode: "04",
        pdate: "01150804",
        pseq: "00000002",
        pschd: "B",
      },
    ],
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  const rd1 = round.files[0]!.lines[1]!;
  assert.equal(rd1.slice(14, 21), "0040000", "round-trip P01 PBANK＝原提示行");
  assert.equal(rd1.slice(21, 37), "0000001234567890");
  assert.equal(rd1.slice(37, 44), "8120053", "round-trip P01 RBANK＝收受者");
  assert.equal(rd1.slice(44, 60), "0000000987654321");
  assert.equal(rd1.slice(60, 70), "0000001500");
}

console.log("OK convert P01⇄R01: lengths, TYPE/CDATA, bank swap, RCODE/PDATE/PSEQ/YDATE, SORG/RORG, round-trip");
