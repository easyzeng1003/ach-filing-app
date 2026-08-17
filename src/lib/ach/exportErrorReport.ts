import type { FormatSchema } from "./schema";
import { downloadTextFile } from "./utils";

export type ExportErrorRow = { row: number; messages: string[] };

/** 輸出檢核失敗說明（表頭＋錯誤列數／訊息） */
export function buildExportErrorReport(opts: {
  schema: FormatSchema;
  headerErrors?: string[];
  rows?: ExportErrorRow[];
  extra?: string[];
}): string {
  const headerErrors = opts.headerErrors ?? [];
  const rows = opts.rows ?? [];
  const extra = opts.extra ?? [];
  const lines: string[] = [
    "ACH 輸出檢核失敗",
    `格式：${opts.schema.code}`,
    "",
  ];
  if (headerErrors.length) {
    lines.push("【表頭錯誤】");
    for (const m of headerErrors) lines.push(`- ${m}`);
    lines.push("");
  }
  if (rows.length) {
    lines.push(`【明細錯誤】共 ${rows.length} 列`);
    for (const r of rows) {
      lines.push(`第 ${r.row} 列：${r.messages.join("；")}`);
    }
    lines.push("");
    lines.push(`錯誤列數：${rows.map((r) => r.row).join("、")}`);
  }
  for (const m of extra) lines.push(m);
  if (!headerErrors.length && !rows.length && extra.length === 0) {
    lines.push("沒有可輸出的有效明細");
  }
  return lines.join("\r\n") + "\r\n";
}

export function downloadExportErrorReport(
  schema: FormatSchema,
  content: string,
): void {
  downloadTextFile(`${schema.code}_輸出錯誤.txt`, content);
}
