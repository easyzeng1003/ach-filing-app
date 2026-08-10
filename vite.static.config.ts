import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 純 HTML + JS 客戶版（資料內嵌，可打包成單一 HTML）
 * IIFE 輸出：方便內嵌後以 file:// 雙擊開啟（無需 type=module）
 */
export default defineConfig({
  root: path.resolve(__dirname, "web"),
  base: "./",
  publicDir: path.resolve(__dirname, "public"),
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // 客戶靜態版：格式參數等 UI 走精簡檢視
  define: {
    "import.meta.env.VITE_ACH_CUSTOMER": JSON.stringify("true"),
  },
  build: {
    outDir: path.resolve(__dirname, "dist-static"),
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: "assets",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        format: "iife",
        name: "AchFilingApp",
        inlineDynamicImports: true,
        entryFileNames: "assets/app.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
});
