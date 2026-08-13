/**
 * 分割／索引／合併／大檔轉 R01 煙霧測試
 */
import assert from "node:assert/strict";
import {
  EMBEDDED_BRANCHES,
  EMBEDDED_TXIDS,
  loadEmbeddedFormats,
} from "../src/data/embedded";
import { generateFromSchema } from "../src/lib/ach/engine";
import {
  convertLargeP01FileToR01,
  mergeAchPartitions,
  parsePartitionIndex,
  partitionAchFile,
  planPartitionSizes,
  planPartitions,
  planPartitionsForEdit,
  rebuildPartitionPreservingDetails,
  stringifyPartitionIndex,
} from "../src/lib/ach/partition";
import {
  parsePartToForm,
  usePartitionStore,
  mergeSessionToFile,
} from "../src/lib/ach/partitionStore";
import type { DetailRow, HeaderValues } from "../src/lib/ach/schema";

const formats = loadEmbeddedFormats();
const p01 = formats.ACHP01!;
const r01 = formats.ACHR01!;

assert.deepEqual(planPartitionSizes(10, 3), [4, 3, 3]);
assert.deepEqual(planPartitionSizes(5, 10), [1, 1, 1, 1, 1]);
const plan = planPartitions(12_000, { chunkSize: 5_000 });
assert.equal(plan.partCount, 3);
// 檔數無上限：可超過舊的 40 包限制
const many = planPartitions(200_000, { chunkSize: 5_000 });
assert.equal(many.partCount, 40);
const more = planPartitions(250_000, { chunkSize: 5_000 });
assert.equal(more.partCount, 50);
const byCount = planPartitions(1000, { partCount: 100 });
assert.equal(byCount.partCount, 100);

const header: HeaderValues = {
  date: "01150804",
  txid: "704",
  bankCode: "0040000",
  account: "0000001234567890",
  taxId: "12345678",
};

const rows: DetailRow[] = Array.from({ length: 7 }, (_, i) => ({
  id: `r${i}`,
  bankCode: i % 2 === 0 ? "8120053" : "0070000",
  account: `000000000000${String(1000 + i).slice(-4)}`,
  taxId: "A123456789",
  userNo: `U${i}`,
  amount: String(100 * (i + 1)),
}));

