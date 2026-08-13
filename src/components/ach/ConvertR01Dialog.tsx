import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  Close as CloseIcon,
  SwapHoriz as ArrowRightLeftIcon,
} from "@mui/icons-material";
import { RETURN_CODES } from "@/lib/ach/convertR01";
import { prevRocDate, safeDigits } from "@/lib/ach/utils";

type Props = {
  open: boolean;
  detailCount: number;
  /** 提出檔處理日期（8 碼民國） */
  tdate: string;
  /** 收受行代表行代號（預填自主畫面） */
  agentBank?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (opts: {
    rcode: string;
    ydate: string;
    pdate: string;
    agentBank: string;
  }) => void | Promise<void>;
};

export function ConvertR01Dialog({
  open,
  detailCount,
  tdate,
  agentBank: agentBankProp = "",
  busy = false,
  onClose,
  onConfirm,
}: Props) {
  const defaultYdate = useMemo(
    () => prevRocDate(safeDigits(tdate)) ?? "",
    [tdate],
  );
  const [rcode, setRcode] = useState("04");
  const [ydate, setYdate] = useState(defaultYdate);
  const [pdate, setPdate] = useState(safeDigits(tdate));
  const [agentBank, setAgentBank] = useState(
    safeDigits(agentBankProp).slice(0, 7),
  );

  useEffect(() => {
    if (!open) return;
    setRcode("04");
    setYdate(prevRocDate(safeDigits(tdate)) ?? "");
    setPdate(safeDigits(tdate));
    setAgentBank(safeDigits(agentBankProp).slice(0, 7));
  }, [open, tdate, agentBankProp]);

  const yDigits = safeDigits(ydate);
  const pDigits = safeDigits(pdate);
  const rDigits = safeDigits(rcode).padStart(2, "0").slice(-2);
  const agentDigits = safeDigits(agentBank).slice(0, 7);
  const canSubmit =
    !busy &&
    detailCount > 0 &&
    rDigits.length === 2 &&
    yDigits.length === 8 &&
    pDigits.length === 8 &&
    agentDigits.length === 7;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="convert-r01-title"
    >
      <DialogTitle id="convert-r01-title" sx={{ pr: 6 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <ArrowRightLeftIcon color="primary" sx={{ mt: 0.25 }} />
          <Stack spacing={0.5}>
            <Typography variant="h6" component="span">
              轉檔 P01 → R01（提回／退件）
            </Typography>
            <Typography variant="body2" color="text.secondary">
              依財金 ACHP01/ACHR01 規格：TYPE=R、對調提出／提回行與帳號，並填入退件欄位。
              輸出為整檔（分割時含全部包，非僅目前開啟的那一批），不依收受行分檔。
              BOF／EOF：發送單位固定 9990250；接收單位＝代表行代號。
              若已設定篩選／排除條件，會先套用後再轉檔（筆數如下）。
            </Typography>
          </Stack>
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
          <Alert severity="info" variant="outlined">
            將轉換整檔{" "}
            <strong>{detailCount.toLocaleString("zh-TW")}</strong>{" "}
            筆有效明細為單一 ACHR01 檔（不依收受行分檔）。
          </Alert>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="處理日期（TDATE）"
              fullWidth
              size="small"
              value={safeDigits(tdate).slice(0, 8)}
              disabled
              helperText="取自表單處理日期"
              sx={{ "& input": { fontFamily: "monospace" } }}
            />
            <TextField
              label="代表行代號"
              fullWidth
              size="small"
              slotProps={{ htmlInput: { maxLength: 7, inputMode: "numeric" } }}
              value={agentBank}
              onChange={(e) =>
                setAgentBank(safeDigits(e.target.value).slice(0, 7))
              }
              disabled={busy}
              placeholder="0040000"
              error={agentDigits.length > 0 && agentDigits.length !== 7}
              helperText="七碼；寫入 BOF／EOF 接收單位（RORG）"
              sx={{ "& input": { fontFamily: "monospace" } }}
            />
          </Stack>

          <TextField
            select
            label="退件理由代號"
            fullWidth
            size="small"
            value={rDigits}
            onChange={(e) => setRcode(e.target.value)}
            disabled={busy}
          >
            {RETURN_CODES.map((c) => (
              <MenuItem key={c.code} value={c.code}>
                {c.label}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="原提示交易日期（PDATE）"
              fullWidth
              size="small"
              slotProps={{ htmlInput: { maxLength: 8, inputMode: "numeric" } }}
              value={pdate}
              onChange={(e) => setPdate(safeDigits(e.target.value).slice(0, 8))}
              disabled={busy}
              placeholder="01150804"
              sx={{ "& input": { fontFamily: "monospace" } }}
            />
            <TextField
              label="前一營業日（YDATE）"
              fullWidth
              size="small"
              slotProps={{ htmlInput: { maxLength: 8, inputMode: "numeric" } }}
              value={ydate}
              onChange={(e) => setYdate(safeDigits(e.target.value).slice(0, 8))}
              disabled={busy}
              placeholder="01150803"
              helperText="預設為處理日前一日（非營業日曆）"
              sx={{ "& input": { fontFamily: "monospace" } }}
            />
          </Stack>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          取消
        </Button>
        <Button
          variant="contained"
          disabled={!canSubmit}
          startIcon={
            busy ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <ArrowRightLeftIcon />
            )
          }
          onClick={() =>
            void onConfirm({
              rcode: rDigits,
              ydate: yDigits,
              pdate: pDigits,
              agentBank: agentDigits,
            })
          }
        >
          {busy ? "轉檔中…" : "產生 ACHR01"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
