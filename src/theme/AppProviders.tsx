import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import {
  applyDocumentBranding,
  resolveBranding,
  type BrandingConfig,
} from "@/lib/branding";
import { createAchTheme } from "./achTheme";

const BrandingContext = createContext<BrandingConfig>(resolveBranding());

export function useBranding(): BrandingConfig {
  return useContext(BrandingContext);
}

export function AppProviders({ children }: { children: ReactNode }) {
  const branding = useMemo(() => {
    const b = resolveBranding();
    applyDocumentBranding(b);
    return b;
  }, []);

  const theme = useMemo(() => createAchTheme(branding), [branding]);

  return (
    <BrandingContext.Provider value={branding}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </BrandingContext.Provider>
  );
}
