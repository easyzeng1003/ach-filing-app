# 代收建檔小程式（ACH Filing）

財金 ACH **P01 代收／代付** / **R01 提回／退件** 固定長度文字檔產生工具。  
由 Excel 巨集改寫：**檔案代號與欄位格式 JSON 參數化**。

## 給一般客戶（免安裝・免打包）

下載 **客戶版**，用瀏覽器**雙擊 HTML** 即可使用。

| 檔案 | 說明 |
|------|------|
| [**代收建檔小程式.html**](https://github.com/EzZeng/ach-filing-app/releases/latest) / `ACH-Filing-*-standalone.html` | **單一檔案**，雙擊即用（資料已內嵌） |
| `ACH-Filing-*-customer.zip` | 同上 + 使用說明 + 可選網站部署版 |

### 使用方式

1. 解壓 zip（若下載的是 zip）
2. 用 **Chrome / Edge** 雙擊 `代收建檔小程式.html`
3. 填寫 → 產生 **TXT** 上傳檔

**不需要：** 安裝程式、exe、npm、連網、架站。

---

## 功能

- ACHP01 / ACHR01（JSON 可擴充檔案代號）
- 明細篩選（各欄位）
- 成品輸出：TXT（固定長度）
- 中信 `822*` 首錄代表行固定 `8220901`

## 開發者：本機建置客戶版

```bash
npm install
npm run build:customer
# → release/代收建檔小程式.html
# → release/ACH-Filing-*-standalone.html
# → release/ACH-Filing-*-customer.zip
```

開發預覽：

```bash
npm run dev:web
```

## 格式參數

原始 JSON 在 `public/data/formats/`；客戶版打包時會**內嵌**進 HTML/JS。  
新增檔案代號時，請同時更新 `src/data/embedded.ts` 的 import。

## 授權

MIT
