/**
 * 明細欄位顯示順序以 ACHP01 form.detail 為準。
 */
import assert from "node:assert/strict";
import { loadEmbeddedFormats } from "../src/data/embedded";
import { orderDetailFieldsLikeP01 } from "../src/lib/ach/formDisplay";
import type { FormatSchema, FormFieldDef } from "../src/lib/ach/schema";

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
const r01 = formats.ACHR01!;
assert.ok(p01 && r01);

const p01Keys = p01.form.detail.map((f) => f.key);
assert.deepEqual(
  p01Keys,
  ["seq", "txid", "bankCode", "account", "taxId", "userNo", "amount"],
  "P01 明細顯示順序",
);

const displayed = orderDetailFieldsLikeP01(r01, p01);
const displayedKeys = displayed.map((f) => f.key);
assert.deepEqual(
  displayedKeys.slice(0, p01Keys.length),
  p01Keys,
  "R01 共用明細欄應與 P01 同序",
);
assert.ok(
  displayedKeys.includes("origBankCode"),
  "R01 專屬欄仍應出現在 P01 欄之後",
);
assert.ok(
  displayedKeys.indexOf("origBankCode") > displayedKeys.indexOf("amount"),
  "R01 專屬欄接在金額之後",
);
assert.ok(!displayedKeys.includes("pschd"), "不顯示原提示交換次序");

const bank = displayed.find((f) => f.key === "bankCode");
const account = displayed.find((f) => f.key === "account");
assert.equal(bank?.label, "收受者銀行代號");
assert.equal(account?.label, "收受者帳號");

// 刻意打亂 R01 欄序，仍應重排回 P01
const shuffled: FormatSchema = {
  ...r01,
  form: {
    ...r01.form,
    detail: [
      r01.form.detail.find((f) => f.key === "amount")!,
      r01.form.detail.find((f) => f.key === "rcode")!,
      r01.form.detail.find((f) => f.key === "seq")!,
      r01.form.detail.find((f) => f.key === "account")!,
      r01.form.detail.find((f) => f.key === "txid")!,
      r01.form.detail.find((f) => f.key === "userNo")!,
      r01.form.detail.find((f) => f.key === "bankCode")!,
      r01.form.detail.find((f) => f.key === "taxId")!,
      ...r01.form.detail.filter(
        (f) =>
          ![
            "amount",
            "rcode",
            "seq",
            "account",
            "txid",
            "userNo",
            "bankCode",
            "taxId",
          ].includes(f.key),
      ),
    ].filter(Boolean) as FormFieldDef[],
  },
};
const resorted = orderDetailFieldsLikeP01(shuffled, p01);
assert.deepEqual(
  resorted.map((f) => f.key).slice(0, p01Keys.length),
  p01Keys,
  "打亂後仍重排為 P01 順序",
);
assert.ok(resorted.some((f) => f.key === "rcode"));

console.log(
  `OK detail display order: P01=${p01Keys.join(",")} R01=${displayedKeys.join(",")}`,
);
