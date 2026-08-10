import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Combine,
  Loader2,
  Save,
  Layers,
  RotateCcw,
  ArrowLeftRight,
} from "lucide-react";
import { toast } from "sonner";
import type { Branch, DetailRow, FormatSchema, HeaderValues, Txid } from "@/lib/ach/schema";
import {
  describeSaveResult,
  saveAchFiles,
} from "@/lib/ach/desktop";
import {
  partitionIndexFilename,
  stringifyPartitionIndex,
} from "@/lib/ach/partition";
import {
  mergeSessionToFile,
  parsePartToForm,
  sessionIndex,
  usePartitionStore,
} from "@/lib/ach/partitionStore";
import { LineEndingSelect } from "./LineEndingSelect";

type Props = {
  schema: FormatSchema;
  header: HeaderValues;
  rows: DetailRow[];
  txids: Txid[];
  branches: Branch[];
  onLoadPart: (data: {
    header: HeaderValues;
    rows: DetailRow[];
    fileName: string;
  }) => void;
  /** 表單是否有未存回分割的變更（由外層追蹤） */
  formDirty?: boolean;
  onFormClean?: () => void;
  /** 清除並回到上傳（與合併全部輸出同列） */
  onClearToUpload?: () => void;
  /** 轉檔 R01（與合併全部輸出同列；僅 ACHP01） */
  onConvertR01?: () => void;
};

export function PartitionWorkspaceBar({
  schema,
  header,
  rows,
  txids,
  branches,
  onLoadPart,
  formDirty = false,
  onFormClean,
  onClearToUpload,
  onConvertR01,
}: Props) {
  const session = usePartitionStore((s) => s.session);
  const setActiveIndex = usePartitionStore((s) => s.setActiveIndex);
  const saveFormToActivePart = usePartitionStore((s) => s.saveFormToActivePart);
  const [busy, setBusy] = useState(false);

  if (!session || session.formatCode !== schema.code) return null;

  const active = session.activeIndex;
  const part =
    active != null ? session.parts[active] ?? null : null;
  const total = session.parts.length;
  const dirty = Boolean(part?.dirty || formDirty);

  async function persistActive(): Promise<boolean> {
    if (active == null) return true;
    try {
      const saved = saveFormToActivePart(
        schema,
        header,
        rows,
        txids,
        branches,
      );
      onFormClean?.();
      toast.success(
        `已存回第 ${active + 1} 包（${saved.detailCount.toLocaleString("zh-TW")} 筆）`,
      );
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "存回分割失敗");
      return false;
    }
  }

  async function switchTo(index: number) {
    if (index === active) return;
    if (index < 0 || index >= total) return;
    setBusy(true);
    try {
      if (active != null && dirty) {
        const ok = await persistActive();
        if (!ok) return;
      }
      // 存回後必須讀最新 store（控制首錄已同步到各包）
      const sess = usePartitionStore.getState().session;
      if (!sess) return;
      const target = sess.parts[index]!;
      const parsed = parsePartToForm(schema, target.content, target.filename);
      // 控制首錄以工作區索引為準（切換包不回溯）
      const headerForForm = {
        ...parsed.header,
        ...sess.index.header,
        // 明細第一筆 TXID 仍優先（分割可能跨交易代號）
        ...(parsed.header.txid ? { txid: parsed.header.txid } : {}),
      };
      onLoadPart({
        header: headerForForm,
        rows: parsed.rows,
        fileName: target.filename,
      });
      setActiveIndex(index);
      onFormClean?.();
      toast.message(
        `已載入第 ${index + 1}/${total} 包（${parsed.detailCount.toLocaleString("zh-TW")} 筆），可編輯`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "載入分割失敗");
    } finally {
      setBusy(false);
    }
  }

  async function handleMergeExport() {
    setBusy(true);
    try {
      if (active != null && dirty) {
        const ok = await persistActive();
        if (!ok) return;
      }
      const sess = usePartitionStore.getState().session;
      if (!sess) return;
      const merged = mergeSessionToFile(schema, sess, txids, branches);
      const index = sessionIndex(sess);
      const base =
        sess.sourceFilename.replace(/\.[^.]+$/, "") || schema.code;
      const saved = await saveAchFiles(
        [
          { filename: merged.filename, content: merged.content },
          {
            filename: partitionIndexFilename(sess.sourceFilename),
            content: stringifyPartitionIndex(index),
            mime: "application/json;charset=utf-8",
          },
        ],
        { zipName: `${base}.merged.zip` },
      );
      if (saved.method === "canceled") {
        toast.message("已取消儲存");
        return;
      }
      toast.success(
        `已合併 ${merged.detailCount.toLocaleString("zh-TW")} 筆 · ${describeSaveResult(saved)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "合併失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">
            分割工作區
            {active != null ? (
              <span className="font-normal text-muted">
                {" "}
                · 第 {active + 1}/{total} 包
                {dirty ? " · 未存回" : ""}
              </span>
            ) : (
              <span className="font-normal text-muted">
                {" "}
                · 共 {total} 包，請選擇要編輯的包
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted">
            {part
              ? `${part.filename} · ${part.detailCount.toLocaleString("zh-TW")} 筆 · 序號 ${part.seqFrom}–${part.seqTo}`
              : session.sourceFilename}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost !px-2"
            disabled={busy || active == null || active <= 0}
            onClick={() => void switchTo((active ?? 0) - 1)}
            title="上一包"
          >
            <ChevronLeft className="size-4" />
          </button>
          <select
            className="max-w-[10rem] rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs"
            disabled={busy}
            value={active ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") return;
              void switchTo(Number(v));
            }}
          >
            <option value="" disabled>
              選擇包…
            </option>
            {session.parts.map((p, i) => (
              <option key={p.filename} value={i}>
                {i + 1}/{total} · {p.detailCount} 筆
                {p.dirty ? " *" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost !px-2"
            disabled={busy || active == null || active >= total - 1}
            onClick={() => void switchTo((active ?? 0) + 1)}
            title="下一包"
          >
            <ChevronRight className="size-4" />
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || active == null}
            onClick={() => void persistActive()}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            存回此包
          </button>
          <LineEndingSelect compact />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleMergeExport()}
          >
            <Combine className="size-4" />
            合併全部輸出
          </button>
          {onConvertR01 ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={onConvertR01}
              title="轉檔 R01"
            >
              <ArrowLeftRight className="size-4" />
              轉檔 R01
            </button>
          ) : null}
          {onClearToUpload ? (
            <button
              type="button"
              className="btn btn-ghost text-danger"
              disabled={busy}
              onClick={onClearToUpload}
              title="清除並回到上傳"
            >
              <RotateCcw className="size-4" />
              清除並回到上傳
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
