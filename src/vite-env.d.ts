/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 客戶靜態版（vite.static.config / build:customer） */
  readonly VITE_ACH_CUSTOMER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
