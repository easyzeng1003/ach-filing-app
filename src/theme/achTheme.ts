import { createTheme } from "@mui/material/styles";
import {
  DEFAULT_BRANDING_COLORS,
  type BrandingConfig,
} from "@/lib/branding";

/**
 * Material Design theme（對齊 Angular Material 視覺語言）。
 * 字型用 Noto Sans TC（繁中）；主色可由品牌參數覆寫。
 */
export function createAchTheme(
  colors: Pick<
    BrandingConfig,
    | "primary"
    | "header"
    | "accent"
    | "primaryLight"
    | "accentLight"
    | "accentDark"
  > = DEFAULT_BRANDING_COLORS,
) {
  return createTheme({
    cssVariables: true,
    palette: {
      mode: "light",
      primary: {
        main: colors.primary,
        dark: colors.header,
        light: colors.primaryLight,
        contrastText: "#ffffff",
      },
      secondary: {
        main: colors.accent,
        dark: colors.accentDark,
        light: colors.accentLight,
        contrastText: "#ffffff",
      },
      error: { main: "#c62828" },
      warning: { main: "#f9a825" },
      success: { main: "#2e7d32" },
      info: { main: "#0277bd" },
      background: {
        default: "#f5f5f5",
        paper: "#ffffff",
      },
      divider: "rgba(0, 0, 0, 0.12)",
      text: {
        primary: "rgba(0, 0, 0, 0.87)",
        secondary: "rgba(0, 0, 0, 0.60)",
        disabled: "rgba(0, 0, 0, 0.38)",
      },
    },
    typography: {
      fontFamily:
        '"Noto Sans TC", "Helvetica Neue", "PingFang TC", "Microsoft JhengHei", sans-serif',
      h1: { fontWeight: 700 },
      h2: { fontWeight: 700 },
      h3: { fontWeight: 700 },
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 700 },
      button: {
        textTransform: "none",
        fontWeight: 600,
        letterSpacing: "0.02em",
      },
      overline: {
        letterSpacing: "0.08em",
        fontWeight: 600,
      },
    },
    shape: {
      borderRadius: 4,
    },
    shadows: [
      "none",
      "0px 2px 1px -1px rgba(0,0,0,0.2),0px 1px 1px 0px rgba(0,0,0,0.14),0px 1px 3px 0px rgba(0,0,0,0.12)",
      "0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12)",
      "0px 3px 3px -2px rgba(0,0,0,0.2),0px 3px 4px 0px rgba(0,0,0,0.14),0px 1px 8px 0px rgba(0,0,0,0.12)",
      "0px 2px 4px -1px rgba(0,0,0,0.2),0px 4px 5px 0px rgba(0,0,0,0.14),0px 1px 10px 0px rgba(0,0,0,0.12)",
      "0px 3px 5px -1px rgba(0,0,0,0.2),0px 5px 8px 0px rgba(0,0,0,0.14),0px 1px 14px 0px rgba(0,0,0,0.12)",
      "0px 3px 5px -1px rgba(0,0,0,0.2),0px 6px 10px 0px rgba(0,0,0,0.14),0px 1px 18px 0px rgba(0,0,0,0.12)",
      "0px 4px 5px -2px rgba(0,0,0,0.2),0px 7px 10px 1px rgba(0,0,0,0.14),0px 2px 16px 1px rgba(0,0,0,0.12)",
      "0px 5px 5px -3px rgba(0,0,0,0.2),0px 8px 10px 1px rgba(0,0,0,0.14),0px 3px 14px 2px rgba(0,0,0,0.12)",
      "0px 5px 6px -3px rgba(0,0,0,0.2),0px 9px 12px 1px rgba(0,0,0,0.14),0px 3px 16px 2px rgba(0,0,0,0.12)",
      "0px 6px 6px -3px rgba(0,0,0,0.2),0px 10px 14px 1px rgba(0,0,0,0.14),0px 4px 18px 3px rgba(0,0,0,0.12)",
      "0px 6px 7px -4px rgba(0,0,0,0.2),0px 11px 15px 1px rgba(0,0,0,0.14),0px 4px 20px 3px rgba(0,0,0,0.12)",
      "0px 7px 8px -4px rgba(0,0,0,0.2),0px 12px 17px 2px rgba(0,0,0,0.14),0px 5px 22px 4px rgba(0,0,0,0.12)",
      "0px 7px 8px -4px rgba(0,0,0,0.2),0px 13px 19px 2px rgba(0,0,0,0.14),0px 5px 24px 4px rgba(0,0,0,0.12)",
      "0px 7px 9px -4px rgba(0,0,0,0.2),0px 14px 21px 2px rgba(0,0,0,0.14),0px 5px 26px 4px rgba(0,0,0,0.12)",
      "0px 8px 9px -5px rgba(0,0,0,0.2),0px 15px 22px 2px rgba(0,0,0,0.14),0px 6px 28px 5px rgba(0,0,0,0.12)",
      "0px 8px 10px -5px rgba(0,0,0,0.2),0px 16px 24px 2px rgba(0,0,0,0.14),0px 6px 30px 5px rgba(0,0,0,0.12)",
      "0px 8px 11px -5px rgba(0,0,0,0.2),0px 17px 26px 2px rgba(0,0,0,0.14),0px 6px 32px 5px rgba(0,0,0,0.12)",
      "0px 9px 11px -5px rgba(0,0,0,0.2),0px 18px 28px 2px rgba(0,0,0,0.14),0px 7px 34px 6px rgba(0,0,0,0.12)",
      "0px 9px 12px -6px rgba(0,0,0,0.2),0px 19px 29px 2px rgba(0,0,0,0.14),0px 7px 36px 6px rgba(0,0,0,0.12)",
      "0px 10px 13px -6px rgba(0,0,0,0.2),0px 20px 31px 3px rgba(0,0,0,0.14),0px 8px 38px 7px rgba(0,0,0,0.12)",
      "0px 10px 13px -6px rgba(0,0,0,0.2),0px 21px 33px 3px rgba(0,0,0,0.14),0px 8px 40px 7px rgba(0,0,0,0.12)",
      "0px 10px 14px -6px rgba(0,0,0,0.2),0px 22px 35px 3px rgba(0,0,0,0.14),0px 8px 42px 7px rgba(0,0,0,0.12)",
      "0px 11px 14px -7px rgba(0,0,0,0.2),0px 23px 36px 3px rgba(0,0,0,0.14),0px 9px 44px 8px rgba(0,0,0,0.12)",
      "0px 11px 15px -7px rgba(0,0,0,0.2),0px 24px 38px 3px rgba(0,0,0,0.14),0px 9px 46px 8px rgba(0,0,0,0.12)",
    ],
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: "#f5f5f5",
          },
          code: {
            fontFamily:
              '"JetBrains Mono", "Cascadia Code", "Noto Sans Mono", ui-monospace, monospace',
          },
        },
      },
      MuiButton: {
        defaultProps: {
          size: "medium",
        },
        styleOverrides: {
          root: {
            borderRadius: 4,
          },
          contained: {
            boxShadow:
              "0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12)",
          },
        },
      },
      MuiPaper: {
        defaultProps: {
          elevation: 1,
        },
      },
      MuiCard: {
        defaultProps: {
          elevation: 1,
        },
      },
      MuiTextField: {
        defaultProps: {
          variant: "outlined",
          size: "small",
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 16,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 48,
            textTransform: "none",
            fontWeight: 600,
          },
        },
      },
      MuiAppBar: {
        defaultProps: {
          elevation: 4,
          color: "primary",
        },
      },
      MuiDialog: {
        defaultProps: {
          fullWidth: true,
          maxWidth: "lg",
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 600,
          },
        },
      },
    },
  });
}

/** 預設主題（無 URL 參數時） */
export const achTheme = createAchTheme();
