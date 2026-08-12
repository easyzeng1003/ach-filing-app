#!/usr/bin/env node
/**
 * 客戶版：內嵌資料 + 單一 HTML（免 npm、免伺服器、免 exe）
 *
 * 注意：
 * 1. 不可用 template literal 組裝 JS（${} 會被插值）
 * 2. 不可用 String.replace 字串替換插入 JS（$$ 會被當成 $ 特殊序列）
 * 3. 腳本必須放在 #root 之後（</body> 前），否則 React 掛不上
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "1.2.0";
const dist = path.join(root, "dist-static");
const releaseDir = path.join(root, "release");

function insertBefore(haystack, marker, chunk) {
  const i = haystack.indexOf(marker);
  if (i < 0) return null;
  return haystack.slice(0, i) + chunk + haystack.slice(i);
}

console.log("→ build static (embedded data, IIFE) …");
execSync("npm run build:web", { cwd: root, stdio: "inherit" });

const indexPath = path.join(dist, "index.html");
if (!existsSync(indexPath)) {
  console.error("missing dist-static/index.html");
  process.exit(1);
}

let html = readFileSync(indexPath, "utf8");
const assetsDir = path.join(dist, "assets");
const assetFiles = existsSync(assetsDir) ? readdirSync(assetsDir) : [];

const jsFile = assetFiles.find((f) => f.endsWith(".js"));
const cssFile = assetFiles.find((f) => f.endsWith(".css"));

if (!jsFile) {
  console.error("no JS bundle in dist-static/assets");
  process.exit(1);
}

const css = cssFile
  ? readFileSync(path.join(assetsDir, cssFile), "utf8")
  : "";
let js = readFileSync(path.join(assetsDir, jsFile), "utf8");
js = js.replace(/<\/script/gi, "<\\/script");

// 移除 Vite 外部引用
html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/gi, "");
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>/gi, "");

// CSS 進 head；JS 進 body 末端（root 之後）
const styleTag = "\n<style>\n" + css + "\n</style>\n";
const scriptTag = "\n<script>\n" + js + "\n</script>\n";

let next = insertBefore(html, "</head>", styleTag);
if (next) html = next;

if (!html.includes("ach-customer-build") && html.includes("<head>")) {
  html = insertBefore(
    html,
    "<head>",
    "", // no-op placeholder
  );
  // 安全插入 meta：只替換第一個 <head>
  const hi = html.indexOf("<head>");
  if (hi >= 0) {
    html =
      html.slice(0, hi + 6) +
      '\n    <meta name="ach-customer-build" content="standalone-embedded-iife" />' +
      html.slice(hi + 6);
  }
}

next = insertBefore(html, "</body>", scriptTag);
if (next) html = next;
else html = html + scriptTag;

// 驗證 $$typeof（React）未被破壞
const dd = html.split("$$typeof").length - 1;
if (dd < 1) {
  console.error("FATAL: $$typeof was corrupted during HTML packaging");
  process.exit(1);
}

if (!html.includes('id="root"') && !html.includes("id='root'")) {
  console.error("FATAL: #root missing in HTML");
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });

const singleName = "ACH改檔小工具.html";
const singlePath = path.join(releaseDir, singleName);
writeFileSync(singlePath, html, "utf8");
console.log(
  "✓ single HTML: " +
    singlePath +
    " (" +
    (statSync(singlePath).size / 1024).toFixed(1) +
    " KB)  $$typeof=" +
    dd,
);

const asciiSingle = path.join(
  releaseDir,
  "ACH-Filing-" + version + "-standalone.html",
);
cpSync(singlePath, asciiSingle);

const stageName = "ACH-Filing-" + version + "-customer";
const stage = path.join(releaseDir, stageName);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(singlePath, path.join(stage, singleName));
cpSync(asciiSingle, path.join(stage, path.basename(asciiSingle)));
cpSync(
  path.join(root, "public/data/exclude-rules.example.json"),
  path.join(stage, "exclude-rules.example.json"),
);

writeFileSync(
  path.join(stage, "使用說明.txt"),
  [
    "ACH改檔小工具 v" + version + "（客戶版・免安裝）",
    "====================================",
    "",
    "【怎麼用 — 最簡單】",
    "1. 解壓縮 zip（若需要）",
    "2. 用 Chrome 或 Edge **雙擊**開啟：",
    "",
    "     ACH改檔小工具.html",
    "",
    "3. 填寫資料 → 產生 TXT 上傳檔（或 HTML 報表 / JS 資料）",
    "",
    "【不需要】",
    "× 安裝程式 / exe",
    "× npm、Node、打包",
    "× 連網（銀行代碼、交易代號、格式已全部內嵌）",
    "× 架設網站",
    "",
    "【建議瀏覽器】Chrome、Edge、Firefox 最新版",
    "",
    "【注意】",
    "· 請用瀏覽器開啟 .html（不要用記事本）",
    "· 表單暫存在瀏覽器本機，清除網站資料會清空",
    "· TXT 為財金 ACH 固定長度上傳檔",
    "",
    "【品牌／主題參數（選用）】",
    "以網址參數覆寫名稱、圖示、顏色，例如：",
    "  ACH改檔小工具.html?name=我的ACH工具&primary=1566c0&accent=ff9800&icon=build",
    "  name／primary／header／accent／icon",
    "",
    "【排除後輸出（選用）】",
    "1. 參考同目錄 exclude-rules.example.json 編寫規則",
    "2. 在程式中「載入排除規則」後再「排除後合併輸出」或轉檔",
    "3. 單一規則多欄位＝全部符合才排除；多條規則＝符合任一即排除",
    "",
    "版本：" + version,
    "",
  ].join("\n"),
  "utf8",
);

const multiDir = path.join(stage, "網站部署版_可選");
mkdirSync(multiDir, { recursive: true });
cpSync(dist, multiDir, { recursive: true });
cpSync(singlePath, path.join(multiDir, singleName));
writeFileSync(
  path.join(multiDir, "說明.txt"),
  "此資料夾可上傳到公司網站。一般客戶請直接開上一層「ACH改檔小工具.html」。\n",
  "utf8",
);

const zipPath = path.join(releaseDir, stageName + ".zip");
rmSync(zipPath, { force: true });
execSync('python3 scripts/zip-dir.py "' + stage + '" "' + zipPath + '"', {
  cwd: root,
  stdio: "inherit",
});
rmSync(stage, { recursive: true, force: true });

console.log(
  "✓ customer zip: " +
    zipPath +
    " (" +
    (statSync(zipPath).size / 1024).toFixed(1) +
    " KB)",
);
console.log("✓ standalone:   " + asciiSingle);
