/**
 * R01 明細顯示：提出行在前；自收受者帳號起比照 P01 檔案欄序。
 */
import assert from "node:assert/strict";
import { loadEmbeddedFormats } from "../src/data/embedded";
import { orderDetailFieldsForEdit } from "../src/lib/ach/formDisplay";

const formats = loadEmbeddedFormats();
const r01 = formats.ACHR01!;
const p01 = formats.ACHP01!;
assert.ok(r01);
assert.ok(p01);

const displayed = orderDetailFieldsForEdit(r01);
const displayedKeys = displayed.map((f) => f.key);
const p01Keys = orderDetailFieldsForEdit(p01).map((f) => f.key);

assert.deepEqual(
  displayedKeys,
  [
    "seq",
    "txid",
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
  "自收受者帳號起應為 金額→退件理由→統編→原提示日期／序號→用戶號碼",
);
assert.deepEqual(
  p01Keys,
  [
    "seq",
    "txid",
    "origBankCode",
    "origAccount",
    "bankCode",
    "account",
    "amount",
    "taxId",
    "userNo",
  ],
  "P01 表單自收受者帳號起應為 金額→統編→用戶號碼",
);
assert.ok(!displayedKeys.includes("pschd"), "不顯示原提示交換次序");

const origBank = displayed.find((f) => f.key === "origBankCode");
const origAcct = displayed.find((f) => f.key === "origAccount");
const bank = displayed.find((f) => f.key === "bankCode");
const account = displayed.find((f) => f.key === "account");
assert.equal(origBank?.label, "提出行代號");
assert.equal(origAcct?.label, "發動者帳號");
assert.equal(bank?.label, "收受者銀行代號");
assert.equal(account?.label, "收受者帳號");

assert.ok(
  displayedKeys.indexOf("origBankCode") < displayedKeys.indexOf("bankCode"),
);
assert.ok(
  displayedKeys.indexOf("origAccount") < displayedKeys.indexOf("account"),
);

console.log(`OK detail display order: R01=${displayedKeys.join(",")}`);
