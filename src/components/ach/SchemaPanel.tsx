import { useMemo, useState } from "react";
import { Braces, CheckCircle2, AlertTriangle } from "lucide-react";
import { useRefStore } from "@/lib/ach/store";
import { assertRecordLengths } from "@/lib/ach/engine";
import { EXPORT_FORMAT_META, enabledExportFormats } from "@/lib/ach/exportFormats";
import type { FormatSchema, RecordFieldDef } from "@/lib/ach/schema";

/** 客戶靜態版（dev:web / build:customer） */
function isCustomerBuild(): boolean {
  return import.meta.env.VITE_ACH_CUSTOMER === "true";
}

function fieldDescription(f: RecordFieldDef): string {
  if (f.label) return f.label;
  if (f.source === "literal") return `固定「${f.value ?? ""}」`;
  if (f.source === "filler") return `填 ${JSON.stringify(f.fill ?? " ")}`;
  if (f.transform) return `transform:${f.transform}`;
  return f.id;
}

/** 1-based 起迄位置（含端點），例如 1-9、10-17 */
function fieldPositions(fields: RecordFieldDef[]): { start: number; end: number }[] {
  let cursor = 1;
  return fields.map((f) => {
    const start = cursor;
    const end = cursor + f.length - 1;
    cursor = end + 1;
    return { start, end };
  });
}

