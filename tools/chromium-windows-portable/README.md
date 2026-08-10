# Chromium Windows Portable

依 [Chromium Windows build instructions](https://chromium.googlesource.com/chromium/src/+/main/docs/windows_build_instructions.md) 整理的 **免安裝、可攜式 Chromium（Win x64）** 流程。

兩種取得方式：

| 方式 | 適用 | 時間／資源 |
|------|------|------------|
| **A. 快照打包**（推薦日常使用） | 直接下載 `chromium-browser-snapshots` Win_x64 並加上 portable launcher | 數分鐘、約 200MB zip |
| **B. 原始碼編譯** | 依官方文件用 Visual Studio + depot_tools 建置後打包 | Windows 機、≥100GB 磁碟、數小時起 |

本環境已產出快照版產物（見下方「產物」）。完整從原始碼編譯 **必須在 Windows** 上執行（需 VS 2026 + Windows 11 SDK）。

---

## 產物（快照版）

解壓後雙擊 `ChromiumPortable.bat`：

- Profile：`.\UserData`（跟著資料夾走，不寫入 `%LOCALAPPDATA%`）
- 旗標：`--no-first-run`、`--no-default-browser-check`、獨立 cache

重新從官方快照打包：

```bash
node tools/chromium-windows-portable/scripts/package-from-snapshot.mjs
# → release/ChromiumPortable-Win_x64-r<REV>.zip
```

---

## A. 從快照建立 Portable（Linux / macOS / Windows）

```bash
node tools/chromium-windows-portable/scripts/package-from-snapshot.mjs
# 指定 revision：
node tools/chromium-windows-portable/scripts/package-from-snapshot.mjs --revision=1674718
```

腳本會：

1. 讀取 `Win_x64/LAST_CHANGE`（或你指定的 revision）
2. 下載 `chrome-win.zip`
3. 去掉測試／安裝相關大型檔（如 `interactive_ui_tests.exe`、`setup.exe`）
4. 寫入 `ChromiumPortable.bat` / `.ps1` 與 `README.txt`
5. 輸出 `release/ChromiumPortable-Win_x64-r<REV>.zip`

---

## B. 原始碼編譯後打包（Windows）

以下對齊官方文件；細節以官方頁為準。

### 系統需求（摘要）

- x86-64、建議 ≥16GB RAM
- NTFS、至少 **100GB** 可用空間
- **Windows 10+**；**Visual Studio 2026**（≥18.0）含 *Desktop development with C++* 與 *MFC/ATL*
- Windows 11 SDK（文件指定版本，見官方頁）
- Git for Windows、`depot_tools`

### 1. 安裝 depot_tools 與環境變數

```powershell
# 範例：C:\src\depot_tools
cd C:\src
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
```

- 將 `C:\src\depot_tools` 加到 **PATH 最前面**
- 設定 `DEPOT_TOOLS_WIN_TOOLCHAIN=0`（使用本機 Visual Studio）
- 必要時設定 `vs2026_install` 指向 VS 安裝路徑
- 用 **cmd.exe** 跑一次 `gclient`（勿用 cygwin／PowerShell 做首次 bootstrap）

詳見：`scripts/01-setup-env.ps1`（檢查用）。

### 2. Fetch 原始碼

```powershell
git config --global core.autocrlf false
git config --global core.filemode false
git config --global core.longpaths true

mkdir C:\src\chromium
cd C:\src\chromium
# 可加 --no-history 加速；完整歷史請省略該旗標
fetch --no-history chromium
cd src
```

### 3. GN 產生 Portable Release 目錄

本目錄提供建議 args：`args.gn`（`is_debug=false`、`is_component_build=false`、`is_official_build=true`、低 symbol）。

```powershell
# 在 chromium\src 下
gn gen out\Portable --args="is_debug=false is_component_build=false is_official_build=true symbol_level=0 blink_symbol_level=0 v8_symbol_level=0 enable_nacl=false"
```

或：

```powershell
.\scripts\03-gn-gen-portable.ps1 -SrcDir C:\src\chromium\src
```

### 4. 編譯 `chrome`

```powershell
autoninja -C out\Portable chrome
# 可選安裝包：autoninja -C out\Portable mini_installer
```

### 5. 打包成 Portable 資料夾／zip

```powershell
.\scripts\05-package-portable.ps1 `
  -BuildDir C:\src\chromium\src\out\Portable `
  -OutDir D:\ChromiumPortable
```

會複製執行所需檔案、寫入 launcher，並可選擇輸出 zip。

---

## Launcher 行為

`ChromiumPortable.bat` / `ChromiumPortable.ps1`：

```text
chrome.exe
  --user-data-dir=<portable>\UserData
  --disk-cache-dir=<portable>\UserData\Cache
  --no-first-run
  --no-default-browser-check
  --disable-features=TranslateUI
  --disable-breakpad
```

可把 USB／資料夾整份複製到另一台 Windows 使用（仍須同架構 x64）。

---

## 與本專案（ACH改檔小工具）的關係

客戶版主路徑仍是 **單一 HTML**（`npm run build:customer`），用系統 Chrome／Edge 即可。  
此工具提供可選的 **免安裝 Chromium**，方便內網／無管理權限環境開啟本機 HTML。

---

## 腳本一覽

| 檔案 | 說明 |
|------|------|
| `scripts/package-from-snapshot.mjs` | 下載 Win_x64 快照 → portable zip（跨平台） |
| `scripts/01-setup-env.ps1` | 檢查 Windows 建置環境 |
| `scripts/02-fetch-chromium.ps1` | fetch chromium |
| `scripts/03-gn-gen-portable.ps1` | `gn gen out\Portable` |
| `scripts/04-build-chrome.ps1` | `autoninja -C out\Portable chrome` |
| `scripts/05-package-portable.ps1` | 從 `out\Portable` 打包 portable |
| `launcher/ChromiumPortable.bat` | 可攜啟動器（cmd） |
| `launcher/ChromiumPortable.ps1` | 可攜啟動器（PowerShell） |
| `args.gn` | 建議 GN args |

## 參考

- [Checking out and Building Chromium for Windows](https://chromium.googlesource.com/chromium/src/+/main/docs/windows_build_instructions.md)
- [Chromium browser snapshots (Win_x64)](https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Win_x64/)
