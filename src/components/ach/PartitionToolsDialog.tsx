import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Close as CloseIcon,
  ContentCut as ScissorsIcon,
  MergeType as CombineIcon,
  SwapHoriz as ArrowRightLeftIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import type { Branch, FormatSchema, Txid } from "@/lib/ach/schema";
import {
  describeSaveResult,
  saveAchFile,
  saveAchFiles,
} from "@/lib/ach/desktop";
import {
  PARTITION_LIMITS,
  convertLargeP01FileToR01,
  convertMergedP01PartitionsToR01,
  mergeAchPartitions,
  parsePartitionIndex,
  partitionAchFile,
  partitionIndexFilename,
  planPartitions,
  planPartitionsForEdit,
  readFileAsLatin1,
  stringifyPartitionIndex,
  type PartitionIndex,
  type PartitionProgress,
} from "@/lib/ach/partition";
import {
  splitFileAndStartEdit,
  usePartitionStore,
} from "@/lib/ach/partitionStore";
import { RETURN_CODES } from "@/lib/ach/convertR01";
import { IMPORT_LIMITS } from "@/lib/ach/import";
import { withLineEndingId } from "@/lib/ach/lineEnding";
import { usePrefsStore } from "@/lib/ach/prefsStore";
import { resolveExcludeDoc } from "@/lib/ach/excludeStore";
import { prevRocDate, safeDigits } from "@/lib/ach/utils";
import { LineEndingSelect } from "./LineEndingSelect";

type Mode = "split" | "merge" | "convert";

type Props = {
  open: boolean;
  mode: Mode;
  schema: FormatSchema;
  formats: Record<string, FormatSchema>;
  txids: Txid[];
  branches: Branch[];
  /** 分割／大檔轉檔的來源檔 */
  sourceFile?: File | null;
  detailCount?: number;
  tdate?: string;
  onClose: () => void;
  /** 分割後開啟網頁編輯：載入第一包到表單 */
  onOpenPartitionEdit?: (payload: {
    header: import("@/lib/ach/schema").HeaderValues;
    rows: import("@/lib/ach/schema").DetailRow[];
    fileName: string;
  }) => void;
};

