/**
 * R01 明細顯示：提示行在前，提回行在後。
 */
import assert from "node:assert/strict";
import { loadEmbeddedFormats } from "../src/data/embedded";
import { orderDetailFieldsForEdit } from "../src/lib/ach/formDisplay";

const formats = loadEmbeddedFormats();
const r01 = formats.ACHR01!;
assert.ok(r01);

const displayed = orderDetailFieldsForEdit(r01);
const displayedKeys = displayed.map((f) => f.key);

assert.deepEqual(
  displayedKeys.slice(0, 6),
  ["seq", "txid", "origBankCode", "origAccount", "bankCode", "account"],
  "提示行（orig*）須在提回行（bankCode/account）之前",
);
assert.ok(!displayedKeys.includes("pschd"), "不顯示原提示交換次序");

const origBank = displayed.find((f) => f.key === "origBankCode");
const origAcct = displayed.find((f) => f.key === "origAccount");
const bank = displayed.find((f) => f.key === "bankCode");
const account = displayed.find((f) => f.key === "account");
assert.equal(origBank?.label, "提示行代號");
assert.equal(origAcct?.label, "提示行帳號");
assert.equal(bank?.label, "提回行代號");
assert.equal(account?.label, "提回行帳號");

assert.ok(
  displayedKeys.indexOf("origBankCode") < displayedKeys.indexOf("bankCode"),
);
assert.ok(
  displayedKeys.indexOf("origAccount") < displayedKeys.indexOf("account"),
);

console.log(`OK detail display order: R01=${displayedKeys.join(",")}`);
