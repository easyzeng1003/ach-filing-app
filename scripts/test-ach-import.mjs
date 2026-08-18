/**
 * ACH 匯入：依 JSON records 切片後還原表單欄位（產生→解析 roundtrip）
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = "/workspace/public/data/formats";
const index = JSON.parse(fs.readFileSync(path.join(root, "index.json"), "utf8"));

function pad(value, length, side = "right", char = " ") {
  let s = String(value ?? "");
  if (s.length > length) return s.slice(0, length);
  if (side === "none") return s;
  if (side === "left") return s.padStart(length, char);
  return s.padEnd(length, char);
}

function fieldValue(f, ctx) {
  if (f.source === "literal") return pad(f.value ?? "", f.length, "right", " ");
  if (f.source === "formatCode") return pad(ctx.code, f.length, "right", " ");
  if (f.source === "version") return pad(ctx.version, f.length, "right", " ");
  if (f.source === "filler") return (f.fill ?? " ").repeat(f.length);
  if (f.source === "runtime") return pad(ctx.nowHms ?? "120000", f.length, "left", "0");
  if (f.source === "derived") {
    const map = {
      sorg: ctx.sorg,
      txType: ctx.txType,
      seq: ctx.seq,
      totalCount: ctx.totalCount,
      totalAmount: ctx.totalAmount,
    };
    const side = f.pad?.side ?? "left";
    const ch = f.pad?.char ?? "0";
    return pad(map[f.fn] ?? "", f.length, side, ch);
  }
  if (f.source === "header" || f.source === "detail") {
    const bag = f.source === "header" ? ctx.header : ctx.detail;
    const raw = bag?.[f.key] ?? "";
    let side = f.pad?.side ?? "right";
    let ch = f.pad?.char ?? (side === "left" ? "0" : " ");
    if (f.transform === "floorInt") {
      return pad(
        String(Math.floor(Number(raw) || 0)),
        f.length,
        side === "none" ? "left" : side,
        ch || "0",
      );
    }
    if (f.transform === "firstChar") {
      return pad(String(raw).charAt(0), f.length, "right", " ");
    }
    // 測試用：pad none 仍補滿，確保列長正確
    if (side === "none") {
      side = f.charset === "digit" ? "left" : "right";
      ch = f.charset === "digit" ? "0" : " ";
    }
    return pad(raw, f.length, side, ch);
  }
  return " ".repeat(f.length);
}

function buildLine(fields, ctx) {
  return fields.map((f) => fieldValue(f, ctx)).join("");
}

function unpad(raw, def) {
  let s = raw ?? "";
  const padSpec = def.pad ?? { side: "right", char: " " };
  if (def.transform === "firstChar") return s.trim().charAt(0);
  if (padSpec.side === "right" || !def.pad) s = s.replace(/[ \t]+$/g, "");
  if (
    def.transform === "floorInt" ||
    (padSpec.side === "left" && (padSpec.char ?? "0") === "0")
  ) {
    if (
      def.transform === "floorInt" ||
      ["totalCount", "totalAmount", "seq"].includes(def.fn)
    ) {
      const t = s.replace(/^0+/, "");
      return t === "" ? "0" : t;
    }
  }
  return s.replace(/[ \t]+$/g, "");
}

function parseLine(line, fields) {
  const header = {};
  const detail = {};
  let offset = 0;
  for (const def of fields) {
    const raw = line.slice(offset, offset + def.length);
    offset += def.length;
    if (def.source === "header" && def.key) header[def.key] = unpad(raw, def);
    if (def.source === "detail" && def.key) detail[def.key] = unpad(raw, def);
  }
  return { header, detail };
}

function detectCode(text) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith("BOF"));
  return line ? line.slice(3, 9).trim() : null;
}

for (const entry of index.formats) {
  const schema = JSON.parse(
    fs.readFileSync(path.join(root, entry.schemaFile), "utf8"),
  );

  const header = {
    date: "01150804",
    txid: "704",
    bankCode: "0040000",
    account: "0000001234567890",
    taxId: "12345678",
    admark: "A",
  };
  const detailA = {
    seq: "1",
    txid: "704",
    origBankCode: "0040000",
    origAccount: "0000001234567890",
    bankCode: "0040037",
    account: "0000009988776655",
    taxId: "A123456789",
    userNo: "USER001",
    amount: "1000",
  };
  const detailB = {
    seq: "2",
    txid: "704",
    origBankCode: "0040000",
    origAccount: "0000001234567890",
    bankCode: "0040071",
    account: "0000001122334455",
    taxId: "87654321",
    userNo: "USER002",
    amount: "500",
  };

  const baseCtx = {
    code: schema.code,
    version: schema.version,
    header,
    sorg: "0040000",
    txType: "NC",
    nowHms: "153045",
    totalCount: "2",
    totalAmount: "1500",
  };

  const lines = [
    buildLine(schema.records.header.fields, { ...baseCtx, seq: "0", detail: {} }),
    buildLine(schema.records.detail.fields, {
      ...baseCtx,
      seq: "1",
      detail: detailA,
    }),
    buildLine(schema.records.detail.fields, {
      ...baseCtx,
      seq: "2",
      detail: detailB,
    }),
    buildLine(schema.records.trailer.fields, {
      ...baseCtx,
      seq: "0",
      detail: {},
    }),
  ];

  for (const line of lines) {
    assert.equal(
      line.length,
      schema.recordLength,
      `${schema.code} built line length ${line.length}`,
    );
  }

  const content = lines.join("\r\n") + "\r\n";
  assert.equal(detectCode(content), schema.code);

  const fromHeaderLine = parseLine(lines[0], schema.records.header.fields).header;
  const fromDetail1 = parseLine(lines[1], schema.records.detail.fields);
  const recoveredHeader = { ...fromHeaderLine, ...fromDetail1.header };

  assert.equal(recoveredHeader.date, "01150804", `${schema.code} date`);
  if (recoveredHeader.bankCode !== undefined) {
    assert.equal(recoveredHeader.bankCode, "0040000", `${schema.code} header bank`);
  }
  // ACHP01 可從 detail.PCLNO 還原公司帳號；ACHP02 檔內無此欄位
  const hasHeaderAccount = schema.records.detail.fields.some(
    (f) => f.source === "header" && f.key === "account",
  );
  if (hasHeaderAccount) {
    assert.equal(
      recoveredHeader.account,
      "0000001234567890",
      `${schema.code} header account`,
    );
  }
  if (schema.form.detail.some((f) => f.key === "txid")) {
    assert.equal(fromDetail1.detail.txid, "704", `${schema.code} detail txid`);
  } else if (schema.form.header.some((f) => f.key === "txid")) {
    assert.equal(recoveredHeader.txid, "704", `${schema.code} txid`);
  }
  if (schema.form.detail.some((f) => f.key === "seq")) {
    assert.equal(
      String(Number(fromDetail1.detail.seq)),
      "1",
      `${schema.code} detail seq`,
    );
  }

  if (fromDetail1.detail.origBankCode !== undefined) {
    assert.equal(
      fromDetail1.detail.origBankCode,
      "0040000",
      `${schema.code} detail origBankCode`,
    );
    assert.equal(
      fromDetail1.detail.origAccount,
      "0000001234567890",
      `${schema.code} detail origAccount`,
    );
  }
  assert.equal(fromDetail1.detail.bankCode, "0040037");
  assert.equal(fromDetail1.detail.account, "0000009988776655");
  assert.equal(fromDetail1.detail.userNo, "USER001");
  if (schema.features.amountKey) {
    assert.equal(fromDetail1.detail.amount, "1000");
  }

  console.log(
    `OK import ${schema.code} details=2 recordLength=${schema.recordLength}`,
  );
}

console.log("ACH import roundtrip smoke tests passed");
