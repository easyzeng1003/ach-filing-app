import { BookOpen, FileText, Braces, MonitorSmartphone } from "lucide-react";
import { useRefStore } from "@/lib/ach/store";

export function HelpPanel() {
  const formats = useRefStore((s) => s.formatList());

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          <h2 className="text-lg font-bold">關於本程式</h2>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          以財金 ACH <strong className="text-fg">P01 代收／代付</strong>
          固定長度檔為主，進行<strong className="text-fg">檢核與加工</strong>；
          <strong className="text-fg">R01 提回／退件</strong>僅由 P01 轉檔產生。
          開啟後請先上傳既有 P01 檔。
          ACHP01 明細<strong className="text-fg">交易類別</strong>依交易代號帶入：
          <strong className="text-fg">SD＝代收</strong>、
          <strong className="text-fg">SC＝代付</strong>。
          於 P01 可<strong className="text-fg">轉檔 R01</strong>
          （TYPE=R、對調提出／提回行與帳號、填入退件理由）。
          大檔請按<strong className="text-fg">編輯</strong>整合分割邏輯：切成多包後在網頁
          <strong className="text-fg">逐包載入修改</strong>，存回後
          <strong className="text-fg">合併全部輸出</strong>；
          亦可直接「大檔轉 R01」。多檔下載會打包 ZIP 或選一次資料夾。
          「清除並回到上傳」會清空紀錄並回到初始上傳頁。
        </p>
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <FileText className="size-5 text-primary" />
          <h3 className="font-bold">建議流程</h3>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>上傳既有 ACHP01／ACHR01 <code className="font-mono text-xs">.txt</code></li>
          <li>預覽表頭、明細、固定長度欄位與原始列長</li>
          <li>套用後檢核錯誤、修正資料（小檔）；或按「編輯」分割後逐包修改／大檔轉 R01</li>
          <li>重新產生 TXT；編輯工作區可合併全部輸出</li>
        </ol>
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <Braces className="size-5 text-primary" />
          <h3 className="font-bold">品牌／主題參數（URL）</h3>
        </div>
        <p className="mb-2 text-sm text-muted">
          開啟 HTML 時可加 Query 或 Hash 參數覆寫名稱、圖示與顏色（免重新編譯）。
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            <code className="font-mono text-xs text-fg">name</code> — 程式名稱（預設 ACH改檔小工具）
          </li>
          <li>
            <code className="font-mono text-xs text-fg">primary</code> — 主題主色／按鈕色（如{" "}
            <code className="font-mono text-xs">1566c0</code>）
          </li>
          <li>
            <code className="font-mono text-xs text-fg">header</code> — 頂欄加深色（可省略）
          </li>
          <li>
            <code className="font-mono text-xs text-fg">accent</code> — 強調色／次要色
          </li>
          <li>
            <code className="font-mono text-xs text-fg">icon</code> — 內建代號（
            <code className="font-mono text-xs">account_balance</code>／
            <code className="font-mono text-xs">build</code>／
            <code className="font-mono text-xs">edit</code>…）或圖片 URL
          </li>
        </ul>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-header p-3 font-mono text-[11px] text-header-fg">
{`ACH改檔小工具.html?name=我的ACH工具&primary=1566c0&accent=ff9800&icon=build`}
        </pre>
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <Braces className="size-5 text-primary" />
          <h3 className="font-bold">JSON 參數位置</h3>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            <code className="font-mono text-xs text-fg">public/data/formats/index.json</code>
            — 檔案代號清單
          </li>
          <li>
            <code className="font-mono text-xs text-fg">public/data/formats/ACHP01.json</code>{" "}
            等 — 各格式完整定義
          </li>
          <li>
            <code className="font-mono text-xs">form.header / form.detail</code>
            ：畫面輸入欄、charset、檢核規則
          </li>
          <li>
            <code className="font-mono text-xs">records.header / detail / trailer</code>
            ：固定長度輸出欄位順序與長度
          </li>
        </ul>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-header p-3 font-mono text-[11px] text-header-fg">
{`// 新增 ACHPxx：
// 1. 複製 ACHP01.json → ACHPxx.json，改 code / 欄位
// 2. 在 index.json formats[] 登錄
// 3. 重新載入即可使用`}
        </pre>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {formats.map((f) => (
          <div key={f.code} className="card p-5">
            <div className="mb-2 flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <h3 className="font-bold">
                <span className="font-mono">{f.code}</span> {f.name}
              </h3>
            </div>
            <p className="text-sm text-muted">{f.description}</p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <FileText className="size-5 text-primary" />
          <h3 className="font-bold">檔案匯入</h3>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            預設畫面會<strong className="text-fg">引導先上傳</strong>既有 P01 固定長度{" "}
            <code className="font-mono text-xs">.txt</code>
          </li>
          <li>
            依 BOF 列 CDATA（檔案代號）自動對應 JSON 格式，並以
            <code className="font-mono text-xs">records</code> 欄位定義切片預覽
          </li>
          <li>
            預覽可切換「表單欄位／固定長度欄位／原始列」；確認後「套用到表單」進入檢核與加工
          </li>
          <li>
            大檔（例如數十萬筆）採<strong className="text-fg">串流讀取</strong>
            ；超過可編輯上限時可於<strong className="text-fg">明細表頭篩選</strong>
            ，再載入並顯示符合的全部結果後套用到表單
          </li>
        </ul>
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <MonitorSmartphone className="size-5 text-primary" />
          <h3 className="font-bold">排除後輸出</h3>
        </div>
        <p className="mb-2 text-sm text-muted">
          於主畫面以<strong className="text-fg">下拉選欄位</strong>、比對方式（
          <strong className="text-fg">等於</strong>／
          <strong className="text-fg">包含</strong>）並輸入排除內容，
          按「排除後輸出 P01」後會顯示原筆數／排除筆數／輸出筆數，並提供檔案下載。
          「輸出 R01（整檔）」則<strong className="text-fg">一律轉出完整明細</strong>
          ，不套用排除條件（即使已設定篩選／排除）。
          「包含」只要欄位值含輸入字串即排除（類似{" "}
          <code className="font-mono text-xs">String.includes</code>
          ，不區分大小寫；JSON 運算子仍為{" "}
          <code className="font-mono text-xs">like</code>）。
          若正在<strong className="text-fg">分割工作區</strong>，排除後輸出 P01 會合併
          <strong className="text-fg">全部分割包</strong>後再排除（非僅目前開啟的那一包）。
          條件關係可選全部符合（AND）或任一符合（OR）；亦可載入 JSON 規則。
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-header p-3 font-mono text-[11px] text-header-fg">
{`{
  "version": 1,
  "kind": "ach-exclude-rules",
  "formatCode": "ACHP01",
  "rules": [
    { "bankCode": "0040000", "amount": "1000" },
    { "account": { "op": "like", "value": "1234567890" } },
    { "userNo": { "like": "U0" } }
  ]
}`}
        </pre>
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <MonitorSmartphone className="size-5 text-primary" />
          <h3 className="font-bold">分行符號（依 OS）</h3>
        </div>
        <p className="mb-2 text-sm text-muted">
          輸出 TXT 時可選擇分行符號；預設依目前作業系統推斷（Windows→CRLF，macOS／Linux→LF），並可手動覆寫。偏好會記在瀏覽器本機。
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            <strong className="text-fg">Windows (CRLF)</strong> —{" "}
            <code className="font-mono text-xs">\\r\\n</code>
          </li>
          <li>
            <strong className="text-fg">macOS／Linux (LF)</strong> —{" "}
            <code className="font-mono text-xs">\\n</code>
          </li>
          <li>
            <strong className="text-fg">舊版 Mac (CR)</strong> —{" "}
            <code className="font-mono text-xs">\\r</code>
          </li>
        </ul>
      </div>

      <div className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <MonitorSmartphone className="size-5 text-primary" />
          <h3 className="font-bold">charset 與 pad</h3>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            <strong className="text-fg">digit</strong>：僅 0-9（對應原 VBA SafeCHR mode 1）
          </li>
          <li>
            <strong className="text-fg">alnum</strong>：0-9A-Za-z（SafeCHR mode 2）
          </li>
          <li>
            <strong className="text-fg">pad.left / right</strong>：輸出固定長度補齊；
            <code className="font-mono text-xs">none</code> 則僅過濾字元
          </li>
          <li>
            檢核規則：required、exactLength、oneOfLengths、rocDate、txid、branchCode、number…
          </li>
        </ul>
      </div>
    </div>
  );
}
