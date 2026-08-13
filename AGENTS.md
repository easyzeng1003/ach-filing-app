# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
`ach-filing-app` (ACH改檔小工具) is a **client-only** React 19 + Vite 8 + TypeScript app that generates Taiwan 財金 ACH fixed-length upload files (ACHP01 代收 SD／代付 SC / ACHR01 提回／退件). There is **no backend, database, or auth**. The `better-auth`, `kysely`, `pg`, and `@electric-sql/pglite` dependencies are unused template leftovers (their source lives under gitignored paths) — do not try to run a DB/auth server. All reference data (bank branches, txids, format schemas) is embedded/served from `public/data/` and `src/data/embedded.ts`.

### Running it (dev)
- Primary dev server: `npm run dev:web` → http://localhost:8080 (config `vite.static.config.ts`, `strictPort: true`, so 8080 must be free). This is the path the README and `startup.sh` use.
- Do **not** use `npm run dev` for normal work — that starts the alternate TanStack Start SSR scaffold (`vite.config.ts`), which is not the maintained dev path.
- `startup.sh` auto-starts `npm run dev:web` if nothing is already listening on 8080.
- Electron (`npm run electron:dev`) and the customer standalone HTML build (`npm run build:customer` → `release/ACH改檔小工具.html`) are packaging modes.

### Delivery after each change
- When a feature/fix change set is complete (before summarizing to the user), **always** run `npm run build:customer` and publish the install-free HTML/JS artifacts.
- Copy outputs to `/opt/cursor/artifacts/customer-release/` (and reference them in the PR body):
  - `release/ACH改檔小工具.html` — single-file, double-click to open
  - `release/ACH-Filing-*-standalone.html` — versioned alias of the same file
  - `release/ACH-Filing-*-customer.zip` — zip package
- `release/` is gitignored; do not commit build outputs into the repo.

### Checks (see `package.json` scripts)
- `npm run lint` (eslint), `npm run typecheck` (tsc), `npm run test:ach` (JSON schema smoke test).
- Note: `npm run lint` currently reports pre-existing errors (mostly `require()` imports in `electron/*.cjs` plus a `prefer-const`). These exist on `main` and are unrelated to environment setup — don't treat them as newly introduced.

### Non-obvious gotchas when testing file generation
- The detail-row **收受者帳號 (account)** must be exactly **16 digits**. The export `RCLNO` field has `pad: none`, so a shorter account produces a record shorter than `recordLength` (e.g. 244 vs 250) and generation fails with a red toast "…列長度 244 與定義 250 不符…". The account input pads left with `0` on blur, so enter a 16-digit value (e.g. `0000001234567890`).
- **用戶號碼 (userNo)** is required on detail rows when the header txid is **代收 SD**; for **代付 SC** it may be blank (exported as spaces, matching 代付建檔小程式).
- The header **日期 (rocDate)** must not be in the past (ROC format, e.g. `01150804` = 2026-08-04).
- Bank codes (header `bankCode` and detail `bankCode`) must match a code in `public/data/branch.json` (e.g. `0040000` = 台灣銀行).
- ACHP01 **TXTYPE** is derived from `txid.json`: **SD＝代收**, **SC＝代付**. Header/trailer layout matches 財金「代收建檔小程式.xlsm」.
- Large ACH uploads use **streaming parse** (`parseAchFile`); do not call `file.text()` on big files. Editable form apply is capped at **5,000** detail rows (`IMPORT_LIMITS.maxFormDetailRows`). Larger files: use import-preview **預先篩選** (`filters` / `filterGlobal` on `parseAchFile`) to stream-load only matching rows, then display all matches and apply.
- Form state is **not** persisted across page loads (localStorage keys `ach-filing-forms-v1`／`v2` are cleared on open). Each visit starts at the upload screen with an empty workspace. A successful export shows a green toast "已產生 …txt（N 筆）" and downloads the file.
