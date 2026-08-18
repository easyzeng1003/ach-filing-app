/**
 * 明細顯示欄＝來源格式 JSON 的 form.detail（略過 hidden），不在 TS 寫死欄序。
 */
import assert from "node:assert/strict";
import { loadEmbeddedFormats } from "../src/data/embedded";
import {
  detailFieldsForDisplay,
  resolveDetailDisplaySchema,
} from "../src/lib/ach/formDisplay";

const formats = loadEmbeddedFormats();
const r01 = formats.ACHR01!;
const p01 = formats.ACHP01!;
assert.ok(r01);
assert.ok(p01);

function visibleKeys(schema: typeof p01): string[] {
  return schema.form.detail.filter((f) => f.hidden !== true).map((f) => f.key);
}

assert.equal(p01.form.detail[0]?.id, "TYPE");
assert.equal(p01.records.detail.fields[0]?.id, "TYPE");
assert.equal(p01.form.detail.length, p01.records.detail.fields.length);
assert.equal(r01.form.detail.length, r01.records.detail.fields.length);

for (const schema of [p01, r01]) {
  schema.form.detail.forEach((f, i) => {
    const rec = schema.records.detail.fields[i];
    assert.equal(f.id, rec?.id, `${schema.code} form.detail[${i}] id`);
  });
  assert.deepEqual(
    detailFieldsForDisplay(schema).map((f) => f.key),
    visibleKeys(schema),
    `${schema.code} 顯示欄須等於 JSON form.detail 去掉 hidden`,
  );
}

assert.equal(
  resolveDetailDisplaySchema(r01, formats, "ACHP01").code,
  "ACHP01",
  "上傳 P01 後顯示欄參照 ACHP01.json",
);
assert.equal(
  resolveDetailDisplaySchema(r01, formats, "ACHR01").code,
  "ACHR01",
  "上傳 R01 後顯示欄參照 ACHR01.json",
);
assert.equal(
  resolveDetailDisplaySchema(r01, formats, undefined).code,
  "ACHR01",
  "無來源代號時用工作區 schema",
);

assert.deepEqual(
  detailFieldsForDisplay(
    resolveDetailDisplaySchema(r01, formats, "ACHP01"),
  ).map((f) => f.key),
  visibleKeys(p01),
);

const displayed = detailFieldsForDisplay(r01);
assert.ok(!displayed.some((f) => f.key === "type"), "hidden TYPE 不進畫面");
assert.ok(!displayed.some((f) => f.key === "pschd"), "hidden PSCHD 不進畫面");

const origBank = displayed.find((f) => f.key === "origBankCode");
const account = displayed.find((f) => f.key === "account");
assert.equal(origBank?.label, "提出行代號");
assert.equal(account?.label, "收受者帳號");

console.log(
  `OK detail display from JSON: P01=${visibleKeys(p01).join(",")} R01=${visibleKeys(r01).join(",")}`,
);
