import {
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
} from "@mui/material";
import {
  LINE_ENDING_OPTIONS,
  type LineEndingId,
} from "@/lib/ach/lineEnding";
import { usePrefsStore } from "@/lib/ach/prefsStore";

type Props = {
  size?: "small" | "medium";
  /** 緊湊模式（分割工作區列） */
  compact?: boolean;
};

/** 輸出分行符號選擇（依 OS 預設，可覆寫） */
export function LineEndingSelect({ size = "small", compact = false }: Props) {
  const lineEnding = usePrefsStore((s) => s.lineEnding);
  const setLineEnding = usePrefsStore((s) => s.setLineEnding);

  return (
    <FormControl size={size} sx={{ minWidth: compact ? 148 : 180 }}>
      <InputLabel id="ach-line-ending-label">分行符號</InputLabel>
      <Select
        labelId="ach-line-ending-label"
        label="分行符號"
        value={lineEnding}
        onChange={(e: SelectChangeEvent<LineEndingId>) => {
          setLineEnding(e.target.value as LineEndingId);
        }}
      >
        {LINE_ENDING_OPTIONS.map((o) => (
          <MenuItem key={o.id} value={o.id}>
            {compact ? o.shortLabel : o.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
