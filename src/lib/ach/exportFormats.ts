import type { DetailRow, FormatSchema, HeaderValues } from "./schema";
import { detailFieldsForDisplay } from "./formDisplay";
import type { GenerateResult } from "./engine";
import {
  formatTxTypeLabel,
  isRowEmpty,
  lookupBranch,
  lookupTxid,
} from "./engine";
import type { Branch, Txid } from "./schema";

/** 成品輸出格式：txt 固定長度、html 報表、js 資料模組 */
export type ExportFormatId = "txt" | "html" | "js";

export type ExportArtifact = {
  format: ExportFormatId;
  filename: string;
  content: string;
  mime: string;
  label: string;
};

export const EXPORT_FORMAT_META: Record<
  ExportFormatId,
  { label: string; ext: string; mime: string; description: string }
> = {
  txt: {
    label: "TXT 固定長度",
    ext: "txt",
    mime: "text/plain;charset=utf-8",
    description: "財金 ACH 上傳用固定長度文字檔",
  },
  html: {
    label: "HTML 報表",
    ext: "html",
    mime: "text/html;charset=utf-8",
    description: "可離線開啟的檢核／明細報表",
  },
  js: {
    label: "JS 資料",
    ext: "js",
    mime: "text/javascript;charset=utf-8",
    description: "ES module，含表頭、明細、固定長度列",
  },
};

