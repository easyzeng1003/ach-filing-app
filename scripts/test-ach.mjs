import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "/workspace/public/data/formats";
const dataRoot = "/workspace/public/data";
const index = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"));

for (const entry of index.formats) {
  const schema = JSON.parse(
    fs.readFileSync(path.join(root, entry.schemaFile), "utf8"),
  );
  assert.equal(schema.code, entry.code);
  for (const section of ["header", "detail", "trailer"]) {
    const len = schema.records[section].fields.reduce((s, f) => s + f.length, 0);
    assert.equal(
      len,
      schema.recordLength,
      `${schema.code} ${section} length ${len} != ${schema.recordLength}`,
    );
  }
  // form detail fields must have charset + length
  for (const f of schema.form.detail) {
    assert.ok(f.key && f.length > 0, `${schema.code} detail field`);
    assert.ok(["digit", "alnum", "any"].includes(f.charset), `charset ${f.key}`);
  }
  console.log(`OK ${schema.code} recordLength=${schema.recordLength} form.detail=${schema.form.detail.length}`);
}

// ACHP01：控制首錄／尾錄對照財金建檔小程式；TXTYPE＝SD 代收／SC 代付
const achp01 = JSON.parse(fs.readFileSync(path.join(root, "ACHP01.json"), "utf8"));
const hdr = achp01.records.header.fields.map((f) => f.id);
const trl = achp01.records.trailer.fields.map((f) => f.id);
assert.deepEqual(
  hdr.slice(0, 7),
  ["BOF", "CDATA", "TDATE", "TTIME", "SORG", "RORG", "VERNO"],
  "ACHP01 header field order",
);
assert.deepEqual(
  trl.slice(0, 8),
  ["EOF", "CDATA", "TDATE", "SORG", "RORG", "TCOUNT", "TAMT", "YDATE"],
  "ACHP01 trailer field order",
);
const txTypeField = achp01.records.detail.fields.find((f) => f.id === "TXTYPE");
assert.equal(txTypeField?.fn, "txType");
assert.equal(txTypeField?.length, 2);

const txids = JSON.parse(fs.readFileSync(path.join(dataRoot, "txid.json"), "utf8"));
const byType = txids.reduce((acc, t) => {
  (acc[t.type] ??= []).push(t);
  return acc;
}, {});
assert.ok((byType.SD?.length ?? 0) >= 100, `SD txids expected, got ${byType.SD?.length}`);
assert.ok((byType.SC?.length ?? 0) >= 100, `SC txids expected, got ${byType.SC?.length}`);
assert.equal(txids.find((t) => t.code === "704")?.type, "SD", "704 應為代收 SD");
assert.equal(txids.find((t) => t.code === "101")?.type, "SC", "101 應為代付 SC");

const userNo = achp01.form.detail.find((f) => f.key === "userNo");
const userRules = userNo?.validation?.rules ?? [];
assert.ok(
  userRules.some((r) => r.type === "requiredIfTxType" && r.txTypes?.includes("SD")),
  "userNo 應僅在 SD 代收時必填",
);
const txidRules =
  achp01.form.header.find((f) => f.key === "txid")?.validation?.rules ?? [];
assert.ok(
  !txidRules.some((r) => r.minValue != null),
  "ACHP01 不應再限制交易代號 ≥500（需支援 SC 代付）",
);

console.log(
  `OK ACHP01 SD/SC: SD=${byType.SD.length} SC=${byType.SC.length}; header/trailer field order matched`,
);

// ACHR01：提回／退件（TYPE=R、退件欄、YDATE）
const achr01 = JSON.parse(fs.readFileSync(path.join(root, "ACHR01.json"), "utf8"));
assert.equal(achr01.code, "ACHR01");
const rType = achr01.records.detail.fields.find((f) => f.id === "TYPE");
assert.equal(rType?.value, "R");
const rcode = achr01.records.detail.fields.find((f) => f.id === "RCODE");
assert.equal(rcode?.source, "detail");
assert.equal(rcode?.key, "rcode");
const pbank = achr01.records.detail.fields.find((f) => f.id === "PBANK");
assert.equal(pbank?.source, "detail");
assert.equal(pbank?.key, "bankCode");
const rbank = achr01.records.detail.fields.find((f) => f.id === "RBANK");
assert.equal(rbank?.key, "origBankCode");
const ydate = achr01.records.trailer.fields.find((f) => f.id === "YDATE");
assert.equal(ydate?.source, "header");
assert.equal(ydate?.key, "ydate");
assert.ok(
  achr01.form.detail.some((f) => f.key === "rcode"),
  "ACHR01 form 應含 rcode",
);
const p01DetailKeys = achp01.form.detail.map((f) => f.key);
const r01SharedKeys = p01DetailKeys.filter((k) =>
  achr01.form.detail.some((f) => f.key === k),
);
const r01Prefix = achr01.form.detail
  .map((f) => f.key)
  .filter((k) => r01SharedKeys.includes(k));
assert.deepEqual(
  r01Prefix,
  r01SharedKeys,
  "ACHR01 form.detail 共用欄順序應與 ACHP01 相同",
);
console.log("OK ACHR01 return schema: TYPE=R, RCODE/PDATE/PSEQ, YDATE from header");

console.log("ACH JSON schema smoke tests passed");
