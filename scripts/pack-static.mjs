#!/usr/bin/env node
/**
 * 打包 HTML + JS 靜態成品為 portable zip（主要發行方式，取代 exe）
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version || "1.0.0";
const dist = path.join(root, "dist-static");
const releaseDir = path.join(root, "release");
const stageName = `ACH-Filing-${version}-html-js`;
const stage = path.join(releaseDir, stageName);
const zipPath = path.join(releaseDir, `${stageName}.zip`);

console.log("→ build static HTML/JS …");
execSync("npm run build:web", { cwd: root, stdio: "inherit" });

if (!existsSync(path.join(dist, "index.html"))) {
  console.error("build failed: missing dist-static/index.html");
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });
rmSync(stage, { recursive: true, force: true });
cpSync(dist, stage, { recursive: true });

writeFileSync(
  path.join(stage, "README.txt"),
  `代收建檔小程式 v${version}
========================

純 HTML + JavaScript 靜態版（無需安裝、無 exe）

使用方式
--------
1) 建議：用本機靜態伺服器開啟（避免瀏覽器限制 file:// 讀 JSON）

   # Python
   python -m http.server 8080

   # 或 Node
   npx --yes serve -l 8080 .

   然後瀏覽器開啟 http://127.0.0.1:8080/

2) 也可將整個資料夾放到任意靜態網站主機（IIS / nginx / GitHub Pages / 內網）

內容
----
- index.html     主畫面
- assets/        JS、CSS
- data/          交易代號、銀行代碼、格式 JSON（ACHP01/R01）

功能
----
- P01 代收／代付 / R01 提回／退件（JSON 參數化可擴充）
- 明細篩選
- 成品輸出：TXT（固定長度）

版本：${version}
`,
  "utf8",
);

rmSync(zipPath, { force: true });
execSync(`python3 scripts/zip-dir.py "${stage}" "${zipPath}"`, {
  cwd: root,
  stdio: "inherit",
});
rmSync(stage, { recursive: true, force: true });

const size = statSync(zipPath).size;
console.log(`✓ portable: ${zipPath} (${(size / 1024).toFixed(1)} KB)`);