/** 從 schema.features.exportFormats 讀取；預設僅 TXT */
export function enabledExportFormats(schema: FormatSchema): ExportFormatId[] {
  const raw = schema.features.exportFormats;
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return ["txt"];
  }
  const allowed: ExportFormatId[] = ["txt", "html", "js"];
  const list = raw.filter((x): x is ExportFormatId =>
    allowed.includes(x as ExportFormatId),
  );
  return list.length ? list : ["txt"];
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlReport(
  schema: FormatSchema,
  header: HeaderValues,
  rows: DetailRow[],
  result: GenerateResult,
  txids: Txid[],
  branches: Branch[],
): string {
  const nonEmpty = rows.filter((r) => !isRowEmpty(r, schema));
  const genAt = new Date().toLocaleString("zh-TW", { hour12: false });

  const headerRows = schema.form.header
    .map((f) => {
      const v = header[f.key] ?? "";
      let note = "";
      if (f.metaFrom === "txid") {
        const t = lookupTxid(v, txids);
        if (t) note = `${formatTxTypeLabel(t.type)} · ${t.name}`;
      } else if (f.metaFrom === "branch") {
        note = lookupBranch(v, branches)?.name ?? "";
      } else if (f.optionsFrom === "authOptions") {
        note = schema.authOptions?.find((o) => o.value === v)?.note ?? "";
      }
      return (
        "<tr><th>" +
        escapeHtml(f.label) +
        '</th><td class="mono">' +
        escapeHtml(v) +
        '</td><td class="muted">' +
        escapeHtml(note) +
        "</td></tr>"
      );
    })
    .join("\n");

  const detailFields = detailFieldsForDisplay(schema);
  const detailHead = detailFields
    .map((f) => "<th>" + escapeHtml(f.label) + "</th>")
    .join("");

  const detailBody = nonEmpty
    .map((row, i) => {
      const cells = detailFields
        .map((f) => {
          const align =
            f.ui?.align === "right" ? ' class="num"' : ' class="mono"';
          return (
            "<td" + align + ">" + escapeHtml(row[f.key] ?? "") + "</td>"
          );
        })
        .join("");
      const bank = lookupBranch(row.bankCode ?? "", branches)?.name ?? "";
      return (
        '<tr><td class="num">' +
        (i + 1) +
        "</td>" +
        cells +
        "<td>" +
        escapeHtml(bank) +
        "</td></tr>"
      );
    })
    .join("\n");

  const rawLines = result.lines
    .map(
      (line, i) =>
        '<tr><td class="num">' +
        (i + 1) +
        '</td><td class="mono raw">' +
        escapeHtml(line) +
        '</td><td class="num">' +
        line.length +
        "</td></tr>",
    )
    .join("\n");

  const amountPill = schema.features.sumAmount
    ? '<span class="pill">總金額 ' +
      result.amount.toLocaleString("zh-TW") +
      "</span>"
    : "";

  const emptyDetail =
    '<tr><td colspan="' +
    (detailFields.length + 2) +
    '" class="muted">無明細</td></tr>';

  return (
    "<!DOCTYPE html>\n" +
    '<html lang="zh-Hant">\n' +
    "<head>\n" +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    "<title>" +
    escapeHtml(schema.code) +
    " " +
    escapeHtml(schema.name) +
    " — 成品報表</title>\n" +
    "<style>\n" +
    ":root{--bg:#f4f1ea;--card:#fffcf7;--fg:#1c2430;--muted:#5c6672;--border:#d5cbb8;--primary:#0f5c4c;--header:#0b3d34;--header-fg:#eef8f4;--row-alt:#faf6ef;}\n" +
    "*{box-sizing:border-box;}body{margin:0;font-family:\"Noto Sans TC\",\"Microsoft JhengHei\",system-ui,sans-serif;background:var(--bg);color:var(--fg);line-height:1.5;padding:1.25rem;}\n" +
    "h1{font-size:1.35rem;margin:0 0 .25rem;}h2{font-size:1.05rem;margin:1.25rem 0 .5rem;color:var(--primary);}\n" +
    ".meta{color:var(--muted);font-size:.875rem;margin-bottom:1rem;}\n" +
    ".card{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1rem 1.15rem;margin-bottom:1rem;box-shadow:0 4px 16px rgb(28 36 48 / .06);}\n" +
    ".pills{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0;}\n" +
    ".pill{background:#d8efe7;color:var(--primary);border-radius:999px;padding:.2rem .7rem;font-size:.8rem;font-weight:600;}\n" +
    "table{width:100%;border-collapse:collapse;font-size:.875rem;}th,td{border:1px solid var(--border);padding:.4rem .55rem;text-align:left;vertical-align:top;}\n" +
    "thead th{background:var(--header);color:var(--header-fg);font-weight:600;}tbody tr:nth-child(even){background:var(--row-alt);}\n" +
    "th{font-weight:600;width:10rem;background:#f0ebe0;}\n" +
    ".mono{font-family:\"JetBrains Mono\",\"Cascadia Code\",ui-monospace,monospace;font-size:.8rem;word-break:break-all;}\n" +
    ".raw{white-space:pre-wrap;word-break:break-all;}.num{text-align:right;font-variant-numeric:tabular-nums;}\n" +
    ".muted{color:var(--muted);font-size:.8rem;}footer{margin-top:1.5rem;font-size:.75rem;color:var(--muted);text-align:center;}\n" +
    "@media print{body{background:#fff;padding:0;}.card{box-shadow:none;break-inside:avoid;}}\n" +
    "</style>\n</head>\n<body>\n" +
    '<div class="card">\n' +
    "<h1>" +
    escapeHtml(schema.shortCode) +
    " " +
    escapeHtml(schema.name) +
    "</h1>\n" +
    '<div class="meta">檔案代號 <strong class="mono">' +
    escapeHtml(schema.code) +
    "</strong> · 版次 " +
    escapeHtml(schema.version) +
    " · 列長 " +
    result.recordLength +
    " · 產生時間 " +
    escapeHtml(genAt) +
    "</div>\n" +
    '<div class="pills">' +
    '<span class="pill">明細 ' +
    result.count +
    " 筆</span>" +
    amountPill +
    '<span class="pill">輸出列 ' +
    result.lines.length +
    "（含首／尾錄）</span>" +
    '<span class="pill mono">' +
    escapeHtml(result.filename) +
    "</span></div>\n</div>\n\n" +
    '<div class="card"><h2>表頭</h2>\n<table><thead><tr><th>欄位</th><th>值</th><th>說明</th></tr></thead><tbody>\n' +
    headerRows +
    "\n</tbody></table></div>\n\n" +
    '<div class="card"><h2>明細（' +
    nonEmpty.length +
    "）</h2>\n<table><thead><tr><th>#</th>" +
    detailHead +
    "<th>銀行名稱</th></tr></thead><tbody>\n" +
    (detailBody || emptyDetail) +
    "\n</tbody></table></div>\n\n" +
    '<div class="card"><h2>固定長度輸出列（原始）</h2>\n<table><thead><tr><th>#</th><th>內容</th><th>長度</th></tr></thead><tbody>\n' +
    rawLines +
    "\n</tbody></table></div>\n\n" +
    "<footer>ACH改檔小工具 · JSON 參數化輸出 · HTML 成品</footer>\n</body>\n</html>\n"
  );
}

