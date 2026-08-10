import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Backdrop,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  TablePagination,
  Typography,
} from "@mui/material";
import {
  FileDownload as FileDownIcon,
  FileUpload as FileUpIcon,
  Search as SearchIcon,
  WarningAmber as AlertTriangleIcon,
  CheckCircle as CheckCircleIcon,
  FilterAltOff as FilterXIcon,
  CloudUpload as UploadIcon,
  ArrowForward as ArrowRightIcon,
  SwapHoriz as ArrowRightLeftIcon,
  ContentCut as ScissorsIcon,
  Edit as EditIcon,
  RestartAlt as RestartAltIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import { useFormStore, useRefStore } from "@/lib/ach/store";
import type { FormatSchema, FormFieldDef } from "@/lib/ach/schema";
import { convertP01ToR01 } from "@/lib/ach/convertR01";
import {
  formatTxTypeLabel,
  generateFromSchema,
  headerHasError,
  isRowEmpty,
  lookupBranch,
  lookupTxid,
  rowErrorMessages,
  syncHeaderFromDetails,
  validateDetailRow,
  validateHeader,
} from "@/lib/ach/engine";
import {
  emptyDetailFilters,
  filterDetailRows,
  hasActiveFilters,
  isFieldFilterable,
  type DetailFilters,
  type FilterOptions,
} from "@/lib/ach/filter";
import {
  buildExportArtifacts,
  type ExportFormatId,
} from "@/lib/ach/exportFormats";
import {
  parseAchFile,
  resolveImportSchemaFromFile,
  IMPORT_LIMITS,
  type ImportProgress,
  type ImportResult,
} from "@/lib/ach/import";
import { normalizeSubmitDate } from "@/lib/ach/utils";
import {
  describeSaveResult,
  saveAchFile,
  saveAchFiles,
} from "@/lib/ach/desktop";
import { CodePicker } from "./CodePicker";
import {
  ControlHeaderFields,
  ControlTrailerFields,
} from "./ControlRecords";
import { ConvertR01Dialog } from "./ConvertR01Dialog";
import { ImportPreviewDialog } from "./ImportPreviewDialog";
import { PartitionToolsDialog } from "./PartitionToolsDialog";
import { PartitionWorkspaceBar } from "./PartitionWorkspaceBar";
import {
  splitFileAndStartEdit,
  usePartitionStore,
} from "@/lib/ach/partitionStore";
import type { PartitionProgress } from "@/lib/ach/partition";

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
    openManualWorkspace,
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
  const [partitionTools, setPartitionTools] = useState<{
    mode: "split" | "merge" | "convert";
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

  /** 分割工作區編輯時標記未存回 */
  const setHeaderT = (
    code: string,
    sch: FormatSchema,
    key: string,
    value: string,
  ) => {
    setHeader(code, sch, key, value);
    if (partitionSession?.formatCode === code) {
      setPartitionFormDirty(true);
      markPartitionDirty();
    }
  };
  const updateRowT = (
    code: string,
    sch: FormatSchema,
    id: string,
    key: string,
    value: string,
  ) => {
    updateRow(code, sch, id, key, value);
    if (partitionSession?.formatCode === code) {
      setPartitionFormDirty(true);
      markPartitionDirty();
    }
  };

  const headerErrs = useMemo(
    () => validateHeader(schema, header, txids, branches),
    [schema, header, txids, branches],
  );

  const rowErrs = useMemo(() => {
    // 大量列時避免一次驗證全部造成主執行緒卡死／記憶體暴衝
    const MAX_FULL_VALIDATE = 800;
    if (rows.length <= MAX_FULL_VALIDATE) {
      return rows.map((r) =>
        validateDetailRow(schema, r, txids, branches, header),
      );
    }
    return rows.map((r) => {
      if (isRowEmpty(r, schema)) {
        const empty: Record<string, string | null> = {};
        for (const f of schema.form.detail) empty[f.key] = null;
        return empty;
      }
      return validateDetailRow(schema, r, txids, branches, header);
    });
  }, [schema, rows, txids, branches, header]);

  const stats = useMemo(() => {
    let count = 0;
    let amount = 0;
    let errRows = 0;
    const amountKey = schema.features.amountKey;
    rows.forEach((r, i) => {
      if (isRowEmpty(r, schema)) return;
      const msgs = rowErrorMessages(rowErrs[i] ?? {});
      if (msgs.length) errRows += 1;
      else {
        count += 1;
        if (amountKey) amount += Number(r[amountKey]) || 0;
      }
    });
    return { count, amount, errRows };
  }, [rows, rowErrs, schema]);

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

  function fieldMeta(field: FormFieldDef): string {
    const v = header[field.key] ?? "";
    if (field.metaFrom === "txid") {
      const t = lookupTxid(v, txids);
      return t ? `${formatTxTypeLabel(t.type)} · ${t.name}` : "";
    }
    if (field.metaFrom === "branch") {
      return lookupBranch(v, branches)?.name ?? "";
    }
    if (field.optionsFrom === "authOptions") {
      return schema.authOptions?.find((o) => o.value === v)?.note ?? "";
    }
    return "";
  }

  function onHeaderBlur(field: FormFieldDef) {
    if (field.inputType === "rocDate") {
      const { value, convertedFromAd } = normalizeSubmitDate(
        header[field.key] ?? "",
      );
      if (value !== (header[field.key] ?? "")) {
        setHeaderT(schema.code, schema, field.key, value);
      }
      if (convertedFromAd) toast.message("已將日期西元年轉換為民國年");
    }
    blurHeader(schema.code, schema, field.key);
  }

  function validateFormData(): boolean {
    const synced = syncHeaderFromDetails(header, rows, schema);
    if (synced.txid !== header.txid) {
      setHeaderT(schema.code, schema, "txid", synced.txid ?? "");
    }
    const syncedHeaderErrs = validateHeader(schema, synced, txids, branches);
    if (headerHasError(syncedHeaderErrs)) {
      toast.error("控制首錄／表頭資料輸入有誤");
      return false;
    }
    const bad: number[] = [];
    rows.forEach((r, i) => {
      if (isRowEmpty(r, schema)) return;
      if (rowErrorMessages(rowErrs[i] ?? {}).length) bad.push(i + 1);
    });
    if (bad.length) {
      toast.error(
        `第 ${bad.slice(0, 12).join("、")}${bad.length > 12 ? "…" : ""} 列資料仍有錯誤！`,
      );
      return false;
    }
    if (stats.count === 0) {
      toast.error("尚無有效明細資料");
      return false;
    }
    return true;
  }

  function validateBeforeGenerate(): boolean {
    return validateFormData();
  }

  async function handleGenerate(formats: ExportFormatId[] = ["txt"]) {
    if (!validateBeforeGenerate()) return;
    const want = formats.length ? formats : (["txt"] as ExportFormatId[]);
    const result = generateFromSchema(schema, header, rows, txids, branches);
    const badLen = result.lines.find((l) => l.length !== schema.recordLength);
    if (badLen) {
      toast.error(
        `產生列長度 ${badLen.length} 與定義 ${schema.recordLength} 不符，請檢查 JSON 格式`,
      );
      return;
    }
    const artifacts = buildExportArtifacts(
      schema,
      header,
      rows,
      result,
      txids,
      branches,
      want,
    );
    const saved = await saveAchFiles(
      artifacts.map((a) => ({
        filename: a.filename,
        content: a.content,
        mime: a.mime,
      })),
    );
    if (saved.method === "canceled") {
      toast.message("已取消儲存");
      return;
    }
    toast.success(
      `已產生 TXT（${result.count} 筆）· ${describeSaveResult(saved)}`,
    );
  }

  async function handleConvertToR01(opts: {
    rcode: string;
    ydate: string;
    pdate: string;
  }) {
    const r01 = formats.ACHR01;
    if (!r01) {
      toast.error("找不到 ACHR01 格式定義");
      return;
    }
    if (!validateFormData()) return;
    setConverting(true);
    try {
      const result = convertP01ToR01(
        r01,
        header,
        rows,
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
      toast.success(
        `已轉檔（${result.detailCount} 筆，RCODE=${result.rcode}）· ${describeSaveResult(saved)}`,
      );
      setConvertOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "轉檔失敗");
    } finally {
      setConverting(false);
    }
  }

  async function handleImportFile(file: File) {
    setImportFile(file);
    setImportProgress({
      bytesRead: 0,
      totalBytes: file.size,
      linesRead: 0,
      detailCount: 0,
      matchedCount: 0,
    });
    try {
      const target =
        (await resolveImportSchemaFromFile(file, formats, schema)) ?? schema;
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

      // >5000 筆：不開預覽，自動分割後進入編輯
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
          { fileName: split.first.fileName },
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
    loadFromImport(
      result.schema,
      {
        header: result.header,
        rows: result.rows,
      },
      { fileName: result.filename },
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

  const selectOptions = (field: FormFieldDef) => {
    if (field.optionsFrom === "authOptions") return schema.authOptions ?? [];
    return [];
  };

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
          <Typography variant="caption" color="text.disabled">
            大檔採逐列串流，不會一次載入整份到記憶體
          </Typography>
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
    />
  );

  const partitionDialog = (
    <PartitionToolsDialog
      open={!!partitionTools}
      mode={partitionTools?.mode ?? "merge"}
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
        loadFromImport(
          schema,
          { header: payload.header, rows: payload.rows },
          { fileName: payload.fileName },
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
        if (partitionSession?.formatCode === schema.code) {
          clearPartitionSession();
        }
        setPartitionFormDirty(false);
        setImportFile(null);
        setImportResult(null);
        setImportProgress(null);
        closeWorkspace(schema);
        toast.message("已清除所有紀錄，請重新上傳檔案");
      }}
      onLoadPart={(payload) => {
        loadFromImport(
          schema,
          { header: payload.header, rows: payload.rows },
          { fileName: payload.fileName },
        );
        setPartitionFormDirty(false);
      }}
    />
  );

  const convertDialog =
    schema.code === "ACHP01" ? (
      <ConvertR01Dialog
        open={convertOpen}
        detailCount={stats.count}
        tdate={String(header.date ?? "")}
        busy={converting}
        onClose={() => {
          if (!converting) setConvertOpen(false);
        }}
        onConfirm={handleConvertToR01}
      />
    ) : null;

  // —— 預設：引導先上傳既有 P01／R01，隱藏新建表單 ——
  if (!workspaceOpen) {
    return (
      <Stack spacing={2}>
        {importLoadingMask}
        <Card>
          <CardHeader
            title={`${schema.shortCode} ${schema.name}・檢核與加工`}
            subheader="本工具以既有財金 ACH 固定長度檔為主：先上傳檢核，再視需要修正後重新產出。"
            avatar={
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                <Chip size="small" color="success" label={schema.code} sx={{ fontFamily: "monospace" }} />
                <Chip
                  size="small"
                  color="warning"
                  label={`V${schema.version.replace(/^V/i, "")}`}
                />
                <Chip size="small" variant="outlined" label={`列長 ${schema.recordLength}`} />
              </Stack>
            }
            sx={{
              alignItems: "flex-start",
              "& .MuiCardHeader-avatar": { marginRight: 0, mb: 1 },
              bgcolor: "grey.50",
              borderBottom: 1,
              borderColor: "divider",
            }}
          />
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
                請先上傳既有 ACH 檔
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                選擇或拖放 <Box component="code" sx={{ fontFamily: "monospace" }}>.txt</Box>{" "}
                固定長度上傳檔（BOF 列 CDATA 為{" "}
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {schema.code}
                </Box>{" "}
                或其他已支援代號）。
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
                  上傳既有 P01／R01（.txt）
                </Typography>
                <Typography component="li" variant="caption">
                  預覽並確認表頭／明細／列長
                </Typography>
                <Typography component="li" variant="caption">
                  檢核錯誤、修正後重新產生上傳檔
                </Typography>
              </Stack>
            </Paper>

            <Box sx={{ mt: 3, textAlign: "center" }}>
              <Button
                variant="text"
                size="small"
                onClick={() => {
                  openManualWorkspace(schema);
                  toast.message("已開啟空白表單（進階／新建）");
                }}
              >
                進階：不匯入，手動新建空白表單
              </Button>
            </Box>
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
      {partitionBar}
      <Card>
        <CardContent>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ mb: 2, justifyContent: "space-between", alignItems: { sm: "flex-start" } }}
          >
            <Box>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap",  mb: 1 }}>
                <Chip size="small" color="success" label={schema.code} sx={{ fontFamily: "monospace" }} />
                <Chip
                  size="small"
                  color="warning"
                  label={`V${schema.version.replace(/^V/i, "")}`}
                />
                <Chip size="small" variant="outlined" label={`列長 ${schema.recordLength}`} />
                {workspace.source === "import" && (
                  <Chip size="small" color="success" icon={<FileUpIcon />} label="已匯入" />
                )}
                {workspace.source === "manual" && (
                  <Chip size="small" color="warning" label="手動新建" />
                )}
                {partitionSession?.formatCode === schema.code && (
                  <Chip size="small" color="warning" icon={<ScissorsIcon />} label="分割編輯" />
                )}
              </Stack>
              <Typography variant="h6" component="h2">
                {schema.shortCode} {schema.name}・檢核與加工
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {workspace.fileName
                  ? `來源檔：${workspace.fileName} · 檢核欄位後可重新產生上傳檔`
                  : schema.description ||
                    "檢核表頭／明細後產生固定長度上傳檔"}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Chip color="primary" variant="outlined" label={`總筆數 ${stats.count}`} />
              {schema.features.sumAmount && (
                <Chip
                  color="primary"
                  variant="outlined"
                  label={`總金額 ${stats.amount.toLocaleString("zh-TW")}`}
                />
              )}
              {stats.errRows > 0 ? (
                <Chip
                  color="error"
                  icon={<AlertTriangleIcon />}
                  label={`${stats.errRows} 列錯誤`}
                />
              ) : (
                <Chip color="success" icon={<CheckCircleIcon />} label="明細正常" />
              )}
            </Stack>
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Button
              variant="contained"
              startIcon={<FileDownIcon />}
              onClick={() => void handleGenerate(["txt"])}
            >
              產生 TXT
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<EditIcon />}
              onClick={() => {
                if (
                  partitionSession?.formatCode === schema.code &&
                  partitionSession.activeIndex != null
                ) {
                  toast.message("已在分割編輯中：請用上方工作區切換／存回各包");
                  return;
                }
                if (importFile) {
                  setPartitionTools({ mode: "split" });
                  return;
                }
                setPartitionTools({ mode: "merge" });
                toast.message("未保留來源檔：可選擇索引與分割檔合併，或重新上傳後再編輯");
              }}
              title={
                importFile
                  ? "分割來源檔並在網頁逐包編輯"
                  : "合併既有分割檔，或請重新上傳來源檔後再編輯"
              }
            >
              編輯
            </Button>
            {schema.code === "ACHP01" ? (
              <Button
                variant="outlined"
                startIcon={<ArrowRightLeftIcon />}
                onClick={() => {
                  if (!validateFormData()) return;
                  setConvertOpen(true);
                }}
              >
                轉檔 R01
              </Button>
            ) : null}
            <Button
              variant="outlined"
              startIcon={<FileUpIcon />}
              onClick={() => fileInputRef.current?.click()}
            >
              重新上傳
            </Button>
            {fileInput}
            {partitionSession?.formatCode !== schema.code ? (
              <Button
                variant="text"
                color="error"
                startIcon={<RestartAltIcon />}
                onClick={() => {
                  setPartitionFormDirty(false);
                  setImportFile(null);
                  setImportResult(null);
                  setImportProgress(null);
                  closeWorkspace(schema);
                  toast.message("已清除所有紀錄，請重新上傳檔案");
                }}
              >
                清除並回到上傳
              </Button>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <div className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-bold">控制首錄</h3>
          <p className="text-xs text-muted">
            對照財金控制首錄欄位名稱與值（不含長度／起迄）；可編輯處理日期等來源欄。
          </p>
        </div>
        <ControlHeaderFields
          schema={schema}
          header={header}
          branches={branches}
          edit={{
            header,
            errors: headerErrs,
            onChange: (key, value) =>
              setHeaderT(schema.code, schema, key, value),
            onBlur: onHeaderBlur,
            fieldMeta,
            selectOptions,
            onPick: (mode, key) =>
              setPicker({ mode, target: "header", key }),
          }}
        />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h3 className="font-bold">控制尾錄</h3>
          <p className="text-xs text-muted">
            對照財金控制尾錄；總筆數／總金額依明細自動計算，前一營業日於提回檔可編輯。
          </p>
        </div>
        <ControlTrailerFields
          schema={schema}
          header={header}
          branches={branches}
          totalCount={stats.count}
          totalAmount={stats.amount}
          edit={{
            header,
            errors: headerErrs,
            onChange: (key, value) =>
              setHeaderT(schema.code, schema, key, value),
            onBlur: onHeaderBlur,
            fieldMeta,
            selectOptions,
            onPick: (mode, key) =>
              setPicker({ mode, target: "header", key }),
          }}
        />
      </div>

      <div className="card">
        <div className="border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">明細資料（檢核）</h3>
              <p className="text-xs text-muted">
                依匯入內容檢核；可修正後重新產生。亦可從 Excel 貼上（Tab 分隔：
                {schema.form.detail.map((f) => f.label).join("、")}）
                {filterEnabled && " · 篩選僅影響畫面，產檔仍含全部明細"}
              </p>
            </div>
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

          {filterEnabled && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="relative min-w-[12rem] max-w-sm flex-1">
                <SearchIcon sx={{ position:"absolute", top:"50%", left:10, transform:"translateY(-50%)", fontSize:16, color:"text.disabled", pointerEvents:"none" }} />
                <input
                  className="field-input h-8 pl-8 text-sm"
                  placeholder="全域搜尋（任一欄位包含…）"
                  value={filterOpts.global ?? ""}
                  onChange={(e) =>
                    setFilterOpts((o) => ({ ...o, global: e.target.value }))
                  }
                />
              </div>
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
                {schema.form.detail.map((f) => {
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
                <th className="min-w-32">
                  <span className="th-label">銀行名稱</span>
                  {filterEnabled ? (
                    <span className="block h-[1.7rem]" aria-hidden />
                  ) : null}
                </th>
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
                    colSpan={schema.form.detail.length + 3}
                    className="py-10 text-center text-muted"
                  >
                    {filtersActive
                      ? "沒有符合篩選條件的明細列"
                      : "尚無明細資料"}
                  </td>
                </tr>
              ) : (
                pagedDetails.map(({ row, index: idx }) => {
                  const errs = rowErrs[idx] ?? {};
                  const messages = rowErrorMessages(errs);
                  const hasErr = messages.length > 0;
                  const bankName =
                    lookupBranch(row.bankCode ?? "", branches)?.name || "";
                  return (
                    <tr
                      key={row.id}
                      className={hasErr ? "has-error" : undefined}
                    >
                      <td className="text-center text-faint">{idx + 1}</td>
                      {schema.form.detail.map((field) => (
                        <td key={field.key}>
                          <div className="flex gap-0.5">
                            <input
                              className={`cell-input ${field.ui?.align === "right" ? "text-right" : ""} ${errs[field.key] ? "err" : ""}`}
                              value={row[field.key] ?? ""}
                              onChange={(e) =>
                                updateRowT(
                                  schema.code,
                                  schema,
                                  row.id,
                                  field.key,
                                  e.target.value,
                                )
                              }
                              onBlur={() =>
                                blurRow(schema.code, schema, row.id, field.key)
                              }
                              onPaste={
                                field.key === schema.form.detail[0]?.key
                                  ? (e) => {
                                      const text =
                                        e.clipboardData.getData("text");
                                      if (
                                        text.includes("\t") ||
                                        text.includes("\n")
                                      ) {
                                        e.preventDefault();
                                        pasteRows(
                                          schema.code,
                                          schema,
                                          idx,
                                          text,
                                        );
                                      }
                                    }
                                  : undefined
                              }
                            />
                          </div>
                        </td>
                      ))}
                      <td
                        className="max-w-36 truncate text-muted"
                        title={bankName}
                      >
                        {bankName}
                      </td>
                      <td className="whitespace-pre-line text-xs font-semibold text-danger">
                        {messages.join("\n")}
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
