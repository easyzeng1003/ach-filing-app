import { useEffect, useMemo, useState } from "react";
import {
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
  Paper,
} from "@mui/material";
import {
  AccountBalance as AccountBalanceIcon,
  Build as BuildIcon,
  Construction as ConstructionIcon,
  Edit as EditIcon,
  Tune as TuneIcon,
  Description as DescriptionIcon,
  Folder as FolderIcon,
  Handyman as HandymanIcon,
  Settings as SettingsIcon,
  SwapHoriz as SwapHorizIcon,
  Code as BracesIcon,
  HelpOutlined as HelpIcon,
  Business as BuildingIcon,
  Description as FileStackIcon,
  Security as ShieldIcon,
} from "@mui/icons-material";
import { Toaster } from "sonner";
import "@/styles.css";
import { useFormStore, useRefStore } from "@/lib/ach/store";
import type { BrandingIconPreset } from "@/lib/branding";
import { FormatPanel } from "@/components/ach/FormatPanel";
import { SchemaPanel } from "@/components/ach/SchemaPanel";
import { RefsPanel } from "@/components/ach/RefsPanel";
import { HelpPanel } from "@/components/ach/HelpPanel";
import { useBranding } from "@/theme/AppProviders";

const ICONS: Record<string, typeof FileStackIcon> = {
  "file-stack": FileStackIcon,
  shield: ShieldIcon,
};

const BRAND_ICONS: Record<BrandingIconPreset, typeof AccountBalanceIcon> = {
  account_balance: AccountBalanceIcon,
  build: BuildIcon,
  construction: ConstructionIcon,
  edit: EditIcon,
  tune: TuneIcon,
  description: DescriptionIcon,
  folder: FolderIcon,
  handyman: HandymanIcon,
  settings: SettingsIcon,
  swap_horiz: SwapHorizIcon,
};

export function AppShell() {
  const branding = useBranding();
  const BrandIcon = BRAND_ICONS[branding.iconPreset] ?? AccountBalanceIcon;
  const {
    loadRefs,
    loaded,
    loading,
    loadError,
    txids,
    branches,
    formatList,
    formats,
  } = useRefStore();
  const { activeCode, setActiveCode, ensureForm } = useFormStore();
  const list = formatList();
  const [tab, setTab] = useState("");

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    if (!loaded || !list.length) return;
    const initial =
      list.find((f) => f.code === activeCode)?.code ?? list[0]!.code;
    setTab((t) =>
      t && (t === "refs" || t === "schema" || t === "help" || formats[t])
        ? t
        : initial,
    );
    const schema = formats[initial];
    if (schema) ensureForm(schema);
  }, [loaded, list, activeCode, formats, ensureForm]);

  const formatTabs = useMemo(
    () =>
      list.map((f) => ({
        id: f.code,
        label: `${f.shortCode} ${f.name}`,
        icon: ICONS[f.icon || ""] || FileStackIcon,
      })),
    [list],
  );

  const allTabs = useMemo(
    () => [
      ...formatTabs,
      { id: "schema", label: "格式參數", icon: BracesIcon },
      { id: "refs", label: "代碼查詢", icon: BuildingIcon },
      { id: "help", label: "說明", icon: HelpIcon },
    ],
    [formatTabs],
  );

  function selectTab(id: string) {
    setTab(id);
    if (formats[id]) setActiveCode(id);
  }

  const activeSchema = formats[tab];
  const tabIndex = Math.max(
    0,
    allTabs.findIndex((t) => t.id === tab),
  );

  return (
    <Box
      className="app-shell"
      sx={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
      }}
    >
      <AppBar position="sticky" color="primary" enableColorOnDark>
        <Toolbar
          sx={{
            flexWrap: "wrap",
            gap: 1.5,
            py: 1.5,
            alignItems: "flex-start",
            minHeight: "auto !important",
          }}
        >
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center",  flex: "1 1 auto", minWidth: 220 }}
          >
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 1,
                display: "grid",
                placeItems: "center",
                bgcolor: "rgba(255,255,255,0.12)",
                overflow: "hidden",
              }}
            >
              {branding.iconUrl ? (
                <Box
                  component="img"
                  src={branding.iconUrl}
                  alt=""
                  sx={{
                    width: 32,
                    height: 32,
                    objectFit: "contain",
                  }}
                />
              ) : (
                <BrandIcon sx={{ color: "secondary.light" }} />
              )}
            </Box>
            <Box>
              <Typography variant="h6" component="h1" sx={{ lineHeight: 1.25 }}>
                {branding.name}
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            {loading && (
              <Chip
                size="small"
                icon={<CircularProgress size={14} color="inherit" />}
                label="載入中…"
                sx={{ bgcolor: "rgba(255,255,255,0.12)", color: "inherit" }}
              />
            )}
            {loaded && (
              <Chip
                size="small"
                color="secondary"
                variant="filled"
                label={`格式 ${list.length} · 交易 ${txids.length} · 銀行 ${branches.length}`}
              />
            )}
            {loadError && (
              <Chip size="small" color="error" label={loadError} />
            )}
          </Stack>
        </Toolbar>

        <Tabs
          value={allTabs[tabIndex]?.id ?? false}
          onChange={(_, value: string) => selectTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          textColor="inherit"
          indicatorColor="secondary"
          aria-label="主要分頁"
          sx={{
            px: { xs: 1, sm: 2 },
            bgcolor: "rgba(0,0,0,0.12)",
            minHeight: 48,
            "& .MuiTab-root": { color: "rgba(255,255,255,0.78)" },
            "& .Mui-selected": { color: "#fff" },
          }}
        >
          {allTabs.map(({ id, label, icon: Icon }) => (
            <Tab
              key={id}
              value={id}
              icon={<Icon fontSize="small" />}
              iconPosition="start"
              label={label}
            />
          ))}
        </Tabs>
      </AppBar>

      <Container
        maxWidth="xl"
        component="main"
        sx={{ flex: 1, py: { xs: 2.5, sm: 3 }, width: "100%" }}
      >
        {!loaded && loading ? (
          <Paper
            sx={{
              minHeight: 256,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              p: 4,
            }}
          >
            <CircularProgress color="primary" />
            <Typography color="text.secondary">
              正在載入格式定義與代碼…
            </Typography>
          </Paper>
        ) : loadError && !loaded ? (
          <Paper sx={{ p: 4, textAlign: "center" }}>
            <Typography color="error" sx={{ mb: 2, fontWeight: 700 }}>
              載入失敗：{loadError}
            </Typography>
            <Button variant="contained" onClick={() => void loadRefs()}>
              重試
            </Button>
          </Paper>
        ) : (
          <>
            {activeSchema && (
              <FormatPanel schema={activeSchema} onSelectFormat={selectTab} />
            )}
            {tab === "schema" && <SchemaPanel />}
            {tab === "refs" && <RefsPanel />}
            {tab === "help" && <HelpPanel />}
          </>
        )}
      </Container>

      <Box
        component="footer"
        sx={{
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          px: 2,
          py: 1.5,
          textAlign: "center",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          格式由 JSON 參數驅動 · Material UI · 純 HTML + JavaScript 靜態版
        </Typography>
      </Box>
      <Toaster position="top-center" richColors closeButton />
    </Box>
  );
}
