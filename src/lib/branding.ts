/**
 * 品牌／主題參數（URL Query 或 Hash）
 *
 * 範例：
 *   ACH改檔小工具.html?name=我的ACH工具&primary=%231566c0&accent=%23ff9800&icon=build
 *   ACH改檔小工具.html#primary=1566c0&header=0d47a1&icon=https://example.com/logo.png
 *
 * 參數：
 * - name      程式名稱（預設：ACH改檔小工具）
 * - subtitle  副標
 * - primary   主題主色／按鈕色（#RRGGBB 或 RRGGBB）
 * - header    頂欄加深色（省略則由 primary 推算）
 * - accent    強調色／次要按鈕（預設橘）
 * - icon      圖示：內建代號（account_balance／build／edit／…）或圖片 URL／data URI
 */

export const DEFAULT_APP_NAME = "ACH改檔小工具";
export const DEFAULT_APP_SUBTITLE = "既有 P01／R01 檔檢核與加工";

export const DEFAULT_BRANDING_COLORS = {
  primary: "#00695c",
  header: "#004d40",
  accent: "#ef6c00",
  primaryLight: "#439889",
  accentLight: "#ff9800",
  accentDark: "#e65100",
} as const;

/** 內建 icon 代號（對應 AppShell 的 MUI icon map） */
export const BRANDING_ICON_PRESETS = [
  "account_balance",
  "build",
  "construction",
  "edit",
  "tune",
  "description",
  "folder",
  "handyman",
  "settings",
  "swap_horiz",
] as const;

export type BrandingIconPreset = (typeof BRANDING_ICON_PRESETS)[number];

export type BrandingConfig = {
  name: string;
  subtitle: string;
  primary: string;
  header: string;
  accent: string;
  primaryLight: string;
  accentLight: string;
  accentDark: string;
  /** 內建代號；與 iconUrl 互斥優先用 iconUrl */
  iconPreset: BrandingIconPreset;
  /** 自訂圖示 URL（http(s)／data／相對路徑） */
  iconUrl: string | null;
};

function normalizeHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("#")) s = s.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toLowerCase()}`;
}

function parseHexChannel(hex: string, i: number): number {
  return Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

/** 調暗（amount 為負）／調亮（amount 為正）；絕對值 0–1 */
export function shadeHex(hex: string, amount: number): string {
  const n = normalizeHex(hex);
  if (!n) return hex;
  const p = Math.min(1, Math.abs(amount));
  const mixed = (i: number) => {
    const c = parseHexChannel(n, i);
    const v =
      amount < 0
        ? Math.round(c * (1 - p))
        : Math.round(c + (255 - c) * p);
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  };
  return `#${mixed(0)}${mixed(1)}${mixed(2)}`;
}

function softTint(hex: string): string {
  // ~12% 主色混白底
  return shadeHex(hex, 0.88);
}

function collectParamSource(): URLSearchParams {
  const out = new URLSearchParams();
  if (typeof window === "undefined") return out;
  try {
    const search = new URLSearchParams(window.location.search);
    search.forEach((v, k) => out.set(k, v));
  } catch {
    /* ignore */
  }
  try {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash && hash.includes("=")) {
      const hp = new URLSearchParams(hash);
      hp.forEach((v, k) => {
        if (!out.has(k)) out.set(k, v);
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

function resolveIcon(
  raw: string | null,
): Pick<BrandingConfig, "iconPreset" | "iconUrl"> {
  if (!raw || !raw.trim()) {
    return { iconPreset: "account_balance", iconUrl: null };
  }
  const v = raw.trim();
  if (
    /^(https?:|data:|blob:|\/|\.\/)/i.test(v) ||
    /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(v)
  ) {
    return { iconPreset: "account_balance", iconUrl: v };
  }
  const key = v.toLowerCase().replace(/-/g, "_") as BrandingIconPreset;
  if ((BRANDING_ICON_PRESETS as readonly string[]).includes(key)) {
    return { iconPreset: key, iconUrl: null };
  }
  return { iconPreset: "account_balance", iconUrl: null };
}

export function resolveBranding(
  params?: URLSearchParams | Record<string, string>,
): BrandingConfig {
  const p =
    params instanceof URLSearchParams
      ? params
      : params
        ? new URLSearchParams(params)
        : collectParamSource();

  const primary =
    normalizeHex(p.get("primary") ?? p.get("theme") ?? p.get("color")) ??
    DEFAULT_BRANDING_COLORS.primary;
  const header =
    normalizeHex(p.get("header") ?? p.get("primaryDark")) ??
    shadeHex(primary, -0.22);
  const accent =
    normalizeHex(p.get("accent") ?? p.get("secondary") ?? p.get("button")) ??
    DEFAULT_BRANDING_COLORS.accent;

  const name = (p.get("name") ?? p.get("title") ?? DEFAULT_APP_NAME).trim() ||
    DEFAULT_APP_NAME;
  const subtitle =
    (p.get("subtitle") ?? p.get("tagline") ?? DEFAULT_APP_SUBTITLE).trim() ||
    DEFAULT_APP_SUBTITLE;

  const { iconPreset, iconUrl } = resolveIcon(
    p.get("icon") ?? p.get("logo") ?? p.get("iconUrl"),
  );

  return {
    name,
    subtitle,
    primary,
    header,
    accent,
    primaryLight: shadeHex(primary, 0.35),
    accentLight: shadeHex(accent, 0.35),
    accentDark: shadeHex(accent, -0.15),
    iconPreset,
    iconUrl,
  };
}

/** 將品牌色寫入 :root CSS 變數（對齊 styles.css 的 .btn-*／表頭） */
export function applyBrandingCssVars(branding: BrandingConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--color-primary", branding.primary);
  root.style.setProperty("--color-primary-fg", "#ffffff");
  root.style.setProperty("--color-primary-soft", softTint(branding.primary));
  root.style.setProperty("--color-accent", branding.accent);
  root.style.setProperty("--color-accent-soft", softTint(branding.accent));
  root.style.setProperty("--color-header", branding.header);
  root.style.setProperty("--color-header-fg", "#ffffff");
}

export function applyDocumentBranding(branding: BrandingConfig): void {
  if (typeof document === "undefined") return;
  document.title = branding.name;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) {
    meta.setAttribute(
      "content",
      `${branding.name} — ACH P01／R01 固定長度檔檢核與加工（純 HTML／JS，免安裝）`,
    );
  }
  applyBrandingCssVars(branding);
}
