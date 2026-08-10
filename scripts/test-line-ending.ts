/**
 * 分行符號／OS 預設煙霧測試
 */
import assert from "node:assert/strict";
import {
  detectOsLineEndingId,
  lineEndingById,
  lineEndingIdFromValue,
  withLineEnding,
  withLineEndingId,
} from "../src/lib/ach/lineEnding";
import { loadEmbeddedFormats } from "../src/data/embedded";

assert.equal(lineEndingById("crlf"), "\r\n");
assert.equal(lineEndingById("lf"), "\n");
assert.equal(lineEndingById("cr"), "\r");
assert.equal(lineEndingIdFromValue("\r\n"), "crlf");
assert.equal(lineEndingIdFromValue("\n"), "lf");

const id = detectOsLineEndingId();
assert.ok(id === "crlf" || id === "lf");

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
assert.equal(p01.lineEnding, "\r\n");
const lfSchema = withLineEndingId(p01, "lf");
assert.equal(lfSchema.lineEnding, "\n");
assert.equal(p01.lineEnding, "\r\n", "內嵌 schema 不可被改寫");
assert.notEqual(lfSchema, p01);

const same = withLineEnding(p01, "\r\n");
assert.equal(same, p01);

console.log("OK line-ending prefs:", id, "lf overlay ok");
