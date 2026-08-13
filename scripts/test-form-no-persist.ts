/**
 * 表單不寫入 localStorage：開啟時清除舊 key，操作後也不再持久化。
 */
import assert from "node:assert/strict";
import { loadEmbeddedFormats } from "../src/data/embedded";
import { useFormStore } from "../src/lib/ach/store";

// node 環境可能沒有 localStorage；提供最小 polyfill
if (typeof globalThis.localStorage === "undefined") {
  const map = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
assert.ok(p01);

// 模擬舊版殘留後「重新開啟」清除
localStorage.setItem(
  "ach-filing-forms-v2",
  JSON.stringify({ state: { forms: {}, workspaces: {} }, version: 0 }),
);
localStorage.setItem("ach-filing-forms-v1", "{}");
for (const key of ["ach-filing-forms-v1", "ach-filing-forms-v2"] as const) {
  localStorage.removeItem(key);
}
assert.equal(localStorage.getItem("ach-filing-forms-v2"), null);
assert.equal(localStorage.getItem("ach-filing-forms-v1"), null);

useFormStore.getState().ensureForm(p01);
assert.equal(useFormStore.getState().isWorkspaceOpen("ACHP01"), false);

useFormStore.getState().loadFromImport(
  p01,
  {
    header: {
      date: "01150820",
      txid: "704",
      bankCode: "0040000",
      account: "0000001234567890",
      taxId: "12345678",
    },
    rows: [
      {
        id: "1",
        bankCode: "8120000",
        account: "0000001234567890",
        taxId: "1",
        userNo: "U1",
        amount: "100",
      },
    ],
  },
  { fileName: "t.txt" },
);
assert.equal(useFormStore.getState().isWorkspaceOpen("ACHP01"), true);

// 不再 persist：操作後 storage 仍為空
assert.equal(localStorage.getItem("ach-filing-forms-v2"), null);
assert.equal(localStorage.getItem("ach-filing-forms-v1"), null);

useFormStore.getState().closeWorkspace(p01);
assert.equal(useFormStore.getState().isWorkspaceOpen("ACHP01"), false);

console.log("OK form-no-persist: storage cleared, no write-back");
