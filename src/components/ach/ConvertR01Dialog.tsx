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
  /** 來源已是 R01 時，標題改為輸出退件（仍填 RCODE） */
  sourceIsR01?: boolean;
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
  sourceIsR01 = false,
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
  const agentBankError =
    agentDigits.length > 0 && agentDigits.length !== 7 ? "須為七碼" : null;
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
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <ArrowRightLeftIcon color="primary" />
          <Typography variant="h6" component="span">
            {sourceIsR01
              ? "輸出 R01（退件理由）"
              : "轉檔 P01 → R01（提回／退件）"}
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
          <Alert severity="info" variant="outlined">
            將轉換整檔{" "}
            <strong>{detailCount.toLocaleString("zh-TW")}</strong>{" "}
            筆有效明細為單一 ACHR01 檔。
          </Alert>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="處理日期（TDATE）"
              fullWidth
              size="small"
              value={safeDigits(tdate).slice(0, 8)}
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
              onChange={(e) =>
                setAgentBank(safeDigits(e.target.value).slice(0, 7))
              }
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
