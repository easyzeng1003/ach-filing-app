import { useEffect, useMemo, useRef, useState, useDeferredValue, startTransition, memo, type CSSProperties } from "react";
import {
  Backdrop,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  TablePagination,
  Typography,
} from "@mui/material";
import {
  FileUpload as FileUpIcon,
  FilterAltOff as FilterXIcon,
  CloudUpload as UploadIcon,
  ArrowForward as ArrowRightIcon,
  RestartAlt as RestartAltIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import {
  useFormStore,
  useRefStore,
} from "@/lib/ach/store";
import type { FormatSchema } from "@/lib/ach/schema";
import { detailFieldsForDisplay } from "@/lib/ach/formDisplay";
import { convertP01ToR01, convertR01ToP01 } from "@/lib/ach/convertR01";
import {
  filterExcludedRows,
  resolveExcludeAction,
  type ExcludeRulesDoc,
} from "@/lib/ach/exclude";
import { resolveExcludeDoc, useExcludeStore } from "@/lib/ach/excludeStore";
import { withLineEndingId } from "@/lib/ach/lineEnding";
import { usePrefsStore } from "@/lib/ach/prefsStore";
import {
  generateFromSchema,
  headerHasError,
  isRowEmpty,
  rowErrorMessages,
  syncHeaderFromDetails,
  validateDetailRow,
  validateHeader,
} from "@/lib/ach/engine";
import {
  buildExportErrorReport,
  downloadExportErrorReport,
  formatExportErrorRowRef,
} from "@/lib/ach/exportErrorReport";
import { safeDigits } from "@/lib/ach/utils";
import {
  emptyDetailFilters,
  filterDetailRows,
  hasActiveFilters,
  isFieldFilterable,
  type DetailFilters,
  type FilterOptions,
} from "@/lib/ach/filter";
import {
  parseAchFile,
  resolveImportSchemaFromFile,
  inferUniformR01ReturnBank,
  IMPORT_LIMITS,
  type ImportProgress,
  type ImportResult,
} from "@/lib/ach/import";
import {
  describeSaveResult,
  saveAchFiles,
} from "@/lib/ach/desktop";
import { CodePicker } from "./CodePicker";
import { ConvertR01Dialog } from "./ConvertR01Dialog";
import { ExcludeExportPanel } from "./ExcludeExportPanel";
import { ImportPreviewDialog } from "./ImportPreviewDialog";
import { LineEndingSelect } from "./LineEndingSelect";
import { PartitionToolsDialog } from "./PartitionToolsDialog";
import { PartitionWorkspaceBar } from "./PartitionWorkspaceBar";
import {
  collectSessionRows,
  mergeSessionToFile,
  splitFileAndStartEdit,
  usePartitionStore,
} from "@/lib/ach/partitionStore";
import {
  buildExportControlLines,
  headerFromLine,
  type PartitionProgress,
} from "@/lib/ach/partition";

type Props = {
  schema: FormatSchema;
  /** 匯入偵測到其他檔案代號時，切換到對應分頁 */
  onSelectFormat?: (code: string) => void;
};

const DETAIL_PAGE_SIZES = [50, 100, 200, 500] as const;
type DetailPageSize = (typeof DETAIL_PAGE_SIZES)[number];
const DEFAULT_DETAIL_PAGE_SIZE: DetailPageSize = 50;

const hiddenFileInputStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function FormatPanel({ schema, onSelectFormat }: Props) {
  const { txids, branches, formats } = useRefStore();
  const {
    ensureForm,
    getForm,
    setHeader,
    blurHeader,
    updateRow,
    blurRow,
    pasteRows,
    loadFromImport,
    isWorkspaceOpen,
    getWorkspace,
    closeWorkspace,
  } = useFormStore();
  const clearPartitionSession = usePartitionStore((s) => s.clearSession);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  /** 收受行代表行代號（輸出 ACHR01 的 RORG） */
  const [agentBank, setAgentBank] = useState("");
  const [partitionTools, setPartitionTools] = useState<{
    mode: "split" | "convert";
  } | null>(null);
  const [partitionFormDirty, setPartitionFormDirty] = useState(false);
  const partitionSession = usePartitionStore((s) => s.session);
  const markPartitionDirty = usePartitionStore((s) => s.markActiveDirty);

  const workspaceOpen = isWorkspaceOpen(schema.code);
  const workspace = getWorkspace(schema.code);

  const [picker, setPicker] = useState<{
    mode: "txid" | "branch";
    target: "header" | "row";
    key: string;
    rowId?: string;
  } | null>(null);

  const filterEnabled = schema.features.detailFilter !== false;

  const [filters, setFilters] = useState<DetailFilters>(() =>
    emptyDetailFilters(schema),
  );
  const [filterOpts, setFilterOpts] = useState<FilterOptions>({
    hideEmpty: false,
    onlyErrors: false,
    global: "",
  });
  const [detailPage, setDetailPage] = useState(0);
  const [detailPageSize, setDetailPageSize] = useState<DetailPageSize>(
    DEFAULT_DETAIL_PAGE_SIZE,
  );
  const clearExclude = useExcludeStore((s) => s.clear);

  /** 清除／重新匯入時重設編輯區暫存 UI，避免與初次進入畫面落差 */
  function resetEditSessionUi() {
    setFilters(emptyDetailFilters(schema));
    setFilterOpts({ hideEmpty: false, onlyErrors: false, global: "" });
    setDetailPage(0);
    setDetailPageSize(DEFAULT_DETAIL_PAGE_SIZE);
    setAgentBank("");
    setConvertOpen(false);
    setConverting(false);
    setPartitionFormDirty(false);
    clearExclude();
  }

  function returnToUpload(message = "已清除所有紀錄，請重新上傳檔案") {
    if (partitionSession?.formatCode === schema.code) {
      clearPartitionSession();
    }
    resetEditSessionUi();
    setImportFile(null);
    setImportResult(null);
    setImportProgress(null);
    closeWorkspace(schema);
    toast.message(message);
  }

  useEffect(() => {
    setFilters(emptyDetailFilters(schema));
    setFilterOpts({ hideEmpty: false, onlyErrors: false, global: "" });
    setDetailPage(0);
    setDetailPageSize(DEFAULT_DETAIL_PAGE_SIZE);
  }, [schema.code, schema]);

  useEffect(() => {
    ensureForm(schema);
  }, [schema, ensureForm]);

  const form = getForm(schema.code) ?? { header: {}, rows: [] };
  const header = form.header;
  const rows = form.rows;
  const detailFields = useMemo(() => detailFieldsForDisplay(schema), [schema]);
  /** 驗證／統計延後，避免每鍵重算卡住輸入 */
  const deferredRows = useDeferredValue(rows);
  const deferredHeader = useDeferredValue(header);

  // 匯入 R01 後，從表頭／來源 BOF／明細提回行代號帶入代表行代號
  useEffect(() => {
    if (schema.code !== "ACHR01" || !workspaceOpen) return;
    const fromHeader = safeDigits(header.agentBank ?? "").slice(0, 7);
    if (fromHeader.length === 7) {
      setAgentBank(fromHeader);
      return;
    }
    const src = workspace.sourceHeaderLine;
    if (src?.startsWith("BOF") && src.length === schema.recordLength) {
      const fromSrc = headerFromLine(src, schema);
      const rorg = safeDigits(fromSrc.agentBank ?? "").slice(0, 7);
      if (rorg.length === 7) {
        setAgentBank(rorg);
        setHeader(schema.code, schema, "agentBank", rorg);
        return;
      }
    }
    if (rows.length === 0) return;
    const inferred = inferUniformR01ReturnBank(
      rows.map((r) => String(r.bankCode ?? "")),
    );
    if (inferred) {
      setAgentBank(inferred);
      setHeader(schema.code, schema, "agentBank", inferred);
    }
  }, [
    schema,
    workspaceOpen,
    workspace.fileName,
    workspace.source,
    workspace.sourceHeaderLine,
    header.agentBank,
    rows,
    setHeader,
  ]);

  /** 分割工作區編輯時標記未存回 */
  const setHeaderT = (
    code: string,
    sch: FormatSchema,
    key: string,
    value: string,
  ) => {
    startTransition(() => {
      setHeader(code, sch, key, value);
      if (partitionSession?.formatCode === code) {
        setPartitionFormDirty(true);
        markPartitionDirty();
      }
    });
  };
  const updateRowT = (
    code: string,
    sch: FormatSchema,
    id: string,
    key: string,
    value: string,
  ) => {
    startTransition(() => {
      updateRow(code, sch, id, key, value);
      if (partitionSession?.formatCode === code) {
        setPartitionFormDirty(true);
        markPartitionDirty();
      }
    });
  };

  const rowErrs = useMemo(() => {
    // 大量列時避免一次驗證全部造成主執行緒卡死／記憶體暴衝
    const MAX_FULL_VALIDATE = 800;
    if (deferredRows.length <= MAX_FULL_VALIDATE) {
      return deferredRows.map((r) =>
        validateDetailRow(schema, r, txids, branches, deferredHeader),
      );
    }
    return deferredRows.map((r) => {
      if (isRowEmpty(r, schema)) {
        const empty: Record<string, string | null> = {};
        for (const f of schema.form.detail) empty[f.key] = null;
        return empty;
      }
      return validateDetailRow(schema, r, txids, branches, deferredHeader);
    });
  }, [schema, deferredRows, txids, branches, deferredHeader]);

  const stats = useMemo(() => {
    let count = 0;
    let amount = 0;
    let errRows = 0;
    const amountKey = schema.features.amountKey;
    deferredRows.forEach((r, i) => {
      if (isRowEmpty(r, schema)) return;
      const msgs = rowErrorMessages(rowErrs[i] ?? {});
      if (msgs.length) errRows += 1;
      else {
        count += 1;
        if (amountKey) amount += Number(r[amountKey]) || 0;
      }
    });
    return { count, amount, errRows };
  }, [deferredRows, rowErrs, schema]);

  const excludeConditions = useExcludeStore((s) => s.conditions);
  const excludeMatchMode = useExcludeStore((s) => s.matchMode);
  const excludeActionMode = useExcludeStore((s) => s.actionMode);

  /** 轉檔 R01 筆數：僅開啟對話框時計算，避免每鍵重算 */
  const convertR01DetailCount = useMemo(() => {
    if (!convertOpen) return 0;
    const exclude = resolveExcludeDoc(schema.code);
    if (partitionSession?.formatCode === schema.code) {
      try {
        const { rows: all } = collectSessionRows(schema, partitionSession);
        return filterExcludedRows(schema, all, exclude).kept.filter(
          (r) => !isRowEmpty(r, schema),
        ).length;
      } catch {
        return partitionSession.parts.reduce((n, p) => n + p.detailCount, 0);
      }
    }
    const kept = filterExcludedRows(schema, rows, exclude).kept;
    return kept.filter((r) => !isRowEmpty(r, schema)).length;
  }, [
    convertOpen,
    schema,
    rows,
    excludeConditions,
    excludeMatchMode,
    excludeActionMode,
    partitionSession,
  ]);

  const filtered = useMemo(() => {
    if (!filterEnabled) {
      return rows.map((row, index) => ({ row, index }));
    }
    return filterDetailRows(
      rows,
      schema,
      filters,
      filterOpts,
      (_row, index) => rowErrorMessages(rowErrs[index] ?? {}).length > 0,
    );
  }, [rows, schema, filters, filterOpts, rowErrs, filterEnabled]);

  const filtersActive = filterEnabled && hasActiveFilters(filters, filterOpts);

  // 篩選條件變更時回到第一頁
  useEffect(() => {
    setDetailPage(0);
  }, [filters, filterOpts.hideEmpty, filterOpts.onlyErrors, filterOpts.global]);

  const detailPageCount = Math.max(
    1,
    Math.ceil(filtered.length / detailPageSize) || 1,
  );
  const safeDetailPage = Math.min(detailPage, detailPageCount - 1);

  useEffect(() => {
    if (detailPage !== safeDetailPage) setDetailPage(safeDetailPage);
  }, [detailPage, safeDetailPage]);

  const pagedDetails = useMemo(() => {
    const start = safeDetailPage * detailPageSize;
    return filtered.slice(start, start + detailPageSize);
  }, [filtered, safeDetailPage, detailPageSize]);
  const pageFrom =
    filtered.length === 0 ? 0 : safeDetailPage * detailPageSize + 1;
  const pageTo = Math.min(
    filtered.length,
    (safeDetailPage + 1) * detailPageSize,
  );

  function setFilterKey(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearAllFilters() {
    setFilters(emptyDetailFilters(schema));
    setFilterOpts({ hideEmpty: false, onlyErrors: false, global: "" });
  }

  function validateFormData(source?: {
    header: import("@/lib/ach/schema").HeaderValues;
    rows: import("@/lib/ach/schema").DetailRow[];
    partRefs?: { part: number; row: number }[];
  }): boolean {
    const sourceHeader = source?.header ?? header;
    const sourceRows = source?.rows ?? rows;
    const synced = syncHeaderFromDetails(sourceHeader, sourceRows, schema);
    if (!source && synced.txid !== header.txid) {
      setHeaderT(schema.code, schema, "txid", synced.txid ?? "");
    }
    const syncedHeaderErrs = validateHeader(schema, synced, txids, branches);
    // ACHR01 表頭 bankCode／account 為參考（BOF 無此欄、畫面已隱藏），不阻擋輸出
    if (schema.code === "ACHR01") {
      delete syncedHeaderErrs.bankCode;
      delete syncedHeaderErrs.account;
    }
    const headerErrors = schema.form.header
      .map((f) => {
        const msg = syncedHeaderErrs[f.key];
        return msg ? `${f.label}：${msg}` : null;
      })
      .filter((m): m is string => Boolean(m));
    if (headerHasError(syncedHeaderErrs)) {
      downloadExportErrorReport(
        schema,
        buildExportErrorReport({ schema, headerErrors }),
      );
      toast.error("控制首錄／表頭資料輸入有誤（已下載錯誤說明）");
      return false;
    }
    const badRows: {
      row: number;
      part?: number;
      messages: string[];
    }[] = [];
    // 輸出前完整檢核：以傳入資料或目前表單即時 validate（不依賴畫面 rowErrs 快取）
    sourceRows.forEach((r, i) => {
      if (isRowEmpty(r, schema)) return;
      const errs =
        source != null
          ? validateDetailRow(schema, r, txids, branches, synced)
          : (rowErrs[i] ?? validateDetailRow(schema, r, txids, branches, synced));
      const messages = rowErrorMessages(errs);
      if (messages.length) {
        const ref = source?.partRefs?.[i];
        badRows.push({
          row: ref?.row ?? i + 1,
          part: ref?.part,
          messages,
        });
      }
    });
    if (badRows.length) {
      downloadExportErrorReport(
        schema,
        buildExportErrorReport({ schema, rows: badRows }),
      );
      const bad = badRows.map((r) => formatExportErrorRowRef(r));
      toast.error(
        `${bad.slice(0, 8).join("、")}${bad.length > 8 ? "…" : ""} 資料仍有錯誤（已下載錯誤說明）`,
      );
      return false;
    }
    const validCount = sourceRows.filter((r) => {
      if (isRowEmpty(r, schema)) return false;
      return true;
    }).length;
    // 非空列皆須通過檢核；統計用非空數
    if (validCount === 0) {
      downloadExportErrorReport(
        schema,
        buildExportErrorReport({
          schema,
          extra: ["尚無有效明細資料"],
        }),
      );
      toast.error("尚無有效明細資料（已下載錯誤說明）");
      return false;
    }
    return true;
  }

  /** 輸出／轉檔用來源：分割工作區則合併全包 */
  function prepareExportSource(): {
    header: import("@/lib/ach/schema").HeaderValues;
    rows: import("@/lib/ach/schema").DetailRow[];
    partRefs?: { part: number; row: number }[];
  } | null {
    const sess = usePartitionStore.getState().session;
    if (sess && sess.formatCode === schema.code) {
      if (sess.activeIndex != null && partitionFormDirty) {
        usePartitionStore
          .getState()
          .saveFormToActivePart(schema, header, rows, txids, branches);
        setPartitionFormDirty(false);
      }
      const latest = usePartitionStore.getState().session;
      if (!latest || latest.formatCode !== schema.code) {
        toast.error("分割工作區已結束");
        return null;
      }
      try {
        return collectSessionRows(schema, latest);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "無法讀取分割工作區");
        return null;
      }
    }
    return { header, rows };
  }

  /** 輸出／轉檔前：完整檢核目前表單（表頭＋明細規則） */
  function validateBeforeExport(): boolean {
    const source = prepareExportSource();
    if (!source) return false;
    return validateFormData(source);
  }

  /** 以目前工作區格式輸出（套用篩選／排除） */
  async function exportCurrentAsFile() {
    if (!validateBeforeExport()) return;
    setConverting(true);
    try {
      const doc = useExcludeStore.getState().syncDocFromConditions(schema.code);
      const result = await handleExcludeExport(doc);
      useExcludeStore.getState().setLastResult(result);
      const saved = await saveAchFiles([
        {
          filename: result.filename,
          content: result.content,
          mime: "text/plain;charset=utf-8",
        },
      ]);
      if (saved.method === "canceled") {
        toast.message(
          `已完成輸出（${result.detailCount.toLocaleString("zh-TW")} 筆），但取消下載`,
        );
        return;
      }
      const action = result.action;
      const actionVerb = action === "filter" ? "篩選" : "排除";
      const hasRules = result.excludedCount > 0;
      toast.success(
        `${hasRules ? `${actionVerb}後輸出` : "已輸出"} ${result.detailCount.toLocaleString("zh-TW")} 筆` +
          (result.excludedCount > 0
            ? `（未輸出 ${result.excludedCount.toLocaleString("zh-TW")} 筆）`
            : "") +
          ` · ${describeSaveResult(saved)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "輸出失敗");
    } finally {
      setConverting(false);
    }
  }

  async function handleConvertToR01(opts: {
    rcode: string;
    ydate: string;
    pdate: string;
    agentBank: string;
  }) {
    const r01 = formats.ACHR01;
    if (!r01) {
      toast.error("找不到 ACHR01 格式定義");
      return;
    }
    setConverting(true);
    try {
      const source = prepareExportSource();
      if (!source || !validateFormData(source)) return;
      const sourceHeader = source.header;
      const sourceRows = source.rows;

      const lineEnding = usePrefsStore.getState().lineEnding;
      const exclude = resolveExcludeDoc(schema.code);
      const action = resolveExcludeAction(exclude);
      const actionVerb = action === "filter" ? "篩選" : "排除";
      const filtered = filterExcludedRows(schema, sourceRows, exclude);
      if (filtered.kept.length === 0) {
        toast.error(`${actionVerb}後沒有可轉檔的明細`);
        return;
      }
      // 單一整檔；不依收受行分檔
      const result = convertP01ToR01(
        withLineEndingId(r01, lineEnding),
        sourceHeader,
        filtered.kept,
        txids,
        branches,
        opts,
      );
      const saved = await saveAchFiles(
        result.files.map((f) => ({
          filename: f.filename,
          content: f.content,
          mime: "text/plain;charset=utf-8",
        })),
      );
      if (saved.method === "canceled") {
        toast.message("已取消儲存");
        return;
      }
      const excludeNote =
        filtered.excludedCount > 0
          ? `（已${actionVerb}未輸出 ${filtered.excludedCount.toLocaleString("zh-TW")} 筆）`
          : "";
      toast.success(
        `已轉檔整檔（${result.detailCount} 筆${excludeNote}，RCODE=${result.rcode}）· ${describeSaveResult(saved)}`,
      );
      setConvertOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "轉檔失敗");
    } finally {
      setConverting(false);
    }
  }

  async function handleConvertToP01() {
    const p01 = formats.ACHP01;
    if (!p01) {
      toast.error("找不到 ACHP01 格式定義");
      return;
    }
    setConverting(true);
    try {
      const source = prepareExportSource();
      if (!source || !validateFormData(source)) return;
      const sourceHeader = source.header;
      const sourceRows = source.rows;

      const lineEnding = usePrefsStore.getState().lineEnding;
      const exclude = resolveExcludeDoc(schema.code);
      const action = resolveExcludeAction(exclude);
      const actionVerb = action === "filter" ? "篩選" : "排除";
      const filtered = filterExcludedRows(schema, sourceRows, exclude);
      if (filtered.kept.length === 0) {
        toast.error(`${actionVerb}後沒有可轉檔的明細`);
        return;
      }
      const processDate = String(header.date ?? sourceHeader.date ?? "");
      const result = convertR01ToP01(
        withLineEndingId(p01, lineEnding),
        { ...sourceHeader, date: processDate || sourceHeader.date },
        filtered.kept,
        txids,
        branches,
        { date: processDate || undefined },
      );
      const saved = await saveAchFiles(
        result.files.map((f) => ({
          filename: f.filename,
          content: f.content,
          mime: "text/plain;charset=utf-8",
        })),
      );
      if (saved.method === "canceled") {
        toast.message("已取消儲存");
        return;
      }
      const excludeNote =
        filtered.excludedCount > 0
          ? `（已${actionVerb}未輸出 ${filtered.excludedCount.toLocaleString("zh-TW")} 筆）`
          : "";
      toast.success(
        `已轉回 P01（${result.detailCount} 筆${excludeNote}）· ${describeSaveResult(saved)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "轉檔失敗");
    } finally {
      setConverting(false);
    }
  }

  async function handleImportFile(file: File) {
    // 新上傳：清掉上一輪編輯暫存（篩選／排除條件／代表行等）與分割工作區
    if (partitionSession?.formatCode === schema.code) {
      clearPartitionSession();
    }
    resetEditSessionUi();
    setImportFile(file);
    setImportProgress({
      bytesRead: 0,
      totalBytes: file.size,
      linesRead: 0,
      detailCount: 0,
      matchedCount: 0,
    });
    try {
      const detected = await resolveImportSchemaFromFile(file, formats, schema);
      const target = detected ?? schema;
      if (target.code !== "ACHP01" && target.code !== "ACHR01") {
        toast.error(`不支援的檔案代號：${target.code}`);
        setImportFile(null);
        setImportProgress(null);
        return;
      }
      const result = await parseAchFile(file, target, {
        filename: file.name,
        onProgress: setImportProgress,
      });
      if (
        result.errors.length &&
        result.detailCount === 0 &&
        !result.lines.length
      ) {
        toast.error(result.errors[0] ?? "匯入失敗");
        setImportFile(null);
        return;
      }

      // >5000 筆：不開預覽，自動分割後進入編輯（不依 P01／R01 切換編輯模式）
      if (result.tooLargeForForm) {
        if (target.code !== schema.code) {
          onSelectFormat?.(target.code);
        }
        toast.message(
          `檔案 ${result.detailCount.toLocaleString("zh-TW")} 筆超過可編輯上限（${IMPORT_LIMITS.maxFormDetailRows.toLocaleString("zh-TW")}），自動分割後進入編輯`,
        );
        setImportProgress({
          bytesRead: file.size,
          totalBytes: file.size,
          linesRead: result.detailCount,
          detailCount: result.detailCount,
          matchedCount: 0,
        });
        const split = await splitFileAndStartEdit({
          file,
          schema: target,
          txids,
          branches,
          detailCount: result.detailCount,
          onProgress: (p: PartitionProgress) => {
            setImportProgress({
              bytesRead: p.bytesRead,
              totalBytes: p.totalBytes || file.size,
              linesRead: p.linesRead,
              detailCount: p.detailCount,
              matchedCount: p.matchedCount,
            });
          },
        });
        if (split.autoRaised) {
          toast.message(
            `已自動調整為 ${split.partCount} 包（每包 ≤ ${IMPORT_LIMITS.maxFormDetailRows.toLocaleString("zh-TW")} 筆）`,
          );
        }
        loadFromImport(
          target,
          { header: split.first.header, rows: split.first.rows },
          {
            fileName: split.first.fileName,
            sourceHeaderLine: split.sourceHeaderLine,
            sourceTrailerLine: split.sourceTrailerLine,
          },
        );
        setPartitionFormDirty(false);
        setImportResult(null);
        toast.success(
          `已分割 ${split.partCount} 包（共 ${split.totalDetailCount.toLocaleString("zh-TW")} 筆），已載入第 1 包供編輯`,
        );
        return;
      }

      setImportResult(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "無法讀取檔案");
      setImportFile(null);
    } finally {
      setImportProgress(null);
    }
  }

  async function handleImportFilterScan(
    filters: DetailFilters,
    global: string,
  ) {
    if (!importFile || !importResult) {
      toast.error("找不到原始上傳檔，請重新上傳");
      return;
    }
    setImportProgress({
      bytesRead: 0,
      totalBytes: importFile.size,
      linesRead: 0,
      detailCount: 0,
      matchedCount: 0,
    });
    try {
      const result = await parseAchFile(importFile, importResult.schema, {
        filename: importFile.name,
        filters,
        filterGlobal: global,
        onProgress: setImportProgress,
      });
      setImportResult(result);
      if (result.tooLargeForForm) {
        toast.error(
          `符合 ${result.matchedCount.toLocaleString("zh-TW")} 筆仍超上限，請再縮小條件`,
        );
      } else if (result.matchedCount === 0) {
        toast.message("沒有符合篩選的明細");
      } else {
        toast.success(
          `已載入符合篩選的全部 ${result.matchedCount.toLocaleString("zh-TW")} 筆`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "篩選載入失敗");
    } finally {
      setImportProgress(null);
    }
  }

  async function applyImport(result: ImportResult) {
    if (result.tooLargeForForm) {
      toast.error("筆數仍超過上限，請再縮小表頭篩選條件");
      return;
    }
    // 套用匯入＝進入乾淨編輯畫面（與初次上傳一致）
    if (usePartitionStore.getState().session?.formatCode === result.schema.code) {
      clearPartitionSession();
    }
    resetEditSessionUi();
    const sourceHeaderLine = result.lines.find((l) => l.kind === "header")?.raw;
    const sourceTrailerLine = result.lines.find((l) => l.kind === "trailer")?.raw;
    loadFromImport(
      result.schema,
      {
        header: result.header,
        rows: result.rows,
      },
      {
        fileName: result.filename,
        sourceHeaderLine,
        sourceTrailerLine,
      },
    );
    if (result.schema.code !== schema.code) {
      onSelectFormat?.(result.schema.code);
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 180);
    });
    setImportResult(null);
    // 保留 importFile，供「編輯」分割邏輯繼續使用
    toast.success(
      `已匯入 ${result.schema.code}（${result.matchedCount.toLocaleString("zh-TW")} 筆明細），可進行檢核與加工`,
    );
  }

  function closeImportPreview() {
    setImportResult(null);
    setImportFile(null);
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".txt,text/plain"
      tabIndex={-1}
      aria-hidden="true"
      style={hiddenFileInputStyle}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void handleImportFile(file);
      }}
    />
  );

  const progressPct =
    importProgress && importProgress.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (importProgress.bytesRead / importProgress.totalBytes) * 100,
          ),
        )
      : 0;

  // 初次上傳用全畫面 mask；預覽對話框內的篩選重掃改由對話框自家 mask 顯示
  const importLoadingMask =
    importProgress && !importResult ? (
      <Backdrop
        open
        sx={{ zIndex: (t) => t.zIndex.modal + 1, color: "#fff" }}
        role="status"
        aria-live="polite"
      >
        <Paper sx={{ width: "100%", maxWidth: 360, p: 3, textAlign: "center" }}>
          <CircularProgress color="primary" sx={{ mb: 2 }} />
          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 700 }}>
            串流讀取／分割檔案中…
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            已讀 {importProgress.totalBytes > 0 ? `${progressPct}%` : "…"}
            {" · "}
            明細 {importProgress.detailCount.toLocaleString("zh-TW")} 筆
            {" · "}
            列 {importProgress.linesRead.toLocaleString("zh-TW")}
          </Typography>
          <LinearProgress
            variant={importProgress.totalBytes > 0 ? "determinate" : "indeterminate"}
            value={progressPct}
            sx={{ mb: 1.5, borderRadius: 1 }}
          />
        </Paper>
      </Backdrop>
    ) : null;

  const importDialog = (
    <ImportPreviewDialog
      open={!!importResult}
      result={importResult}
      txids={txids}
      branches={branches}
      sourceFile={importFile}
      scanning={!!importProgress && !!importResult}
      scanProgress={importProgress}
      onClose={closeImportPreview}
      onApply={applyImport}
      onFilterScan={handleImportFilterScan}
      onPartition={() => setPartitionTools({ mode: "split" })}
      onLargeConvertR01={() => setPartitionTools({ mode: "convert" })}
      onLargeConvertP01={() => setPartitionTools({ mode: "convert" })}
    />
  );

  const partitionDialog = (
    <PartitionToolsDialog
      open={!!partitionTools}
      mode={partitionTools?.mode ?? "split"}
      schema={schema}
      formats={formats}
      txids={txids}
      branches={branches}
      sourceFile={importFile}
      detailCount={importResult?.detailCount ?? stats.count}
      tdate={
        String(importResult?.header.date ?? header.date ?? "")
      }
      onClose={() => setPartitionTools(null)}
      onOpenPartitionEdit={(payload) => {
        const sess = usePartitionStore.getState().session;
        loadFromImport(
          schema,
          { header: payload.header, rows: payload.rows },
          {
            fileName: payload.fileName,
            sourceHeaderLine:
              sess?.index.sourceHeaderLine ?? sess?.index.headerLine,
            sourceTrailerLine: sess?.index.sourceTrailerLine,
          },
        );
        setPartitionFormDirty(false);
        setImportResult(null);
      }}
    />
  );

  const partitionBar = (
    <PartitionWorkspaceBar
      schema={schema}
      header={header}
      rows={rows}
      txids={txids}
      branches={branches}
      formDirty={partitionFormDirty}
      onFormClean={() => setPartitionFormDirty(false)}
      onClearToUpload={() => {
        returnToUpload();
      }}
      onLoadPart={(payload) => {
        const sess = usePartitionStore.getState().session;
        loadFromImport(
          schema,
          { header: payload.header, rows: payload.rows },
          {
            fileName: payload.fileName,
            sourceHeaderLine: sess?.index.sourceHeaderLine,
            sourceTrailerLine: sess?.index.sourceTrailerLine,
          },
        );
        setPartitionFormDirty(false);
        // 切換包時重設明細篩選／分頁，避免上一包條件殘留
        setFilters(emptyDetailFilters(schema));
        setFilterOpts({ hideEmpty: false, onlyErrors: false, global: "" });
        setDetailPage(0);
      }}
    />
  );

  async function handleExcludeExport(doc: ExcludeRulesDoc | null) {
    const lineEnding = usePrefsStore.getState().lineEnding;
    const outSchema = withLineEndingId(schema, lineEnding);
    const action = resolveExcludeAction(doc);
    const actionVerb = action === "filter" ? "篩選" : "排除";
    const hasRules = Boolean(doc?.rules?.length);
    const fileSuffix = !hasRules
      ? ".txt"
      : action === "filter"
        ? ".filtered.txt"
        : ".excluded.txt";
    const processDate = String(header.date ?? "");
    const exportAgentBank =
      schema.code === "ACHR01"
        ? safeDigits(agentBank || header.agentBank || "").slice(0, 7)
        : "";

    // 一律以最新 store 判斷；有分割工作區則合併「全部分割包」後再套用條件
    const sess = usePartitionStore.getState().session;
    if (sess && sess.formatCode === schema.code) {
      if (sess.activeIndex != null && partitionFormDirty) {
        usePartitionStore
          .getState()
          .saveFormToActivePart(schema, header, rows, txids, branches);
        setPartitionFormDirty(false);
      }
      const latest = usePartitionStore.getState().session;
      if (!latest || latest.formatCode !== schema.code) {
        throw new Error("分割工作區已結束");
      }
      if (!latest.parts.length) {
        throw new Error("分割工作區沒有可輸出的包");
      }
      const merged = mergeSessionToFile(outSchema, latest, txids, branches, {
        exclude: doc,
        processDate,
        agentBank: exportAgentBank || null,
      });
      if (merged.detailCount === 0) {
        throw new Error(
          hasRules
            ? `全部分割包（${latest.parts.length} 包、共 ${merged.totalBeforeExclude.toLocaleString("zh-TW")} 筆）${actionVerb}後沒有可輸出的明細`
            : "沒有可輸出的明細",
        );
      }
      return {
        filename: merged.filename.replace(/\.merged\.txt$/, fileSuffix),
        content: merged.content,
        totalBefore: merged.totalBeforeExclude,
        excludedCount: merged.excludedCount,
        detailCount: merged.detailCount,
        amount: merged.amount,
        partCount: latest.parts.length,
        action,
      };
    }

    // 一般表單：套用篩選／排除（可無條件）後產生 TXT
    const filtered = filterExcludedRows(schema, rows, doc);
    if (filtered.kept.length === 0) {
      throw new Error(
        hasRules ? `${actionVerb}後沒有可輸出的明細` : "沒有可輸出的明細",
      );
    }
    const exportHeader =
      schema.code === "ACHR01"
        ? {
            ...header,
            date: processDate || header.date || "",
            agentBank: exportAgentBank,
          }
        : header;
    const generated = generateFromSchema(
      outSchema,
      exportHeader,
      filtered.kept,
      txids,
      branches,
    );
    const badLen = generated.lines.find(
      (l) => l.length !== schema.recordLength,
    );
    if (badLen) {
      throw new Error(
        `產生列長度 ${badLen.length} 與定義 ${schema.recordLength} 不符`,
      );
    }

    const ending = outSchema.lineEnding || "\r\n";
    const detailLines = generated.lines.filter(
      (l) => !l.startsWith("BOF") && !l.startsWith("EOF"),
    );
    const ws = getWorkspace(schema.code);
    const partSess = usePartitionStore.getState().session;
    const rawSourceHeader =
      ws.sourceHeaderLine ??
      (partSess?.formatCode === schema.code
        ? partSess.index.sourceHeaderLine
        : undefined);
    const rawSourceTrailer =
      ws.sourceTrailerLine ??
      (partSess?.formatCode === schema.code
        ? partSess.index.sourceTrailerLine
        : undefined);
    const sourceHeader =
      rawSourceHeader &&
      rawSourceHeader.startsWith("BOF") &&
      rawSourceHeader.length === schema.recordLength
        ? rawSourceHeader
        : null;
    const sourceTrailer =
      rawSourceTrailer &&
      rawSourceTrailer.startsWith("EOF") &&
      rawSourceTrailer.length === schema.recordLength
        ? rawSourceTrailer
        : null;
    const fromSource = sourceHeader
      ? headerFromLine(sourceHeader, schema)
      : null;
    // 控制錄只用來源 BOF 解析出的值＋處理日期；勿併入可能來自明細的 bankCode
    const ctrlHeader: typeof header = {
      ...(fromSource ?? header),
      date: processDate || fromSource?.date || header.date || "",
      ...(schema.code === "ACHR01"
        ? {
            agentBank:
              exportAgentBank ||
              fromSource?.agentBank ||
              header.agentBank ||
              "",
          }
        : {}),
    };
    const { headerLine, trailerLine } = buildExportControlLines(outSchema, {
      sourceHeaderLine: sourceHeader,
      sourceTrailerLine: sourceTrailer,
      header: ctrlHeader,
      processDate,
      agentBank: schema.code === "ACHR01" ? exportAgentBank : null,
      detailCount: detailLines.length,
      totalAmount: generated.amount,
      txids,
      branches,
    });
    const content =
      [headerLine, ...detailLines, trailerLine].join(ending) + ending;

    return {
      filename: generated.filename.replace(/\.txt$/, fileSuffix),
      content,
      totalBefore: filtered.totalBefore,
      excludedCount: filtered.excludedCount,
      detailCount: detailLines.length,
      amount: generated.amount,
      partCount: null,
      action,
    };
  }

  const excludePanel = (
    <ExcludeExportPanel
      schema={schema}
      partitionScope={
        partitionSession?.formatCode === schema.code
          ? {
              partCount: partitionSession.parts.length,
              detailCount: partitionSession.parts.reduce(
                (n, p) => n + p.detailCount,
                0,
              ),
            }
          : null
      }
      processDate={String(header.date ?? "")}
      onProcessDateChange={(value) =>
        setHeaderT(schema.code, schema, "date", value)
      }
      onProcessDateBlur={() => blurHeader(schema.code, schema, "date")}
      agentBank={agentBank}
      onAgentBankChange={(value) => {
        setAgentBank(value);
        if (schema.code === "ACHR01") {
          setHeaderT(schema.code, schema, "agentBank", value);
        }
      }}
      onProcess={handleExcludeExport}
      onValidateBeforeExport={validateBeforeExport}
      onExportP01={() => {
        if (schema.code === "ACHR01") {
          void handleConvertToP01();
          return;
        }
        void exportCurrentAsFile();
      }}
      onExportR01={() => {
        if (schema.code === "ACHP01") {
          if (!validateBeforeExport()) return;
          setConvertOpen(true);
          return;
        }
        void exportCurrentAsFile();
      }}
    />
  );

  const convertDialog = (
      <ConvertR01Dialog
        open={convertOpen}
        detailCount={convertR01DetailCount}
        tdate={String(header.date ?? "")}
        agentBank={agentBank}
        busy={converting}
        onClose={() => {
          if (!converting) setConvertOpen(false);
        }}
        onConfirm={handleConvertToR01}
      />
    );

  // —— 預設：引導先上傳既有 P01／R01，隱藏新建表單 ——
  if (!workspaceOpen) {
    return (
      <Stack spacing={2}>
        {importLoadingMask}
        <Card>
          <CardContent sx={{ py: 4 }}>
            <Paper
              variant="outlined"
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleImportFile(file);
              }}
              sx={{
                mx: "auto",
                maxWidth: 560,
                p: { xs: 3, sm: 5 },
                textAlign: "center",
                borderStyle: "dashed",
                borderWidth: 2,
                borderColor: dragOver ? "primary.main" : "divider",
                bgcolor: dragOver ? "action.selected" : "grey.50",
                transition: "border-color 150ms, background 150ms",
              }}
            >
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  mx: "auto",
                  mb: 2,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: "action.hover",
                  color: "primary.main",
                }}
              >
                <UploadIcon fontSize="large" color="primary" />
              </Box>
              <Typography variant="h6" gutterBottom>
                請先上傳既有 ACH 檔（P01／R01）
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={<FileUpIcon />}
                endIcon={<ArrowRightIcon />}
                onClick={() => fileInputRef.current?.click()}
              >
                選擇檔案上傳
              </Button>
              {fileInput}
              <Stack
                component="ol"
                spacing={1}
                sx={{
                  mt: 4,
                  mx: "auto",
                  maxWidth: 360,
                  pl: 2.5,
                  textAlign: "left",
                  color: "text.secondary",
                  typography: "caption",
                }}
              >
                <Typography component="li" variant="caption">
                  依 BOF／EOF 判定 P01／R01，並檢核明細 TYPE
                </Typography>
                <Typography component="li" variant="caption">
                  預覽並確認表頭／明細／列長
                </Typography>
                <Typography component="li" variant="caption">
                  編輯後按「輸出 P01」或「輸出 R01」時才完整檢核並轉檔
                </Typography>
              </Stack>
            </Paper>
          </CardContent>
        </Card>

        {importDialog}
        {partitionDialog}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {importLoadingMask}

      {excludePanel}

      <div className="card">
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {partitionSession?.formatCode !== schema.code ? (
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
                <LineEndingSelect />
                <Button
                  variant="text"
                  color="error"
                  startIcon={<RestartAltIcon />}
                  onClick={() => returnToUpload()}
                >
                  清除並回到上傳
                </Button>
              </Stack>
            ) : (
              <span />
            )}
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <span className="stat-pill text-xs">
                {filtered.length === 0
                  ? `0 / ${rows.length} 列`
                  : `第 ${pageFrom}–${pageTo} 列 · 共 ${filtered.length}${
                      filterEnabled && filtered.length !== rows.length
                        ? ` / ${rows.length}`
                        : ""
                    } 列`}
              </span>
            </Stack>
          </div>

          {partitionSession?.formatCode === schema.code ? (
            <div className="mt-3">{partitionBar}</div>
          ) : null}

          {filterEnabled && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--color-primary)]"
                  checked={!!filterOpts.hideEmpty}
                  onChange={(e) =>
                    setFilterOpts((o) => ({
                      ...o,
                      hideEmpty: e.target.checked,
                    }))
                  }
                />
                隱藏空白列
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--color-primary)]"
                  checked={!!filterOpts.onlyErrors}
                  onChange={(e) =>
                    setFilterOpts((o) => ({
                      ...o,
                      onlyErrors: e.target.checked,
                    }))
                  }
                />
                只顯示錯誤列
              </label>
              {filtersActive && (
                <button
                  type="button"
                  className="btn btn-ghost h-8 gap-1 px-2 text-xs"
                  onClick={clearAllFilters}
                >
                  <FilterXIcon sx={{ fontSize: 16 }} />
                  清除篩選
                </button>
              )}
            </div>
          )}
        </div>

        <div className="scroll-panel border-0 rounded-none">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10">
                  <span className="th-label">#</span>
                  {filterEnabled ? (
                    <span className="block h-[1.7rem]" aria-hidden />
                  ) : null}
                </th>
                {detailFields.map((f) => {
                  const canFilter = filterEnabled && isFieldFilterable(f);
                  const active = Boolean((filters[f.key] ?? "").trim());
                  return (
                    <th key={f.key} style={{ minWidth: f.ui?.minWidth }}>
                      <span className="th-label">{f.label}</span>
                      {canFilter ? (
                        <input
                          className={`th-filter ${active ? "is-active" : ""}`}
                          aria-label={`篩選 ${f.label}`}
                          placeholder="篩選…"
                          value={filters[f.key] ?? ""}
                          onChange={(e) => setFilterKey(f.key, e.target.value)}
                        />
                      ) : filterEnabled ? (
                        <span className="block h-[1.7rem]" aria-hidden />
                      ) : null}
                    </th>
                  );
                })}
                <th className="min-w-40">
                  <span className="th-label">錯誤訊息</span>
                  {filterEnabled ? (
                    filtersActive ? (
                      <button
                        type="button"
                        className="btn btn-ghost h-7 px-1 text-[0.7rem] text-primary-fg"
                        onClick={clearAllFilters}
                        title="清除篩選"
                        aria-label="清除篩選"
                      >
                        <FilterXIcon sx={{ fontSize: 16 }} />
                      </button>
                    ) : (
                      <span className="block h-[1.7rem]" aria-hidden />
                    )
                  ) : null}
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedDetails.length === 0 ? (
                <tr>
                  <td
                    colSpan={detailFields.length + 2}
                    className="py-10 text-center text-muted"
                  >
                    {filtersActive
                      ? "沒有符合篩選條件的明細列"
                      : "尚無明細資料"}
                  </td>
                </tr>
              ) : (
                pagedDetails.map(({ row, index: idx }) => {
                  return (
                    <tr key={row.id}>
                      <td className="text-center text-faint">{idx + 1}</td>
                      {detailFields.map((field) => (
                        <td key={field.key}>
                          <div className="flex gap-0.5">
                            <DetailCellInput
                              value={row[field.key] ?? ""}
                              err={false}
                              alignRight={field.ui?.align === "right"}
                              onCommit={(value) =>
                                updateRowT(
                                  schema.code,
                                  schema,
                                  row.id,
                                  field.key,
                                  value,
                                )
                              }
                              onBlurCommit={() =>
                                blurRow(schema.code, schema, row.id, field.key)
                              }
                              onPasteMulti={
                                field.key === detailFields[0]?.key
                                  ? (text) => {
                                      pasteRows(
                                        schema.code,
                                        schema,
                                        idx,
                                        text,
                                      );
                                    }
                                  : undefined
                              }
                            />
                          </div>
                        </td>
                      ))}
                      <td className="whitespace-pre-line text-xs text-muted">
                        {filterOpts.onlyErrors
                          ? rowErrorMessages(rowErrs[idx] ?? {}).join("\n")
                          : ""}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <TablePagination
          component="div"
          rowsPerPageOptions={[...DETAIL_PAGE_SIZES]}
          count={filtered.length}
          rowsPerPage={detailPageSize}
          page={safeDetailPage}
          onPageChange={(_, next) => setDetailPage(next)}
          onRowsPerPageChange={(e) => {
            const next = Number(e.target.value) as DetailPageSize;
            setDetailPageSize(
              DETAIL_PAGE_SIZES.includes(next)
                ? next
                : DEFAULT_DETAIL_PAGE_SIZE,
            );
            setDetailPage(0);
          }}
          labelRowsPerPage="每頁筆數"
          labelDisplayedRows={({ from, to, count }) =>
            count === 0 ? "0 筆" : `${from}–${to}／共 ${count} 筆`
          }
          sx={{
            borderTop: 1,
            borderColor: "divider",
            ".MuiTablePagination-toolbar": { flexWrap: "wrap", gap: 0.5 },
          }}
        />
      </div>

      <CodePicker
        open={picker?.mode === "txid"}
        mode="txid"
        items={txids}
        onClose={() => setPicker(null)}
        onSelect={(code) => {
          if (!picker) return;
          if (picker.target === "header") {
            setHeaderT(schema.code, schema, picker.key, code);
          } else if (picker.rowId) {
            updateRowT(schema.code, schema, picker.rowId, picker.key, code);
          }
        }}
      />
      <CodePicker
        open={picker?.mode === "branch"}
        mode="branch"
        items={branches}
        onClose={() => setPicker(null)}
        onSelect={(code) => {
          if (!picker) return;
          if (picker.target === "header") {
            setHeaderT(schema.code, schema, picker.key, code);
          } else if (picker.rowId) {
            updateRowT(schema.code, schema, picker.rowId, picker.key, code);
          }
        }}
      />
      {importDialog}
      {convertDialog}
      {partitionDialog}
    </Stack>
  );
}

/** 明細格：本地 draft 立即反映按鍵；store 更新放 startTransition，避免每鍵重繪／驗證卡住 */
const DetailCellInput = memo(function DetailCellInput({
  value,
  err,
  alignRight,
  onCommit,
  onBlurCommit,
  onPasteMulti,
}: {
  value: string;
  err?: boolean;
  alignRight?: boolean;
  onCommit: (value: string) => void;
  onBlurCommit: () => void;
  onPasteMulti?: (text: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);

  return (
    <input
      className={`cell-input ${alignRight ? "text-right" : ""} ${err ? "err" : ""}`}
      value={local}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        const next = e.target.value;
        setLocal(next);
        onCommit(next);
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (local !== value) onCommit(local);
        onBlurCommit();
      }}
      onPaste={
        onPasteMulti
          ? (e) => {
              const text = e.clipboardData.getData("text");
              if (text.includes("\t") || text.includes("\n")) {
                e.preventDefault();
                onPasteMulti(text);
              }
            }
          : undefined
      }
    />
  );
});
