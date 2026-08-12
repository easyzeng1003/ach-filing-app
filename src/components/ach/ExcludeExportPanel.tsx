import { useRef, useState } from "react";
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
  UploadFile as UploadIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import {
  assertExcludeFormat,
  parseExcludeRules,
  type ExcludeCompareOp,
  type ExcludeMatchMode,
} from "@/lib/ach/exclude";
import {
  resolveExcludeDoc,
  useExcludeStore,
  type ExcludeExportResult,
} from "@/lib/ach/excludeStore";
import type { FormatSchema } from "@/lib/ach/schema";
import { describeSaveResult, saveAchFiles } from "@/lib/ach/desktop";

type Props = {
  schema: FormatSchema;
  /** 分割工作區範圍提示（全包數／總筆數）；無分割時省略 */
  partitionScope?: { partCount: number; detailCount: number } | null;
  /** 執行排除並輸出 P01 檔內容 */
  onProcess: (doc: NonNullable<ReturnType<typeof resolveExcludeDoc>>) => Promise<ExcludeExportResult>;
  /**
   * 輸出 R01（整檔）：開啟 P01→R01 轉檔對話框；不套用排除條件。
   * 不提供時隱藏 R01 按鈕。
   */
  onExportR01?: () => void;
};

/** 前端排除：下拉選欄位＋輸入值；P01 可排除後輸出，R01 一律整檔轉檔 */
export function ExcludeExportPanel({
  schema,
  partitionScope = null,
  onProcess,
  onExportR01,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const conditions = useExcludeStore((s) => s.conditions);
  const matchMode = useExcludeStore((s) => s.matchMode);
  const sourceName = useExcludeStore((s) => s.sourceName);
  const lastResult = useExcludeStore((s) => s.lastResult);
  const setMatchMode = useExcludeStore((s) => s.setMatchMode);
  const addCondition = useExcludeStore((s) => s.addCondition);
  const updateCondition = useExcludeStore((s) => s.updateCondition);
  const removeCondition = useExcludeStore((s) => s.removeCondition);
  const setDoc = useExcludeStore((s) => s.setDoc);
  const setLastResult = useExcludeStore((s) => s.setLastResult);
  const clear = useExcludeStore((s) => s.clear);

  const fields = schema.form.detail;

  async function onPickJson(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseExcludeRules(await file.text());
      assertExcludeFormat(parsed, schema.code);
      setDoc(parsed, file.name);
      toast.success(`已載入排除規則（${parsed.rules.length} 條）`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "排除規則載入失敗");
    }
  }

  async function handleProcess() {
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
          `已完成排除（輸出 ${result.detailCount.toLocaleString("zh-TW")} 筆），但取消下載`,
        );
        return;
      }
      toast.success(
        `排除 ${result.excludedCount.toLocaleString("zh-TW")} 筆，輸出 ${result.detailCount.toLocaleString("zh-TW")} 筆 · ${describeSaveResult(saved)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "排除輸出失敗");
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
          排除後輸出
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
        {sourceName ? (
          <Chip size="small" color="warning" label={`JSON：${sourceName}`} />
        ) : null}
      </Stack>

      {partitionScope ? (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          將先合併<strong>全部分割工作區</strong>（{partitionScope.partCount}{" "}
          包、共 {partitionScope.detailCount.toLocaleString("zh-TW")}{" "}
          筆），再依條件排除並輸出單一檔，不會只處理目前開啟的那一包。
        </Alert>
      ) : null}

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        「排除後輸出 P01」套用下方條件；「輸出 R01（整檔）」一律轉出完整明細，不套用排除。
      </Typography>

      <Stack spacing={1.5}>
        <FormControl size="small" sx={{ maxWidth: 280 }}>
          <InputLabel id="exclude-match-mode">條件關係</InputLabel>
          <Select
            labelId="exclude-match-mode"
            label="條件關係"
            value={matchMode}
            onChange={(e: SelectChangeEvent<ExcludeMatchMode>) =>
              setMatchMode(e.target.value as ExcludeMatchMode)
            }
          >
            <MenuItem value="and">全部符合才排除（AND）</MenuItem>
            <MenuItem value="or">符合任一即排除（OR）</MenuItem>
          </Select>
        </FormControl>

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
              label={c.op === "like" ? "包含內容" : "排除內容"}
              placeholder={
                c.op === "like" ? "例：1234（欄位含此字串即排除）" : "完全相符的值"
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

        <Typography variant="caption" color="text.secondary">
          「等於」完全相符；「包含」只要欄位值含輸入字串即排除（類似
          includes，不區分大小寫）。
        </Typography>

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => addCondition(fields[0]?.key ?? "")}
          >
            新增條件
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void onPickJson(f);
            }}
          />
          <Button
            size="small"
            variant="text"
            startIcon={<UploadIcon />}
            onClick={() => fileRef.current?.click()}
          >
            載入 JSON
          </Button>
          <Button
            size="small"
            variant="text"
            color="inherit"
            startIcon={<ClearIcon />}
            onClick={() => {
              clear();
              toast.message("已清除排除條件");
            }}
          >
            清除
          </Button>
          <Box sx={{ flex: 1 }} />
          {onExportR01 ? (
            <Button
              variant="outlined"
              color="primary"
              disabled={busy}
              startIcon={<SwapHorizIcon />}
              onClick={onExportR01}
              title="R01 一律整檔輸出，不套用排除條件"
            >
              輸出 R01（整檔）
            </Button>
          ) : null}
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            startIcon={<FilterIcon />}
            onClick={() => void handleProcess()}
          >
            {busy ? "處理中…" : "排除後輸出 P01"}
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
            筆 → 排除{" "}
            <strong>{lastResult.excludedCount.toLocaleString("zh-TW")}</strong>{" "}
            筆 → 輸出{" "}
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
