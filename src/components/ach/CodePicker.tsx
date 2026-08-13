import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  Box,
} from "@mui/material";
import {
  Close as CloseIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import type { Branch, Txid } from "@/lib/ach/schema";
import { formatTxTypeLabel } from "@/lib/ach/engine";

type Mode = "txid" | "branch";

type Props = {
  open: boolean;
  mode: Mode;
  items: Txid[] | Branch[];
  onClose: () => void;
  onSelect: (code: string) => void;
};

export function CodePicker({ open, mode, items, onClose, onSelect }: Props) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items.slice(0, 80);
    return items
      .filter((it) => {
        if (mode === "txid") {
          const t = it as Txid;
          const typeLabel = formatTxTypeLabel(t.type).toLowerCase();
          return (
            t.code.includes(query) ||
            t.name.toLowerCase().includes(query) ||
            t.type.toLowerCase().includes(query) ||
            typeLabel.includes(query) ||
            (query.includes("代收") && t.type === "SD") ||
            (query.includes("代付") && t.type === "SC")
          );
        }
        const b = it as Branch;
        return b.code.includes(query) || b.name.toLowerCase().includes(query);
      })
      .slice(0, 120);
  }, [items, mode, q]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-label={mode === "txid" ? "選擇交易代號" : "選擇銀行代號"}
      slotProps={{
        paper: {
          sx: { maxHeight: "80vh" },
        },
      }}
    >
      <DialogTitle sx={{ pr: 6 }}>
        <Typography variant="h6" component="span" sx={{ display: "block" }}>
          {mode === "txid" ? "交易代號（代收 SD／代付 SC）" : "銀行／分行代號"}
        </Typography>
        <IconButton
          aria-label="關閉"
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Box sx={{ px: 3, pb: 2 }}>
        <TextField
          fullWidth
          size="small"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            mode === "txid"
              ? "搜尋代號、名稱、SD／SC、代收／代付…"
              : "搜尋銀行代號或名稱…"
          }
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      <DialogContent dividers sx={{ p: 0 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 112, fontWeight: 700 }}>代號</TableCell>
              {mode === "txid" ? (
                <>
                  <TableCell sx={{ width: 112, fontWeight: 700 }}>類別</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>名稱</TableCell>
                </>
              ) : (
                <>
                  <TableCell sx={{ fontWeight: 700 }}>名稱</TableCell>
                  <TableCell sx={{ width: 112, fontWeight: 700 }}>總行</TableCell>
                </>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((it) => {
              if (mode === "txid") {
                const t = it as Txid;
                return (
                  <TableRow
                    key={t.code}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => {
                      onSelect(t.code);
                      onClose();
                    }}
                  >
                    <TableCell sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                      {t.code}
                    </TableCell>
                    <TableCell>{formatTxTypeLabel(t.type)}</TableCell>
                    <TableCell>{t.name}</TableCell>
                  </TableRow>
                );
              }
              const b = it as Branch;
              return (
                <TableRow
                  key={b.code}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => {
                    onSelect(b.code);
                    onClose();
                  }}
                >
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                    {b.code}
                  </TableCell>
                  <TableCell>{b.name}</TableCell>
                  <TableCell sx={{ fontFamily: "monospace" }}>{b.head}</TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  無符合項目
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