function buildJsModule(
  schema: FormatSchema,
  header: HeaderValues,
  rows: DetailRow[],
  result: GenerateResult,
): string {
  const nonEmpty = rows
    .filter((r) => !isRowEmpty(r, schema))
    .map((r) => {
      const o: Record<string, string> = {};
      for (const f of detailFieldsForDisplay(schema)) {
        o[f.key] = r[f.key] ?? "";
      }
      return o;
    });

  const headerObj: Record<string, string> = {};
  for (const f of schema.form.header) {
    headerObj[f.key] = header[f.key] ?? "";
  }

  const payload = {
    meta: {
      code: schema.code,
      shortCode: schema.shortCode,
      name: schema.name,
      version: schema.version,
      recordLength: schema.recordLength,
      lineEnding: schema.lineEnding,
      generatedAt: new Date().toISOString(),
      filename: result.filename,
      count: result.count,
      amount: result.amount,
    },
    header: headerObj,
    details: nonEmpty,
    lines: result.lines,
    text: result.content,
  };

  const json = JSON.stringify(payload, null, 2);
  return (
    "/**\n" +
    " * ACH 成品資料 — " +
    schema.code +
    " " +
    schema.name +
    "\n" +
    " * 由ACH改檔小工具自動產生\n" +
    " * @generated\n" +
    " */\n" +
    "export const achExport = " +
    json +
    ";\n\n" +
    "export default achExport;\n\n" +
    "/** CommonJS 相容 */\n" +
    'if (typeof module !== "undefined" && module.exports) {\n' +
    "  module.exports = achExport;\n" +
    "  module.exports.achExport = achExport;\n" +
    "  module.exports.default = achExport;\n" +
    "}\n"
  );
}

export function buildExportArtifacts(
  schema: FormatSchema,
  header: HeaderValues,
  rows: DetailRow[],
  result: GenerateResult,
  txids: Txid[],
  branches: Branch[],
  formats?: ExportFormatId[],
): ExportArtifact[] {
  const want = formats?.length ? formats : enabledExportFormats(schema);
  const base = baseName(result.filename);
  const out: ExportArtifact[] = [];

  for (const format of want) {
    const meta = EXPORT_FORMAT_META[format];
    if (format === "txt") {
      out.push({
        format,
        filename: result.filename.endsWith(".txt")
          ? result.filename
          : base + ".txt",
        content: result.content,
        mime: meta.mime,
        label: meta.label,
      });
    } else if (format === "html") {
      out.push({
        format,
        filename: base + ".html",
        content: buildHtmlReport(
          schema,
          header,
          rows,
          result,
          txids,
          branches,
        ),
        mime: meta.mime,
        label: meta.label,
      });
    } else if (format === "js") {
      out.push({
        format,
        filename: base + ".js",
        content: buildJsModule(schema, header, rows, result),
        mime: meta.mime,
        label: meta.label,
      });
    }
  }
  return out;
}
