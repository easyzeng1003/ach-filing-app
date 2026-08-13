import { Search } from "lucide-react";
import type { ReactNode } from "react";
import type {
  Branch,
  FormatSchema,
  FormFieldDef,
  RecordFieldDef,
} from "@/lib/ach/schema";
import { resolveSorg } from "@/lib/ach/engine";

export function formFieldByKey(
  schema: FormatSchema,
  key: string | undefined,
): FormFieldDef | undefined {
  if (!key) return undefined;
  return schema.form.header.find((f) => f.key === key);
}

export function controlHeaderDisplayValue(
  field: RecordFieldDef,
  schema: FormatSchema,
  header: Record<string, string>,
  branches: Branch[],
): string {
  switch (field.id) {
    case "BOF":
      return field.value ?? "BOF";
    case "CDATA":
      return schema.code;
    case "TDATE":
      return header.date ?? "";
    case "TTIME":
      return "（產生時）";
    case "SORG":
      if (schema.code === "ACHR01") {
        return field.value ?? "9990250";
      }
      return resolveSorg(header.bankCode ?? "", branches) || "—";
    case "RORG":
      if (schema.code === "ACHR01") {
        return (
          header.agentBank?.trim() ||
          (field.source === "header" && field.key
            ? header[field.key] ?? ""
            : "") ||
          "—"
        );
      }
      return field.value ?? "9990250";
    case "VERNO":
      return schema.version;
    default:
      if (field.source === "literal") return field.value ?? "";
      if (field.source === "header" && field.key) {
        return header[field.key] ?? "";
      }
      if (field.source === "formatCode") return schema.code;
      if (field.source === "version") return schema.version;
      if (field.fn === "sorg") {
        return resolveSorg(header.bankCode ?? "", branches) || "—";
      }
      if (field.fn === "nowHms") return "（產生時）";
      return "—";
  }
}

export function controlTrailerDisplayValue(
  field: RecordFieldDef,
  schema: FormatSchema,
  header: Record<string, string>,
  branches: Branch[],
  totalCount: number,
  totalAmount: number,
): string {
  switch (field.id) {
    case "EOF":
      return field.value ?? "EOF";
    case "CDATA":
      return schema.code;
    case "TDATE":
      return header.date ?? "";
    case "SORG":
      if (schema.code === "ACHR01") {
        return field.value ?? "9990250";
      }
      return resolveSorg(header.bankCode ?? "", branches) || "—";
    case "RORG":
      if (schema.code === "ACHR01") {
        return (
          header.agentBank?.trim() ||
          (field.source === "header" && field.key
            ? header[field.key] ?? ""
            : "") ||
          "—"
        );
      }
      return field.value ?? "9990250";
    case "TCOUNT":
      return String(totalCount);
    case "TAMT":
      return String(Math.floor(totalAmount));
    case "YDATE":
      if (field.source === "filler") return "（空白）";
      return header.ydate?.trim() || "（空白）";
    default:
      if (field.source === "literal") return field.value ?? "";
      if (field.source === "header" && field.key) {
        return header[field.key] ?? "";
      }
      if (field.source === "formatCode") return schema.code;
      if (field.fn === "sorg") {
        return resolveSorg(header.bankCode ?? "", branches) || "—";
      }
      if (field.fn === "totalCount") return String(totalCount);
      if (field.fn === "totalAmount") return String(Math.floor(totalAmount));
      if (field.source === "filler") return "（空白）";
      return "—";
  }
}

type EditHandlers = {
  header: Record<string, string>;
  errors?: Record<string, string | null | undefined>;
  onChange: (key: string, value: string) => void;
  onBlur: (field: FormFieldDef) => void;
  selectOptions?: (field: FormFieldDef) => { value: string; label: string }[];
  onPick?: (mode: "txid" | "branch", key: string) => void;
};

