# 離線開發用 node_modules（分卷）

- 版本：對應 `package-lock.json` v1.4.88（以 `npm ci` 完整安裝）
- 平台：**Linux x64 / Node v22.14.0（npm 10）**
- 分卷：`node_modules-1.4.88-linux-x64.tar.gz.001`（45 MB）、`.002`（43 MB）
- 合併後檔案 SHA256：`d820fb99131f8f762ac6cfea2345c81ffe3fbe0f475ee4e2b51ef668c244bba1`

## 直接用瀏覽器下載（GitHub 網頁）

到本分支資料夾，點各檔案的 **Download raw file**，或直接開這兩個 raw 連結（會直接下載）：

- `https://github.com/easyzeng1003/ach-filing-app/raw/cursor/offline-node-modules-875a/offline-bundle/node_modules-1.4.88-linux-x64.tar.gz.001`
- `https://github.com/easyzeng1003/ach-filing-app/raw/cursor/offline-node-modules-875a/offline-bundle/node_modules-1.4.88-linux-x64.tar.gz.002`

## 合併＋解開

### Linux / macOS / Git Bash
```bash
cat node_modules-1.4.88-linux-x64.tar.gz.001 node_modules-1.4.88-linux-x64.tar.gz.002 > node_modules-1.4.88-linux-x64.tar.gz
sha256sum -c SHA256SUMS.full.txt   # 驗證（可選）
tar -xzf node_modules-1.4.88-linux-x64.tar.gz   # 於專案根目錄執行 → 產生 ./node_modules
```

### Windows（PowerShell）
```powershell
cmd /c copy /b node_modules-1.4.88-linux-x64.tar.gz.001+node_modules-1.4.88-linux-x64.tar.gz.002 node_modules-1.4.88-linux-x64.tar.gz
tar -xzf node_modules-1.4.88-linux-x64.tar.gz
```

完成後即可離線：`npm run dev:web` 或 `npm run build:customer`（免再安裝）。

## 注意
- 此包為 **Linux x64** 原生模組（`@tailwindcss/oxide`、`lightningcss`、`@rolldown/binding`）；Windows／macOS 不相容，需該平台版本時另行提供。
- 本分支僅供下載，**不供合併**；取得後可刪除此分支。
