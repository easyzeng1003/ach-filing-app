/**
 * 編輯畫面只留 R01：明細欄＝ACHR01.json form.detail（略過 hidden）。
 */
import assert from "node:assert/strict";
import { loadEmbeddedFormats } from "../src/data/embedded";
import { detailFieldsForDisplay } from "../src/lib/ach/formDisplay";
import { isHiddenStandaloneFormat } from "../src/lib/ach/store";

const formats = loadEmbeddedFormats();
const r01 = formats.ACHR01!;
const p01 = formats.ACHP01!;
assert.ok(r01);
assert.ok(p01);

assert.equal(isHiddenStandaloneFormat("ACHP01"), true, "P01 不提供獨立編輯頁");
assert.equal(isHiddenStandaloneFormat("ACHR01"), false);

function visibleKeys(schema: typeof r01): string[] {
  return schema.form.detail.filter((f) => f.hidden !== true).map((f) => f.key);
}

assert.equal(p01.form.detail[0]?.id, "TYPE");
assert.equal(r01.form.detail[0]?.id, "TYPE");
assert.equal(p01.form.detail.length, p01.records.detail.fields.length);
assert.equal(r01.form.detail.length, r01.records.detail.fields.length);

r01.form.detail.forEach((f, i) => {
  const rec = r01.records.detail.fields[i];
  assert.equal(f.id, rec?.id, `ACHR01 form.detail[${i}] id`);
});

const displayed = detailFieldsForDisplay(r01);
assert.deepEqual(
  displayed.map((f) => f.key),
  visibleKeys(r01),
  "編輯欄須等於 ACHR01.json form.detail 去掉 hidden",
);
assert.ok(!displayed.some((f) => f.key === "type"), "hidden TYPE 不進畫面");
assert.ok(!displayed.some((f) => f.key === "pschd"), "hidden PSCHD 不進畫面");
assert.ok(
  displayed.some((f) => f.key === "rcode"),
  "R01 編輯頁含退件理由",
);

const origBank = displayed.find((f) => f.key === "origBankCode");
const account = displayed.find((f) => f.key === "account");
assert.equal(origBank?.label, "提出行代號");
assert.equal(account?.label, "收受者帳號");

console.log(`OK R01-only edit columns: ${visibleKeys(r01).join(",")}`);