export function PartitionToolsDialog({
  open,
  mode,
  schema,
  formats,
  txids,
  branches,
  sourceFile = null,
  detailCount = 0,
  tdate = "",
  onClose,
  onOpenPartitionEdit,
}: Props) {
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PartitionProgress | null>(null);

  const suggested = useMemo(() => {
    try {
      return planPartitionsForEdit(detailCount || 1);
    } catch {
      return planPartitions(detailCount || 1, {
        chunkSize: PARTITION_LIMITS.defaultChunkSize,
      });
    }
  }, [detailCount]);
  const [partCount, setPartCount] = useState(suggested.partCount || 1);
  /** 分割後在網頁逐包編輯（預設開啟） */
  const [openForEdit, setOpenForEdit] = useState(true);
  /** 是否另外下載 ZIP */
  const [alsoDownload, setAlsoDownload] = useState(false);

  const [rcode, setRcode] = useState("04");
  const [ydate, setYdate] = useState(
    () => prevRocDate(safeDigits(tdate)) ?? "",
  );
  const [pdate, setPdate] = useState(() => safeDigits(tdate));

  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [mergeConvert, setMergeConvert] = useState(false);

  const title =
    mode === "split"
      ? "編輯・分割來源檔"
      : mode === "merge"
        ? "編輯・合併分割檔"
        : "大檔轉 R01（分塊→合併）";

  const TitleIcon =
    mode === "split"
      ? ScissorsIcon
      : mode === "merge"
        ? CombineIcon
        : ArrowRightLeftIcon;

  async function handleSplit() {
    if (!sourceFile) {
      toast.error("沒有來源檔");
      return;
    }
    setBusy(true);
    setProgress(null);
    try {
      let y = Math.max(1, Math.floor(partCount));
      if (openForEdit) {
        const plan = planPartitionsForEdit(detailCount || 1, y);
        if (plan.autoRaised) {
          toast.message(
            `為可在網頁編輯，已自動調整為 ${plan.partCount} 包（每包 ≤ ${IMPORT_LIMITS.maxFormDetailRows.toLocaleString("zh-TW")} 筆）`,
          );
        }
        y = plan.partCount;
        setPartCount(y);

        const result = await splitFileAndStartEdit({
          file: sourceFile,
          schema,
          txids,
          branches,
          detailCount: detailCount || 1,
          preferredPartCount: y,
          onProgress: setProgress,
        });

        if (alsoDownload) {
          const sess = usePartitionStore.getState().session;
          if (sess) {
            const downloadList = [
              ...sess.parts.map((p) => ({
                filename: p.filename,
                content: p.content,
              })),
              {
                filename: partitionIndexFilename(sourceFile.name),
                content: stringifyPartitionIndex(sess.index),
                mime: "application/json;charset=utf-8",
              },
            ];
            const base =
              sourceFile.name.replace(/\.[^.]+$/, "") || schema.code;
            const saved = await saveAchFiles(downloadList, {
              zipName: `${base}.parts.zip`,
            });
            if (saved.method !== "canceled") {
              toast.success(
                `已下載分割包 · ${describeSaveResult(saved)}`,
              );
            }
          }
        }

        onOpenPartitionEdit?.({
          header: result.first.header,
          rows: result.first.rows,
          fileName: result.first.fileName,
        });
        toast.success(
          `已分割 ${result.partCount} 包（共 ${result.totalDetailCount.toLocaleString("zh-TW")} 筆），已載入第 1 包供編輯`,
        );
        onClose();
        return;
      }

      const partFiles: { filename: string; content: string }[] = [];
      const outSchema = withLineEndingId(
        schema,
        usePrefsStore.getState().lineEnding,
      );
      const index = await partitionAchFile(
        sourceFile,
        outSchema,
        txids,
        branches,
        {
          partCount: y,
          onProgress: setProgress,
          onPartition: (p) => {
            partFiles.push({ filename: p.filename, content: p.content });
          },
        },
      );

      const downloadList = [
        ...partFiles,
        {
          filename: partitionIndexFilename(sourceFile.name),
          content: stringifyPartitionIndex(index),
          mime: "application/json;charset=utf-8",
        },
      ];
      const base =
        sourceFile.name.replace(/\.[^.]+$/, "") || schema.code;
      const saved = await saveAchFiles(downloadList, {
        zipName: `${base}.parts.zip`,
      });
      if (saved.method === "canceled") {
        toast.message("已取消儲存");
        return;
      }
      toast.success(`已下載分割包 · ${describeSaveResult(saved)}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "分割失敗");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleMerge() {
    if (mergeFiles.length < 2) {
      toast.error("請同時選擇索引 JSON 與分割 .txt 檔");
      return;
    }
    setBusy(true);
    try {
      const indexFile = mergeFiles.find((f) =>
        f.name.toLowerCase().endsWith(".json"),
      );
      if (!indexFile) throw new Error("請包含 partition-index.json");
      const index = parsePartitionIndex(await indexFile.text()) as PartitionIndex;
      const target =
        formats[index.formatCode] ??
        (index.formatCode === schema.code ? schema : null);
      if (!target) {
        throw new Error(`找不到格式定義 ${index.formatCode}`);
      }
      const outTarget = withLineEndingId(
        target,
        usePrefsStore.getState().lineEnding,
      );

      const parts = new Map<string, string>();
      for (const f of mergeFiles) {
        if (f.name.toLowerCase().endsWith(".json")) continue;
        // latin1：固定長度尾端空白不被 UTF-8／trim 弄丟
        parts.set(f.name, await readFileAsLatin1(f));
      }

      if (mergeConvert && index.formatCode === "ACHP01") {
        const r01 = formats.ACHR01;
        if (!r01) throw new Error("找不到 ACHR01");
        const result = convertMergedP01PartitionsToR01(
          withLineEndingId(r01, usePrefsStore.getState().lineEnding),
          outTarget,
          { index, parts },
          txids,
          branches,
          {
            rcode: safeDigits(rcode).padStart(2, "0").slice(-2),
            ydate: safeDigits(ydate),
            pdate: safeDigits(pdate),
          },
        );
        const saved = await saveAchFiles(
          result.files.map((f) => ({
            filename: f.filename,
            content: f.content,
          })),
        );
        if (saved.method === "canceled") {
          toast.message("已取消儲存");
          return;
        }
        toast.success(
          `已合併轉檔 R01（${result.detailCount.toLocaleString("zh-TW")} 筆）· ${describeSaveResult(saved)}`,
        );
      } else {
        const merged = mergeAchPartitions(
          outTarget,
          { index, parts },
          txids,
          branches,
          { exclude: resolveExcludeDoc(outTarget.code) },
        );
        await saveAchFile(merged.filename, merged.content);
        const excludeNote =
          merged.excludedCount > 0
            ? `（已排除 ${merged.excludedCount.toLocaleString("zh-TW")} 筆）`
            : "";
        toast.success(
          `已合併 ${merged.filename}（${merged.detailCount.toLocaleString("zh-TW")} 筆${excludeNote}）`,
        );
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "合併失敗");
    } finally {
      setBusy(false);
    }
  }

  async function handleLargeConvert() {
    if (!sourceFile) {
      toast.error("沒有來源檔");
      return;
    }
    const r01 = formats.ACHR01;
    const p01 = formats.ACHP01 ?? schema;
    if (!r01 || p01.code !== "ACHP01") {
      toast.error("大檔轉 R01 需要 ACHP01／ACHR01 格式");
      return;
    }
    setBusy(true);
    setProgress(null);
    try {
      const endingId = usePrefsStore.getState().lineEnding;
      const result = await convertLargeP01FileToR01(
        sourceFile,
        withLineEndingId(p01, endingId),
        withLineEndingId(r01, endingId),
        txids,
        branches,
        {
          rcode: safeDigits(rcode).padStart(2, "0").slice(-2),
          ydate: safeDigits(ydate),
          pdate: safeDigits(pdate),
          onProgress: setProgress,
        },
      );
      const saved = await saveAchFiles(
        result.files.map((f) => ({
          filename: f.filename,
          content: f.content,
        })),
      );
      if (saved.method === "canceled") {
        toast.message("已取消儲存");
        return;
      }
      toast.success(
        `已大檔轉 R01（${result.detailCount.toLocaleString("zh-TW")} 筆）· ${describeSaveResult(saved)}`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "大檔轉檔失敗");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const progressLabel = progress
    ? progress.phase === "count"
      ? `掃描中… ${progress.detailCount.toLocaleString("zh-TW")} 筆`
      : progress.phase === "write"
        ? `寫出分割 ${progress.partIndex}/${progress.partCount}`
        : progress.phase === "convert"
          ? `轉檔中… ${progress.detailCount.toLocaleString("zh-TW")} 筆`
          : "合併中…"
    : null;

  const primaryLabel =
    mode === "split"
      ? openForEdit
        ? "分割並開始編輯"
        : "分割並下載"
      : mode === "merge"
        ? mergeConvert
          ? "合併並轉 R01"
          : "合併下載"
        : "開始大檔轉 R01";

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="partition-tools-title"
      slotProps={{
        paper: {
          sx: { position: "relative" },
        },
      }}
    >
      <DialogTitle id="partition-tools-title" sx={{ pr: 6 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "flex-start" }}
        >
          <TitleIcon color="primary" sx={{ mt: 0.25 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" component="span" sx={{ display: "block" }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {mode === "split" &&
                "編輯大檔：將明細切成多包後在網頁逐包修改（每包 ≤ 可編輯上限），再合併輸出；也可另存 ZIP。"}
              {mode === "merge" &&
                "編輯完成後：選擇索引 JSON 與全部 part*.txt，合併回單一 ACH 大檔（可順便轉 R01）。"}
              {mode === "convert" &&
                "不經表單：串流分塊轉 ACHR01；多檔結果打包 ZIP 或寫入同一資料夾。"}
            </Typography>
          </Box>
        </Stack>
        <IconButton
          aria-label="關閉"
          onClick={onClose}
          disabled={busy}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2.5}>
          <LineEndingSelect />
          <Typography variant="caption" color="text.secondary">
            排除條件請於主畫面「排除後輸出」設定；合併時會一併套用。
          </Typography>
          {mode === "split" && (
            <>
              <Alert severity="info" variant="outlined" sx={{ alignItems: "flex-start" }}>
                來源{" "}
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {sourceFile?.name ?? "—"}
                </Box>
                {detailCount > 0
                  ? ` · ${detailCount.toLocaleString("zh-TW")} 筆`
                  : ""}
                。分割檔數無上限（至多等於明細筆數）。
              </Alert>

              <TextField
                label="分割檔數 y"
                type="number"
                fullWidth
                size="small"
                slotProps={{ htmlInput: { min: 1 } }}
                value={partCount}
                onChange={(e) => setPartCount(Number(e.target.value) || 1)}
                disabled={busy}
                helperText={`建議至少 ${suggested.partCount || 1} 包（每包 ≤ ${IMPORT_LIMITS.maxFormDetailRows.toLocaleString("zh-TW")} 筆才能在網頁編輯）；檔數不設上限`}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={openForEdit}
                    onChange={(e) => setOpenForEdit(e.target.checked)}
                    disabled={busy}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      分割後在網頁編輯
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      開啟分割工作區，逐包載入表單修改，再「合併全部輸出」
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", m: 0 }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={alsoDownload || !openForEdit}
                    onChange={(e) => setAlsoDownload(e.target.checked)}
                    disabled={busy || !openForEdit}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      同時下載 ZIP／資料夾
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      未勾選「網頁編輯」時會自動下載
                    </Typography>
                  </Box>
                }
                sx={{ alignItems: "flex-start", m: 0 }}
              />
            </>
          )}

          {mode === "merge" && (
            <>
              <input
                ref={mergeInputRef}
                type="file"
                multiple
                accept=".txt,.json,text/plain,application/json"
                hidden
                onChange={(e) =>
                  setMergeFiles(Array.from(e.target.files ?? []))
                }
              />
              <Button
                variant="outlined"
                fullWidth
                disabled={busy}
                onClick={() => mergeInputRef.current?.click()}
              >
                選擇索引 JSON ＋ 分割 txt（可多選）
              </Button>
              {mergeFiles.length > 0 && (
                <List
                  dense
                  sx={{
                    maxHeight: 160,
                    overflow: "auto",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    bgcolor: "grey.50",
                    py: 0,
                  }}
                >
                  {mergeFiles.map((f) => (
                    <ListItem key={f.name} dense>
                      <ListItemText
                        primary={f.name}
                        slotProps={{
                          primary: {
                            variant: "caption",
                            sx: { fontFamily: "monospace" },
                          },
                        }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={mergeConvert}
                    onChange={(e) => setMergeConvert(e.target.checked)}
                    disabled={busy}
                  />
                }
                label="合併時一併轉成 ACHR01（來源須為 ACHP01 分割）"
              />
              {mergeConvert && (
                <ConvertFields
                  rcode={rcode}
                  ydate={ydate}
                  pdate={pdate}
                  busy={busy}
                  onRcode={setRcode}
                  onYdate={setYdate}
                  onPdate={setPdate}
                />
              )}
            </>
          )}

          {mode === "convert" && (
            <>
              <Alert severity="info" variant="outlined">
                來源{" "}
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {sourceFile?.name ?? "—"}
                </Box>
                {detailCount > 0
                  ? ` · ${detailCount.toLocaleString("zh-TW")} 筆`
                  : ""}
              </Alert>
              <ConvertFields
                rcode={rcode}
                ydate={ydate}
                pdate={pdate}
                busy={busy}
                onRcode={setRcode}
                onYdate={setYdate}
                onPdate={setPdate}
              />
            </>
          )}

          {progressLabel && (
            <Box>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: "center", mb: 1 }}
              >
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">
                  {progressLabel}
                </Typography>
              </Stack>
              <LinearProgress />
            </Box>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          取消
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          startIcon={
            busy ? <CircularProgress size={16} color="inherit" /> : undefined
          }
          onClick={() => {
            if (mode === "split") void handleSplit();
            else if (mode === "merge") void handleMerge();
            else void handleLargeConvert();
          }}
        >
          {busy ? "處理中…" : primaryLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConvertFields({
  rcode,
  ydate,
  pdate,
  busy,
  onRcode,
  onYdate,
  onPdate,
}: {
  rcode: string;
  ydate: string;
  pdate: string;
  busy: boolean;
  onRcode: (v: string) => void;
  onYdate: (v: string) => void;
  onPdate: (v: string) => void;
}) {
  const rDigits = safeDigits(rcode).padStart(2, "0").slice(-2);
  return (
    <Stack spacing={2}>
      <TextField
        select
        label="退件理由代號"
        fullWidth
        size="small"
        value={rDigits}
        onChange={(e) => onRcode(e.target.value)}
        disabled={busy}
      >
        {RETURN_CODES.map((c) => (
          <MenuItem key={c.code} value={c.code}>
            {c.label}
          </MenuItem>
        ))}
      </TextField>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
      >
        <TextField
          label="PDATE"
          fullWidth
          size="small"
          slotProps={{ htmlInput: { maxLength: 8 } }}
          value={pdate}
          onChange={(e) => onPdate(safeDigits(e.target.value).slice(0, 8))}
          disabled={busy}
          sx={{ "& input": { fontFamily: "monospace" } }}
        />
        <TextField
          label="YDATE"
          fullWidth
          size="small"
          slotProps={{ htmlInput: { maxLength: 8 } }}
          value={ydate}
          onChange={(e) => onYdate(safeDigits(e.target.value).slice(0, 8))}
          disabled={busy}
          sx={{ "& input": { fontFamily: "monospace" } }}
        />
      </Stack>
    </Stack>
  );
}