function CellEditable({
  formField,
  value,
  error,
  selectOptions,
  onChange,
  onBlur,
  onPick,
}: {
  formField: FormFieldDef;
  value: string;
  error?: string | null;
  selectOptions?: { value: string; label: string }[];
  onChange: (value: string) => void;
  onBlur: () => void;
  onPick?: (mode: "txid" | "branch") => void;
}) {
  if (formField.inputType === "select") {
    return (
      <select
        className={`cell-input ${error ? "err" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      >
        {(selectOptions ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex gap-0.5">
      <input
        className={`cell-input ${error ? "err" : ""}`}
        value={value}
        maxLength={formField.length || undefined}
        placeholder={formField.placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {formField.picker && onPick ? (
        <button
          type="button"
          className="btn btn-ghost px-1 py-0"
          onClick={() => onPick(formField.picker!)}
          aria-label={`搜尋${formField.label}`}
        >
          <Search className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function CellReadonly({ value }: { value: string }) {
  return (
    <span className="block px-1 py-1 font-mono text-[0.8rem] text-fg">
      {value || "—"}
    </span>
  );
}

function ControlRecordTable({
  columns,
  errorRow,
}: {
  columns: {
    key: string;
    label: string;
    minWidth?: string;
    cell: ReactNode;
  }[];
  errorRow?: (string | null | undefined)[];
}) {
  const hasError = errorRow?.some(Boolean);
  return (
    <div className="scroll-panel border-0 rounded-none">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.minWidth ? { minWidth: c.minWidth } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className={hasError ? "has-error" : undefined}>
            {columns.map((c) => (
              <td key={c.key}>{c.cell}</td>
            ))}
          </tr>
          {hasError ? (
            <tr className="has-error">
              {columns.map((c, i) => (
                <td
                  key={`err-${c.key}`}
                  className="whitespace-pre-line text-xs font-semibold text-danger"
                >
                  {errorRow?.[i] || ""}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** 控制首錄：與明細相同的橫向 data-table 排版 */
export function ControlHeaderFields({
  schema,
  header,
  branches,
  edit,
}: {
  schema: FormatSchema;
  header: Record<string, string>;
  branches: Branch[];
  edit?: EditHandlers;
}) {
  const fields = schema.records.header.fields.filter((f) => f.id !== "FILLER");
  const columns = fields.map((f) => {
    const formField =
      f.source === "header" ? formFieldByKey(schema, f.key) : undefined;
    const canEdit = Boolean(edit && formField);
    return {
      key: f.id,
      label: f.label || f.id,
      minWidth: "6.5rem",
      cell:
        canEdit && formField && edit ? (
          <CellEditable
            formField={formField}
            value={header[formField.key] ?? ""}
            error={edit.errors?.[formField.key]}
            selectOptions={edit.selectOptions?.(formField)}
            onChange={(v) => edit.onChange(formField.key, v)}
            onBlur={() => edit.onBlur(formField)}
            onPick={
              formField.picker && edit.onPick
                ? (mode) => edit.onPick!(mode, formField.key)
                : undefined
            }
          />
        ) : (
          <CellReadonly
            value={controlHeaderDisplayValue(f, schema, header, branches)}
          />
        ),
    };
  });

  const errorRow = fields.map((f) => {
    if (f.source !== "header" || !f.key || !edit) return null;
    return edit.errors?.[f.key] ?? null;
  });

  return (
    <ControlRecordTable
      columns={columns}
      errorRow={errorRow}
    />
  );
}

/** 控制尾錄：與明細相同的橫向 data-table 排版 */
export function ControlTrailerFields({
  schema,
  header,
  branches,
  totalCount,
  totalAmount,
  edit,
}: {
  schema: FormatSchema;
  header: Record<string, string>;
  branches: Branch[];
  totalCount: number;
  totalAmount: number;
  edit?: EditHandlers;
}) {
  const fields = schema.records.trailer.fields.filter((f) => f.id !== "FILLER");
  const columns = fields.map((f) => {
    const formField =
      f.source === "header" ? formFieldByKey(schema, f.key) : undefined;
    const canEdit = Boolean(edit && formField);
    return {
      key: f.id,
      label: f.label || f.id,
      minWidth:
        f.id === "TAMT" ? "7rem" : f.id === "YDATE" ? "7.5rem" : "6.5rem",
      cell:
        canEdit && formField && edit ? (
          <CellEditable
            formField={formField}
            value={header[formField.key] ?? ""}
            error={edit.errors?.[formField.key]}
            selectOptions={edit.selectOptions?.(formField)}
            onChange={(v) => edit.onChange(formField.key, v)}
            onBlur={() => edit.onBlur(formField)}
            onPick={
              formField.picker && edit.onPick
                ? (mode) => edit.onPick!(mode, formField.key)
                : undefined
            }
          />
        ) : (
          <CellReadonly
            value={controlTrailerDisplayValue(
              f,
              schema,
              header,
              branches,
              totalCount,
              totalAmount,
            )}
          />
        ),
    };
  });

  const errorRow = fields.map((f) => {
    if (f.source !== "header" || !f.key || !edit) return null;
    return edit.errors?.[f.key] ?? null;
  });

  return (
    <ControlRecordTable
      columns={columns}
      errorRow={errorRow}
    />
  );
}

