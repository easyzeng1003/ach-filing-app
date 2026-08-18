/**
 * 明細顯示＝form.detail（與 records.detail 同序）略過 hidden。
 */
import assert from "node:assert/strict";
import { loadEmbeddedFormats } from "../src/data/embedded";
import { orderDetailFieldsForEdit } from "../src/lib/ach/formDisplay";

const formats = loadEmbeddedFormats();
const r01 = formats.ACHR01!;
const p01 = formats.ACHP01!;
assert.ok(r01);
assert.ok(p01);

assert.equal(p01.form.detail[0]?.id, "TYPE");
assert.equal(p01.records.detail.fields[0]?.id, "TYPE");
assert.equal(p01.form.detail[0]?.label, p01.records.detail.fields[0]?.label);
assert.equal(p01.form.detail.length, p01.records.detail.fields.length);
assert.equal(r01.form.detail.length, r01.records.detail.fields.length);

const displayed = orderDetailFieldsForEdit(r01);
const displayedKeys = displayed.map((f) => f.key);
const p01Keys = orderDetailFieldsForEdit(p01).map((f) => f.key);

assert.deepEqual(
  displayedKeys,
  [
    "txid",
    "seq",
    "origBankCode",
    "origAccount",
    "bankCode",
    "account",
    "amount",
    "rcode",
    "taxId",
    "pdate",
    "pseq",
    "userNo",
  ],
  "顯示欄序應依 records.detail（略過 hidden）",
);
assert.deepEqual(
  p01Keys,
  [
    "txid",
    "seq",
    "origBankCode",
    "origAccount",
    "bankCode",
    "account",
    "amount",
    "taxId",
    "userNo",
  ],
  "P01 隱藏 filler 的 rcode／pdate／pseq",
);
assert.ok(!displayedKeys.includes("pschd"), "不顯示原提示交換次序");
assert.ok(!displayedKeys.includes("type"), "不顯示交易型態（literal）");

const origBank = displayed.find((f) => f.key === "origBankCode");
const origAcct = displayed.find((f) => f.key === "origAccount");
const bank = displayed.find((f) => f.key === "bankCode");
const account = displayed.find((f) => f.key === "account");
assert.equal(origBank?.label, "提出行代號");
assert.equal(origAcct?.label, "發動者帳號");
assert.equal(bank?.label, "收受者銀行代號");
assert.equal(account?.label, "收受者帳號");

console.log(`OK detail display order: R01=${displayedKeys.join(",")}`);
