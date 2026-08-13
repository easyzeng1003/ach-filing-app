import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  type SelectChangeEvent,
} from "@mui/material";
import {
  Add as AddIcon,
  DeleteOutlined as DeleteIcon,
  Download as DownloadIcon,
  FilterAlt as FilterIcon,
  FilterAltOff as ClearIcon,
  SwapHoriz as SwapHorizIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import {
  type ExcludeActionMode,
  type ExcludeCompareOp,
  type ExcludeMatchMode,
  type ExcludeRulesDoc,
} from "@/lib/ach/exclude";
import {
  useExcludeStore,
  type ExcludeExportResult,
} from "@/lib/ach/excludeStore";
import { validateField } from "@/lib/ach/engine";
import type { FormatSchema } from "@/lib/ach/schema";
import { describeSaveResult, saveAchFiles } from "@/lib/ach/desktop";
import { normalizeSubmitDate, safeDigits } from "@/lib/ach/utils";

type Props = {
  schema: FormatSchema;
  /** 分割工作區範圍提示（全包數／總筆數）；無分割時省略 */
  partitionScope?: { partCount: number; detailCount: number } | null;
  /** 處理日期（輸出首／尾錄 TDATE） */
  processDate: string;
  onProcessDateChange: (value: string) => void;
  onProcessDateBlur?: () => void;
  /**
   * 代表行代號（ACHR01 RORG）。
   * 提供時顯示於處理日期旁；輸出 R01 必填。
   */
  agentBank?: string;
  onAgentBankChange?: (value: string) => void;
  /** 執行篩選／排除（條件可為 null＝整檔輸出） */
  onProcess: (doc: ExcludeRulesDoc | null) => Promise<ExcludeExportResult>;
  /**
   * 篩選／排除後輸出 R01：開啟 P01→R01 轉檔對話框並套用目前條件。
   * 不提供時隱藏 R01 按鈕。
   */
  onExportR01?: () => void;
};

/** 前端條件：篩選（僅保留符合）／排除（剔除符合）；可無條件整檔輸出 */
export function ExcludeExportPanel({
  schema,
  partitionScope = null,
  processDate,
  onProcessDateChange,
  onProcessDateBlur,
  agentBank = "",
  onAgentBankChange,
  onProcess,
  onExportR01,
}: Props) {
  const [busy, setBusy] = useState(false);
  const conditions = useExcludeStore((s) => s.conditions);
  const matchMode = useExcludeStore((s) => s.matchMode);
  const actionMode = useExcludeStore((s) => s.actionMode);
  const lastResult = useExcludeStore((s) => s.lastResult);
  const setMatchMode = useExcludeStore((s) => s.setMatchMode);
  const setActionMode = useExcludeStore((s) => s.setActionMode);
  const addCondition = useExcludeStore((s) => s.addCondition);
  const updateCondition = useExcludeStore((s) => s.updateCondition);
  const removeCondition = useExcludeStore((s) => s.removeCondition);
  const setLastResult = useExcludeStore((s) => s.setLastResult);
  const clear = useExcludeStore((s) => s.clear);

  const fields = schema.form.detail;
  const dateField = schema.form.header.find((f) => f.key === "date");
  const showAgentBank =
    Boolean(onAgentBankChange) ||
    schema.code === "ACHR01" ||
    Boolean(onExportR01);
  const processDateError = dateField
    ? validateField(dateField, safeDigits(processDate).slice(0, 8), {
        schema,
        header: { date: safeDigits(processDate).slice(0, 8) },
        section: "header",
        txids: [],
        branches: [],
      })
    : !safeDigits(processDate).slice(0, 8)
      ? "未輸入"
      : safeDigits(processDate).length !== 8
        ? "日期長度請輸入八碼"
        : null;
  const agentBankDigits = safeDigits(agentBank).slice(0, 7);
  // P01 面板無 agentBank schema 欄；僅檢核七碼。完整分行檢核於轉檔時執行。
  const agentBankError = !showAgentBank
    ? null
    : !agentBankDigits
      ? "未輸入代表行代號"
      : agentBankDigits.length !== 7
        ? "代表行代號須為七碼"
        : null;
  const isFilter = actionMode === "filter";
  const actionVerb = isFilter ? "篩選" : "排除";
  const actionKeepLabel = isFilter ? "保留符合" : "剔除符合";
  const hasActiveConditions = conditions.some(
    (c) => c.key.trim() && String(c.value ?? "").trim(),
  );
  const p01Label = hasActiveConditions
    ? `${actionVerb}後輸出 P01`
    : "輸出 P01";
  const r01Label = hasActiveConditions
    ? `${actionVerb}後輸出 R01`
    : "輸出 R01";

  async function handleProcess() {
    if (processDateError) {
      toast.error(processDateError);
      return;
    }
    setBusy(true);
    try {
      const doc = useExcludeStore
        .getState()
        .syncDocFromConditions(schema.code);
      const result = await onProcess(doc);
      setLastResult(result);
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
      const modeNote = hasActiveConditions
        ? `${actionVerb}後輸出`
        : "已輸出";
      toast.success(
        `${modeNote} ${result.detailCount.toLocaleString("zh-TW")} 筆` +
          (result.excludedCount > 0
            ? `（未輸出 ${result.excludedCount.toLocaleString("zh-TW")} 筆）`
            : "") +
          ` · ${describeSaveResult(saved)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "輸出失敗");
    } finally {
      setBusy(false);
    }
  }

  async function handleRedownload() {
    if (!lastResult) return;
    setBusy(true);
    try {
      const saved = await saveAchFiles([
        {
          filename: lastResult.filename,
          content: lastResult.content,
          mime: "text/plain;charset=utf-8",
        },
      ]);
      if (saved.method === "canceled") {
        toast.message("已取消下載");
        return;
      }
      toast.success(`已下載 ${lastResult.filename} · ${describeSaveResult(saved)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "下載失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      className="card"
      sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}
    >
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ flexWrap: "wrap", alignItems: "center", mb: 1.5 }}
      >
        <FilterIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          篩選／排除後輸出
        </Typography>
        {partitionScope ? (
          <Chip
            size="small"
            color="warning"
            label={`範圍：全部分割包 ${partitionScope.partCount} 包・共 ${partitionScope.detailCount.toLocaleString("zh-TW")} 筆`}
          />
        ) : (
          <Chip size="small" variant="outlined" label="範圍：目前表單明細" />
        )}
      </Stack>

      {partitionScope ? (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          將先合併<strong>全部分割工作區</strong>（{partitionScope.partCount}{" "}
          包、共 {partitionScope.detailCount.toLocaleString("zh-TW")}{" "}
          筆），再依條件輸出單一檔（無條件則整檔輸出）。
        </Alert>
      ) : null}

      <Stack spacing={1.5}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          useFlexGap
          sx={{ flexWrap: "wrap", alignItems: "flex-start" }}
        >
          <TextField
            size="small"
            label="處理日期"
            placeholder="01151231"
            value={processDate}
            onChange={(e) => onProcessDateChange(e.target.value)}
            onBlur={() => {
              const { value, convertedFromAd } = normalizeSubmitDate(processDate);
              if (value !== processDate) onProcessDateChange(value);
              if (convertedFromAd) toast.message("已將日期西元年轉換為民國年");
              onProcessDateBlur?.();
            }}
            error={Boolean(processDateError)}
            helperText={processDateError ?? undefined}
            sx={{ maxWidth: 280, flex: "1 1 200px" }}
            slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 8 } }}
          />
          {showAgentBank ? (
            <TextField
              size="small"
              label="代表行代號"
              placeholder="0040000"
              value={agentBank}
              onChange={(e) =>
                onAgentBankChange?.(safeDigits(e.target.value).slice(0, 7))
              }
              error={Boolean(agentBankError)}
              helperText={agentBankError ?? undefined}
              sx={{ maxWidth: 280, flex: "1 1 200px" }}
              slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 7 } }}
            />
          ) : null}
        </Stack>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          useFlexGap
          sx={{ flexWrap: "wrap" }}
        >
          <FormControl size="small" sx={{ minWidth: 160, maxWidth: 220 }}>
            <InputLabel id="exclude-action-mode">動作</InputLabel>
            <Select
              labelId="exclude-action-mode"
              label="動作"
              value={actionMode}
              onChange={(e: SelectChangeEvent<ExcludeActionMode>) =>
                setActionMode(e.target.value as ExcludeActionMode)
              }
            >
              <MenuItem value="filter">篩選（僅保留符合）</MenuItem>
              <MenuItem value="exclude">排除（剔除符合）</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220, maxWidth: 320 }}>
            <InputLabel id="exclude-match-mode">條件關係</InputLabel>
            <Select
              labelId="exclude-match-mode"
              label="條件關係"
              value={matchMode}
              onChange={(e: SelectChangeEvent<ExcludeMatchMode>) =>
                setMatchMode(e.target.value as ExcludeMatchMode)
              }
            >
              <MenuItem value="and">
                {isFilter
                  ? "全部符合才保留（AND）"
                  : "全部符合才排除（AND）"}
              </MenuItem>
              <MenuItem value="or">
                {isFilter
                  ? "符合任一即保留（OR）"
                  : "符合任一即排除（OR）"}
              </MenuItem>
            </Select>
          </FormControl>
          <Chip
            size="small"
            color={isFilter ? "info" : "warning"}
            variant="outlined"
            label={actionKeepLabel}
            sx={{ alignSelf: "center" }}
          />
        </Stack>

        {conditions.map((c, idx) => (
          <Stack
            key={c.id}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            useFlexGap
            sx={{ alignItems: { sm: "center" } }}
          >
            <FormControl size="small" sx={{ minWidth: 180, flex: "0 1 220px" }}>
              <InputLabel id={`ex-field-${c.id}`}>欄位</InputLabel>
              <Select
                labelId={`ex-field-${c.id}`}
                label="欄位"
                value={c.key}
                onChange={(e) =>
                  updateCondition(c.id, { key: e.target.value })
                }
              >
                <MenuItem value="">
                  <em>請選擇</em>
                </MenuItem>
                {fields.map((f) => (
                  <MenuItem key={f.key} value={f.key}>
                    {f.label}（{f.key}）
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 110, flex: "0 0 120px" }}>
              <InputLabel id={`ex-op-${c.id}`}>比對</InputLabel>
              <Select
                labelId={`ex-op-${c.id}`}
                label="比對"
                value={c.op ?? "eq"}
                onChange={(e: SelectChangeEvent<ExcludeCompareOp>) =>
                  updateCondition(c.id, {
                    op: e.target.value as ExcludeCompareOp,
                  })
                }
              >
                <MenuItem value="eq">等於</MenuItem>
                <MenuItem value="like">包含</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              label={c.op === "like" ? "包含內容" : "條件內容"}
              placeholder={
                c.op === "like"
                  ? `例：1234（欄位含此字串即${isFilter ? "保留" : "排除"}）`
                  : "完全相符的值"
              }
              value={c.value}
              onChange={(e) =>
                updateCondition(c.id, { value: e.target.value })
              }
              sx={{ flex: "1 1 200px", minWidth: 160 }}
            />
            <IconButton
              aria-label="刪除條件"
              onClick={() => removeCondition(c.id)}
              disabled={conditions.length <= 1 && !c.key && !c.value}
              size="small"
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
            {idx === 0 ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: { xs: "none", md: "block" }, minWidth: 40 }}
              >
                {matchMode === "and" ? "且" : "或"}
              </Typography>
            ) : null}
          </Stack>
        ))}

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => addCondition(fields[0]?.key ?? "")}
          >
            新增條件
          </Button>
          <Button
            size="small"
            variant="text"
            color="inherit"
            startIcon={<ClearIcon />}
            onClick={() => {
              clear();
              toast.message("已清除條件");
            }}
          >
            清除條件
          </Button>
          <Box sx={{ flex: 1 }} />
          {onExportR01 ? (
            <Button
              variant="outlined"
              color="primary"
              disabled={busy}
              startIcon={<SwapHorizIcon />}
              onClick={() => {
                if (processDateError) {
                  toast.error(processDateError);
                  return;
                }
                if (agentBankError) {
                  toast.error(agentBankError);
                  return;
                }
                onExportR01();
              }}
              title={r01Label}
            >
              {r01Label}
            </Button>
          ) : null}
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            startIcon={<FilterIcon />}
            onClick={() => void handleProcess()}
          >
            {busy ? "處理中…" : p01Label}
          </Button>
        </Stack>

        {lastResult ? (
          <Alert
            severity="success"
            action={
              <Button
                color="inherit"
                size="small"
                startIcon={<DownloadIcon />}
                disabled={busy}
                onClick={() => void handleRedownload()}
              >
                下載檔案
              </Button>
            }
          >
            處理完成
            {lastResult.partCount != null
              ? `（已涵蓋全 ${lastResult.partCount} 包）`
              : ""}
            ：原{" "}
            <strong>{lastResult.totalBefore.toLocaleString("zh-TW")}</strong>{" "}
            筆
            {lastResult.excludedCount > 0 ? (
              <>
                {" "}
                →{" "}
                {lastResult.action === "filter" ? "未符合" : "排除"}{" "}
                <strong>
                  {lastResult.excludedCount.toLocaleString("zh-TW")}
                </strong>{" "}
                筆
              </>
            ) : null}{" "}
            → 輸出{" "}
            <strong>{lastResult.detailCount.toLocaleString("zh-TW")}</strong>{" "}
            筆
            {schema.features.sumAmount ? (
              <>
                （金額合計 {lastResult.amount.toLocaleString("zh-TW")}）
              </>
            ) : null}
            <Box component="span" sx={{ display: "block", mt: 0.5 }}>
              檔名：
              <Box component="code" sx={{ fontFamily: "monospace" }}>
                {lastResult.filename}
              </Box>
            </Box>
          </Alert>
        ) : null}
      </Stack>
    </Box>
  );
}