function FieldTable({
  title,
  fields,
  customer,
}: {
  title: string;
  fields: RecordFieldDef[];
  customer: boolean;
}) {
  const total = fields.reduce((s, f) => s + f.length, 0);
  const positions = fieldPositions(fields);

  if (customer) {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between bg-surface-2 px-3 py-2">
          <h4 className="text-sm font-bold">{title}</h4>
          <span className="font-mono text-xs text-muted">Σ {total}</span>
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="data-table text-xs">
            <thead>
              <tr>
                <th>位置</th>
                <th>長度</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                const pos = positions[i]!;
                return (
                  <tr key={`${f.id}-${i}`}>
                    <td className="font-mono whitespace-nowrap">
                      {pos.start}-{pos.end}
                    </td>
                    <td className="font-mono">{f.length}</td>
                    <td>{fieldDescription(f)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-surface-2 px-3 py-2">
        <h4 className="text-sm font-bold">{title}</h4>
        <span className="font-mono text-xs text-muted">Σ {total}</span>
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="data-table text-xs">
          <thead>
            <tr>
              <th>#</th>
              <th>欄位 ID</th>
              <th>來源</th>
              <th>長度</th>
              <th>charset</th>
              <th>pad</th>
              <th>說明</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f, i) => (
              <tr key={`${f.id}-${i}`}>
                <td className="text-faint">{i + 1}</td>
                <td className="font-mono font-semibold">{f.id}</td>
                <td>
                  <span className="badge badge-warn">{f.source}</span>
                  {f.key ? (
                    <span className="ml-1 font-mono text-muted">.{f.key}</span>
                  ) : null}
                  {f.fn ? (
                    <span className="ml-1 font-mono text-muted">(){f.fn}</span>
                  ) : null}
                </td>
                <td className="font-mono">{f.length}</td>
                <td className="font-mono">{f.charset || "—"}</td>
                <td className="font-mono">
                  {f.pad?.side ?? (f.source === "filler" ? "fill" : "—")}
                  {f.pad?.char ? `(${JSON.stringify(f.pad.char)})` : ""}
                </td>
                <td className="text-muted">{fieldDescription(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormFieldTable({ schema }: { schema: FormatSchema }) {
  const all = [
    ...schema.form.header.map((f) => ({ ...f, section: "提出資料" })),
    ...schema.form.detail.map((f) => ({ ...f, section: "明細" })),
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="bg-surface-2 px-3 py-2">
        <h4 className="text-sm font-bold">表單欄位（輸入檢核／篩選）</h4>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="data-table text-xs">
          <thead>
            <tr>
              <th>區段</th>
              <th>key</th>
              <th>標籤</th>
              <th>長度</th>
              <th>charset</th>
              <th>可篩選</th>
              <th>檢核規則</th>
            </tr>
          </thead>
          <tbody>
            {all.map((f) => (
              <tr key={`${f.section}-${f.key}`}>
                <td>{f.section}</td>
                <td className="font-mono font-semibold">{f.key}</td>
                <td>{f.label}</td>
                <td className="font-mono">{f.length}</td>
                <td className="font-mono">{f.charset}</td>
                <td className="font-mono">
                  {f.section === "明細"
                    ? f.filterable === false
                      ? "否"
                      : "是"
                    : "—"}
                </td>
                <td className="font-mono text-muted">
                  {(f.validation?.rules ?? []).map((r) => r.type).join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SchemaPanel() {
  const customer = isCustomerBuild();
  const { formats, formatList } = useRefStore();
  const list = formatList();
  const [code, setCode] = useState(list[0]?.code ?? "ACHP01");
  /** JSON 原始定義預設隱藏，避免佔滿畫面 */
  const [showJson, setShowJson] = useState(false);
  const schema = formats[code];

  const lengthCheck = useMemo(
    () => (schema ? assertRecordLengths(schema) : []),
    [schema],
  );

  const exportFmts = useMemo(
    () => (schema ? enabledExportFormats(schema) : []),
    [schema],
  );

  if (!schema) {
    return (
      <div className="card p-8 text-center text-muted">尚無格式定義</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Braces className="size-5 text-primary" />
            <div>
              <h2 className="text-lg font-bold">
                {customer ? "格式參數" : "格式參數（JSON）"}
              </h2>
            </div>
          </div>
          <select
            className="field-input w-auto min-w-48"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          >
            {list.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
        </div>

        <div
          className={`mb-4 grid gap-2 ${customer ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}
        >
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-xs text-muted">檔案代號</div>
            <div className="font-mono font-bold">{schema.code}</div>
          </div>
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-xs text-muted">{customer ? "名稱" : "簡稱"}</div>
            <div className="font-bold">
              {customer ? schema.name : schema.shortCode}
            </div>
          </div>
          <div className="rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-xs text-muted">
              {customer ? "列長" : "版次 / 列長"}
            </div>
            <div className="font-mono font-bold">
              {customer ? schema.recordLength : `${schema.version} / ${schema.recordLength}`}
            </div>
          </div>
          {!customer ? (
            <div className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="text-xs text-muted">長度檢核</div>
              {lengthCheck.length === 0 ? (
                <div className="flex items-center gap-1 font-semibold text-ok">
                  <CheckCircle2 className="size-4" /> 首／明／尾一致
                </div>
              ) : (
                <div className="flex items-center gap-1 font-semibold text-danger">
                  <AlertTriangle className="size-4" /> 不一致
                </div>
              )}
            </div>
          ) : null}
        </div>

        {!customer ? (
          <>
            <div className="mb-4 rounded-lg border border-border bg-surface-2/60 px-3 py-2">
              <div className="text-xs text-muted">成品輸出 formats.exportFormats</div>
              <div className="mt-1 flex flex-wrap gap-2">
                {exportFmts.map((f) => (
                  <span key={f} className="badge badge-ok font-mono">
                    {f} · {EXPORT_FORMAT_META[f].label}
                  </span>
                ))}
              </div>
            </div>

            {lengthCheck.length > 0 && (
              <div className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {lengthCheck.map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            )}

            <p className="mb-3 text-sm text-muted">
              明細篩選：{" "}
              <code className="font-mono text-xs">features.detailFilter</code>＋ 各明細欄{" "}
              <code className="font-mono text-xs">filterable</code>。 成品：{" "}
              <code className="font-mono text-xs">features.exportFormats</code> ={" "}
              <code className="font-mono text-xs">["txt"]</code>。
            </p>
          </>
        ) : null}
      </div>

      {!customer ? <FormFieldTable schema={schema} /> : null}

      <div className="grid gap-4 lg:grid-cols-1">
        <FieldTable
          title="控制首錄（header）"
          fields={schema.records.header.fields}
          customer={customer}
        />
        <FieldTable
          title="明細錄（detail）"
          fields={schema.records.detail.fields}
          customer={customer}
        />
        <FieldTable
          title="控制尾錄（trailer）"
          fields={schema.records.trailer.fields}
          customer={customer}
        />
      </div>

      {!customer ? (
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">JSON 原始定義（唯讀預覽）</h3>
            <button
              type="button"
              className="btn btn-secondary text-sm"
              onClick={() => setShowJson((v) => !v)}
              aria-expanded={showJson}
            >
              {showJson ? "隱藏 JSON" : "顯示 JSON"}
            </button>
          </div>
          {showJson ? (
            <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-header p-3 font-mono text-[11px] leading-relaxed text-header-fg">
              {JSON.stringify(schema, null, 2)}
            </pre>
          ) : (
            <p className="mt-2 text-sm text-muted">
              預設隱藏，避免佔用畫面；需要對照原始定義時再展開。
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
