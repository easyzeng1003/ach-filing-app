import { useMemo, useState } from "react";
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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Close as CloseIcon,
  ContentCut as ScissorsIcon,
  SwapHoriz as ArrowRightLeftIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import type { Branch, FormatSchema, Txid } from "@/lib/ach/schema";
import {
  describeSaveResult,
  saveAchFiles,
} from "@/lib/ach/desktop";
import {
  PARTITION_LIMITS,
  convertLargeP01FileToR01,
  partitionAchFile,
  partitionIndexFilename,
  planPartitions,
  planPartitionsForEdit,
  stringifyPartitionIndex,
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
import { prevRocDate, safeDigits } from "@/lib/ach/utils";
import { LineEndingSelect } from "./LineEndingSelect";

type Mode = "split" | "convert";

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
  const [agentBank, setAgentBank] = useState("");

  const title =
    mode === "split"
      ? "編輯・分割來源檔"
      : "大檔轉 R01（分塊→合併）";

  const TitleIcon =
    mode === "split"
      ? ScissorsIcon
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
    const agentDigits = safeDigits(agentBank).slice(0, 7);
    if (agentDigits.length !== 7) {
      toast.error("請填寫七碼代表行代號");
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
          agentBank: agentDigits,
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
          sx={{ alignItems: "center" }}
        >
          <TitleIcon color="primary" />
          <Typography variant="h6" component="span" sx={{ display: "block" }}>
            {title}
          </Typography>
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
              </Alert>

              <TextField
                label="分割檔數 y"
                type="number"
                fullWidth
                size="small"
                placeholder={String(suggested.partCount || 1)}
                slotProps={{ htmlInput: { min: 1 } }}
                value={partCount}
                onChange={(e) => setPartCount(Number(e.target.value) || 1)}
                disabled={busy}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={openForEdit}
                    onChange={(e) => setOpenForEdit(e.target.checked)}
                    disabled={busy}
                  />
                }
                label="分割後在網頁編輯"
                sx={{ m: 0 }}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={alsoDownload || !openForEdit}
                    onChange={(e) => setAlsoDownload(e.target.checked)}
                    disabled={busy || !openForEdit}
                  />
                }
                label="同時下載 ZIP／資料夾"
                sx={{ m: 0 }}
              />
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
                agentBank={agentBank}
                tdate={tdate}
                busy={busy}
                onRcode={setRcode}
                onYdate={setYdate}
                onPdate={setPdate}
                onAgentBank={setAgentBank}
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
  agentBank,
  tdate,
  busy,
  onRcode,
  onYdate,
  onPdate,
  onAgentBank,
}: {
  rcode: string;
  ydate: string;
  pdate: string;
  agentBank: string;
  tdate: string;
  busy: boolean;
  onRcode: (v: string) => void;
  onYdate: (v: string) => void;
  onPdate: (v: string) => void;
  onAgentBank: (v: string) => void;
}) {
  const rDigits = safeDigits(rcode).padStart(2, "0").slice(-2);
  const agentDigits = safeDigits(agentBank).slice(0, 7);
  const agentBankError =
    agentDigits.length > 0 && agentDigits.length !== 7 ? "須為七碼" : null;
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="處理日期（TDATE）"
          fullWidth
          size="small"
          value={safeDigits(tdate).slice(0, 8) || ""}
          disabled
          placeholder="01150804"
          sx={{ "& input": { fontFamily: "monospace" } }}
        />
        <TextField
          label="代表行代號"
          fullWidth
          size="small"
          slotProps={{ htmlInput: { maxLength: 7, inputMode: "numeric" } }}
          value={agentBank}
          onChange={(e) => onAgentBank(safeDigits(e.target.value).slice(0, 7))}
          disabled={busy}
          placeholder="0040000"
          error={Boolean(agentBankError)}
          helperText={agentBankError ?? undefined}
          sx={{ "& input": { fontFamily: "monospace" } }}
        />
      </Stack>
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