const generated = generateFromSchema(
  p01,
  header,
  rows,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
assert.equal(generated.lines.length, 9); // hdr+7+trl

const file = new File([generated.content], "sample-p01.txt", {
  type: "text/plain",
});

const parts: { filename: string; content: string }[] = [];
const index = await partitionAchFile(
  file,
  p01,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  {
    partCount: 3,
    onPartition: (p) => {
      parts.push({ filename: p.filename, content: p.content });
    },
  },
);

assert.equal(index.partCount, 3);
assert.equal(index.totalDetailCount, 7);
assert.equal(parts.length, 3);
// each part: BOF + details + EOF
for (const p of parts) {
  // 不可 trimEnd 整段內容：尾錄 FILLER 空白會被吃掉
  const lines = p.content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  assert.ok(lines[0]!.startsWith("BOF"));
  assert.ok(lines[lines.length - 1]!.startsWith("EOF"));
  assert.ok(
    lines.every((l) => l.length === 250),
    `line lens: ${lines.map((l) => l.length).join(",")}`,
  );
  const tcount = lines[lines.length - 1]!.slice(31, 39);
  const detailN = lines.length - 2;
  assert.equal(Number(tcount), detailN);
}

const indexJson = stringifyPartitionIndex(index);
const parsed = parsePartitionIndex(indexJson);
const partMap = Object.fromEntries(parts.map((p) => [p.filename, p.content]));
const merged = mergeAchPartitions(
  p01,
  { index: parsed, parts: partMap },
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
assert.equal(merged.detailCount, 7);
const mergedLines = merged.content
  .replace(/\r\n/g, "\n")
  .replace(/\n$/, "")
  .split("\n");
assert.equal(mergedLines.length, 9);
assert.equal(mergedLines[0]!.slice(0, 9), "BOFACHP01");
assert.equal(Number(mergedLines[8]!.slice(31, 39)), 7);
assert.ok(mergedLines.every((l) => l.length === 250));

// 大檔轉 R01（同檔串流）
const converted = await convertLargeP01FileToR01(
  file,
  p01,
  r01,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
  { rcode: "04", ydate: "01150803", pdate: "01150804" },
);
assert.equal(converted.detailCount, 7);
assert.equal(converted.files.length, 1); // 整檔、不依收受行分檔
const allR = converted.files.reduce((s, f) => s + f.count, 0);
assert.equal(allR, 7);
for (const f of converted.files) {
  assert.ok(f.lines[0]!.includes("ACHR01"));
  assert.equal(f.lines[1]![0], "R");
  assert.ok(f.lines.every((l) => l.length === 250));
}

// 可編輯分割：每包 ≤ 5000
const editPlan = planPartitionsForEdit(12_000);
assert.ok(editPlan.partCount >= 3);
assert.ok(editPlan.sizes.every((n) => n <= 5_000));

// 分割工作區：載入第一包到表單結構
const firstParsed = parsePartToForm(p01, parts[0]!.content, parts[0]!.filename);
assert.ok(firstParsed.detailCount > 0);
assert.ok(firstParsed.rows.length >= firstParsed.detailCount);
// 交易代號以該包明細第一筆 TXID 為準
assert.equal(firstParsed.header.txid, "704");
assert.equal(index.header.txid, "704");

// 明細第一筆 TXID 變更後，分割／載入應跟第一筆走（非舊表頭殘值）
{
  const lines = generated.content
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n");
  const d0 = lines[1]!;
  // TXID 位於明細 offset 3–5（TYPE+TXTYPE 之後）
  const mutated =
    d0.slice(0, 3) + "705" + d0.slice(6);
  lines[1] = mutated;
  const mutatedFile = new File([lines.join("\r\n") + "\r\n"], "txid-first.txt");
  const mutatedParts: { filename: string; content: string }[] = [];
  const mutatedIndex = await partitionAchFile(
    mutatedFile,
    p01,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
    {
      partCount: 2,
      onPartition: (p) => {
        mutatedParts.push({ filename: p.filename, content: p.content });
      },
    },
  );
  assert.equal(mutatedIndex.header.txid, "705");
  const loaded = parsePartToForm(
    p01,
    mutatedParts[0]!.content,
    mutatedParts[0]!.filename,
  );
  assert.equal(loaded.header.txid, "705");
}

usePartitionStore.getState().startSession({
  formatCode: "ACHP01",
  sourceFilename: "sample-p01.txt",
  index: parsed,
  parts,
});
usePartitionStore.getState().setActiveIndex(0);
const saved = usePartitionStore.getState().saveFormToActivePart(
  p01,
  firstParsed.header,
  firstParsed.rows,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
assert.equal(saved.detailCount, firstParsed.detailCount);
const sess = usePartitionStore.getState().session!;
const fromSession = mergeSessionToFile(
  p01,
  sess,
  EMBEDDED_TXIDS,
  EMBEDDED_BRANCHES,
);
assert.equal(fromSession.detailCount, 7);
usePartitionStore.getState().clearSession();

// 存回／合併不得吃掉原始明細 filler（NOTE／MEMO 等非表單欄位）
{
  const lines = generated.content
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n");
  // NOTE：CNO(20) 之後 40 bytes；累計 offset 1+2+3+8+7+16+7+16+10+2+1+10+10+6+8+8+1+20 = 136
  const noteStart = 136;
  const noteMarker = "KEEP-NOTE-DATA-SHOULD-SURVIVE!!!!!"; // 33 chars
  const memoMarker = "MEMO123456"; // 10
  for (let i = 1; i < lines.length - 1; i++) {
    const d = lines[i]!;
    lines[i] =
      d.slice(0, noteStart) +
      noteMarker.padEnd(40, " ") +
      memoMarker +
      d.slice(noteStart + 50);
  }
  const withNote = lines.join("\r\n") + "\r\n";
  assert.ok(withNote.includes(noteMarker));

  const noteParts: { filename: string; content: string }[] = [];
  const noteIndex = await partitionAchFile(
    new File([withNote], "with-note-p01.txt"),
    p01,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
    {
      partCount: 2,
      onPartition: (p) => {
        noteParts.push({ filename: p.filename, content: p.content });
      },
    },
  );
  // 分割後 NOTE 仍在
  for (const p of noteParts) {
    assert.ok(
      p.content.includes(noteMarker),
      `${p.filename} 分割後遺失 NOTE`,
    );
    assert.ok(
      p.content.includes(memoMarker),
      `${p.filename} 分割後遺失 MEMO`,
    );
  }

  // 模擬表單載入→存回（舊行為 generateFromSchema 會把 NOTE 洗成空白）
  const loaded0 = parsePartToForm(
    p01,
    noteParts[0]!.content,
    noteParts[0]!.filename,
  );
  const rebuilt0 = rebuildPartitionPreservingDetails(
    p01,
    noteParts[0]!.content,
    loaded0.header,
    loaded0.rows,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  assert.ok(
    rebuilt0.content.includes(noteMarker),
    "存回分割包後 NOTE 被吃掉",
  );
  assert.ok(
    rebuilt0.content.includes(memoMarker),
    "存回分割包後 MEMO 被吃掉",
  );
  // 表單可改的欄位仍應寫入（金額）
  const rebuiltLines = rebuilt0.content
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n");
  const firstDetail = rebuiltLines[1]!;
  assert.equal(firstDetail.slice(noteStart, noteStart + 40).trimEnd(), noteMarker);
  assert.equal(firstDetail.slice(noteStart + 40, noteStart + 50), memoMarker);

  noteParts[0] = { ...noteParts[0]!, content: rebuilt0.content };

  const noteMerged = mergeAchPartitions(
    p01,
    {
      index: noteIndex,
      parts: Object.fromEntries(noteParts.map((p) => [p.filename, p.content])),
    },
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  assert.equal(noteMerged.detailCount, 7);
  assert.ok(noteMerged.content.includes(noteMarker), "合併後 NOTE 被吃掉");
  assert.ok(noteMerged.content.includes(memoMarker), "合併後 MEMO 被吃掉");
  // 每一明細列都應保留 NOTE
  const mergedDetailLines = noteMerged.content
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .filter((l) => !l.startsWith("BOF") && !l.startsWith("EOF"));
  for (const dl of mergedDetailLines) {
    assert.equal(dl.slice(noteStart, noteStart + 40).trimEnd(), noteMarker);
    assert.equal(dl.slice(noteStart + 40, noteStart + 50), memoMarker);
  }
}

// 控制首錄修改後存回：應同步到其他包；條件／合併輸出仍以來源首錄為主
{
  usePartitionStore.getState().startSession({
    formatCode: "ACHP01",
    sourceFilename: "sample-p01.txt",
    index: parsed,
    parts,
  });
  usePartitionStore.getState().setActiveIndex(0);
  const loaded = parsePartToForm(p01, parts[0]!.content, parts[0]!.filename);
  const originalBof =
    parsed.sourceHeaderLine ?? parsed.headerLine;
  const editedHeader = { ...loaded.header, date: "01150999" };
  usePartitionStore.getState().saveFormToActivePart(
    p01,
    editedHeader,
    loaded.rows,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  const after = usePartitionStore.getState().session!;
  assert.equal(after.index.header.date, "01150999");
  assert.ok(after.index.headerLine.includes("01150999"));
  assert.equal(
    after.index.sourceHeaderLine ?? originalBof,
    originalBof,
    "來源首錄不應被存回覆寫",
  );
  for (const p of after.parts) {
    const bof = p.content.replace(/\r\n/g, "\n").split("\n")[0]!;
    assert.ok(bof.includes("01150999"), `${p.filename} 首錄未同步`);
  }
  const part1 = parsePartToForm(p01, after.parts[1]!.content, after.parts[1]!.filename);
  assert.equal(part1.header.date, "01150999");
  const mergedEdited = mergeSessionToFile(
    p01,
    after,
    EMBEDDED_TXIDS,
    EMBEDDED_BRANCHES,
  );
  const mergedBof = mergedEdited.content.replace(/\r\n/g, "\n").split("\n")[0]!;
  assert.equal(mergedBof, originalBof, "合併／條件輸出 BOF 應等於來源原檔首錄");
  assert.ok(!mergedBof.includes("01150999"), "輸出首錄不應被表單編輯日期覆寫");
  usePartitionStore.getState().clearSession();
}

console.log(
  "OK partition/merge/convert-large/edit-session: parts=",
  parts.length,
  "merged=",
  merged.detailCount,
  "r01files=",
  converted.files.length,
);
