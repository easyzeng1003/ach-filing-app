/**
 * 表單寫入 localStorage（zustand persist）：小檔可還原；超過上限關閉工作區。
 */
import assert from "node:assert/strict";

// node 環境可能沒有 localStorage；必須在載入 store 前 polyfill
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

const STORAGE_KEY = "ach-filing-forms-v2";
localStorage.removeItem(STORAGE_KEY);
localStorage.removeItem("ach-filing-forms-v1");

const { loadEmbeddedFormats } = await import("../src/data/embedded");
const { flushFormPersist, isHiddenStandaloneFormat, useFormStore } = await import("../src/lib/ach/store");

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
assert.ok(p01);
assert.equal(isHiddenStandaloneFormat("ACHP01"), true);
assert.equal(isHiddenStandaloneFormat("ACHR01"), false);

useFormStore.setState({
  activeCode: "ACHP01",
  forms: {},
  workspaces: {},
});
localStorage.removeItem(STORAGE_KEY);

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

flushFormPersist();

const raw = localStorage.getItem(STORAGE_KEY);
assert.ok(raw, "應寫入 ach-filing-forms-v2");
const parsed = JSON.parse(raw!) as {
  state?: {
    forms?: Record<string, { rows: unknown[] }>;
    workspaces?: Record<string, { open?: boolean }>;
  };
};
assert.equal(parsed.state?.workspaces?.ACHP01?.open, true);
assert.ok(
  (parsed.state?.forms?.ACHP01?.rows.length ?? 0) >= 1,
  "persist 應含匯入明細",
);

// 超過 200 列時不殘留假 15 列編輯畫面：明細清空並關閉工作區，請重新上傳
const many = Array.from({ length: 250 }, (_, i) => ({
  id: String(i),
  bankCode: "0040000",
  account: "0000001234567890",
  taxId: "1",
  userNo: `U${i}`,
  amount: "1",
}));
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
    rows: many,
  },
  { fileName: "big.txt" },
);
assert.equal(useFormStore.getState().forms.ACHP01?.rows.length, 250);
flushFormPersist();
const rawBig = localStorage.getItem(STORAGE_KEY);
assert.ok(rawBig);
const parsedBig = JSON.parse(rawBig!) as {
  state?: {
    forms?: Record<string, { rows: unknown[] }>;
    workspaces?: Record<string, { open?: boolean }>;
  };
};
assert.equal(
  parsedBig.state?.forms?.ACHP01?.rows.length,
  0,
  "超過上限時 persist 不留明細列",
);
assert.equal(
  parsedBig.state?.workspaces?.ACHP01?.open,
  false,
  "超過上限時工作區應關閉，避免殘留假編輯畫面",
);

useFormStore.getState().closeWorkspace(p01);
assert.equal(useFormStore.getState().isWorkspaceOpen("ACHP01"), false);
flushFormPersist();
const rawClosed = localStorage.getItem(STORAGE_KEY);
assert.ok(rawClosed);
const parsedClosed = JSON.parse(rawClosed!) as {
  state?: { workspaces?: Record<string, { open?: boolean }> };
};
assert.equal(parsedClosed.state?.workspaces?.ACHP01?.open, false);

console.log("OK form-persist: write-back + large-file closes workspace");
