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
import type { FormatSchema } from "@/lib/ach/schema";
import { detailFieldsForFilter } from "@/lib/ach/formDisplay";
import { describeSaveResult, saveAchFiles } from "@/lib/ach/desktop";
import { normalizeSubmitDate, rocToDate, safeDigits, todayRoc } from "@/lib/ach/utils";

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
  /**
   * 輸出格式（首錄／尾錄 BOF/EOF）：ACHP01 或 ACHR01。
   * 與明細轉換邏輯拆開——此下拉只決定首錄／尾錄格式。
   */
  responseFormat?: "ACHP01" | "ACHR01";
  onResponseFormatChange?: (value: "ACHP01" | "ACHR01") => void;
  /** 執行篩選／排除（條件可為 null＝整檔輸出） */
  onProcess: (doc: ExcludeRulesDoc | null) => Promise<ExcludeExportResult>;
  /**
   * 原檔輸出：依上傳原格式（P01／R01）輸出，套用目前篩選／排除條件，
   * 但不跑輸出 P01／R01 的表頭檢核。不提供時隱藏按鈕。
   */
  onExportOriginal?: () => void;
  /**
   * 輸出前完整格式檢核（表頭＋明細規則）。回傳 false 時中止輸出。
   */
  onValidateBeforeExport?: () => boolean;
  /**
   * 篩選／排除後輸出 R01：開啟 P01→R01 轉檔對話框並套用目前條件。
   * 不提供時隱藏 R01 按鈕。
   */
  onExportR01?: () => void;
  /**
   * 篩選／排除後輸出 P01：將目前 R01 轉回 ACHP01 並套用條件。
   * 不提供時隱藏轉回 P01 按鈕。
   */
  onExportP01?: () => void;
  /** 輸出／轉檔進行中（父層全畫面 mask） */
  exporting?: boolean;
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
  responseFormat = "ACHR01",
  onResponseFormatChange,
  onExportOriginal,
  onExportR01,
  onExportP01,
  exporting = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const buttonsBusy = busy || exporting;
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

  // FILTER 列出 JSON form.detail 全部欄位（含 hidden），可依任一欄位篩選／排除。
  const fields = detailFieldsForFilter(schema);
  const showAgentBank = Boolean(onAgentBankChange) || Boolean(onExportR01);
  const dateDigits = safeDigits(processDate).slice(0, 8);
  const processDateError = !dateDigits
    ? null
    : dateDigits.length !== 8
      ? "日期長度請輸入八碼"
      : !rocToDate(dateDigits)
        ? "非合法日期"
        : dateDigits !== todayRoc()
          ? "處理日期須為今日"
          : null;
  const agentBankDigits = safeDigits(agentBank).slice(0, 7);
  const agentBankError =
    !showAgentBank || !agentBankDigits
      ? null
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
    ? `${actionVerb}後輸出提出檔`
    : "輸出提出檔";
  const responseLabel = hasActiveConditions
    ? `${actionVerb}後輸出回應檔`
    : "輸出回應檔";

  function guardDate(): boolean {
    if (!dateDigits) {
      toast.error("未輸入處理日期");
      return false;
    }
    if (processDateError) {
      toast.error(processDateError);
      return false;
    }
    return true;
  }

  /**
   * 輸出前共同守門：處理日期一律檢核；代表行代號（RORG）僅在首錄／尾錄為
   * ACHR01 時才需要（ACHP01 首尾錄無 RORG）。與明細 N/R 無關。
   */
  function guardExport(): boolean {
    if (!guardDate()) return false;
    if (responseFormat === "ACHR01") {
      if (!agentBankDigits) {
        toast.error("未輸入代表行代號");
        return false;
      }
      if (agentBankError) {
        toast.error(agentBankError);
        return false;
      }
    }
    return true;
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
          {onResponseFormatChange ? (
            <FormControl
              size="small"
              sx={{ minWidth: 160, maxWidth: 220, flex: "0 0 auto" }}
            >
              <InputLabel id="response-format">輸出格式（首錄／尾錄）</InputLabel>
              <Select
                labelId="response-format"
                label="輸出格式（首錄／尾錄）"
                value={responseFormat}
                onChange={(e) =>
                  onResponseFormatChange(
                    e.target.value === "ACHP01" ? "ACHP01" : "ACHR01",
                  )
                }
              >
                <MenuItem value="ACHP01">ACHP01</MenuItem>
                <MenuItem value="ACHR01">ACHR01</MenuItem>
              </Select>
            </FormControl>
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
          {onExportOriginal ? (
            <Button
              variant="outlined"
              color="inherit"
              disabled={buttonsBusy}
              startIcon={<DownloadIcon />}
              onClick={() => onExportOriginal()}
              title="原檔輸出：依上傳原格式輸出，套用目前篩選／排除（不做表頭檢核）"
            >
              原檔輸出
            </Button>
          ) : null}
          <Button
            variant="outlined"
            color="primary"
            disabled={buttonsBusy}
            startIcon={<SwapHorizIcon />}
            onClick={() => {
              if (!guardExport()) return;
              onExportP01?.();
            }}
            title={`${p01Label}（明細轉為提出 N；首錄／尾錄格式依「輸出格式」下拉）`}
          >
            {p01Label}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={buttonsBusy}
            startIcon={<SwapHorizIcon />}
            onClick={() => {
              if (!guardExport()) return;
              onExportR01?.();
            }}
            title={`${responseLabel}（明細轉為回應／退件 R；首錄／尾錄格式依「輸出格式」下拉）`}
          >
            {responseLabel}
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
