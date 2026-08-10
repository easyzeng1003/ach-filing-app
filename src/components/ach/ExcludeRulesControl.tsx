import { useRef } from "react";
import { Button, Chip, Stack } from "@mui/material";
import {
  FilterAltOff as ClearIcon,
  UploadFile as UploadIcon,
} from "@mui/icons-material";
import { toast } from "sonner";
import {
  assertExcludeFormat,
  countExcludeRuleFields,
  parseExcludeRules,
} from "@/lib/ach/exclude";
import { useExcludeStore } from "@/lib/ach/excludeStore";

type Props = {
  formatCode: string;
  compact?: boolean;
};

/** 載入排除規則 JSON，供合併／轉檔輸出時剔除符合條件的明細 */
export function ExcludeRulesControl({ formatCode, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const doc = useExcludeStore((s) => s.doc);
  const sourceName = useExcludeStore((s) => s.sourceName);
  const setDoc = useExcludeStore((s) => s.setDoc);
  const clear = useExcludeStore((s) => s.clear);

  async function onPick(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseExcludeRules(text);
      assertExcludeFormat(parsed, formatCode);
      setDoc(parsed, file.name);
      toast.success(
        `已載入排除規則 ${parsed.rules.length} 條（${countExcludeRuleFields(parsed)} 個欄位條件）`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "排除規則載入失敗");
    }
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ flexWrap: "wrap", alignItems: "center" }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void onPick(f);
        }}
      />
      <Button
        size="small"
        variant="outlined"
        startIcon={<UploadIcon />}
        onClick={() => inputRef.current?.click()}
      >
        {compact ? "排除規則" : "載入排除規則"}
      </Button>
      {doc ? (
        <>
          <Chip
            size="small"
            color="warning"
            label={
              compact
                ? `排除 ${doc.rules.length} 條`
                : `排除 ${doc.rules.length} 條規則${sourceName ? ` · ${sourceName}` : ""}`
            }
            title={sourceName ?? undefined}
          />
          <Button
            size="small"
            variant="text"
            color="inherit"
            startIcon={<ClearIcon />}
            onClick={() => {
              clear();
              toast.message("已清除排除規則");
            }}
          >
            清除排除
          </Button>
        </>
      ) : null}
    </Stack>
  );
}
