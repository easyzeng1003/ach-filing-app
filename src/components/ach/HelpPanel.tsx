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
          以既有財金 ACH <strong className="text-fg">P01 代收／代付</strong>／
          <strong className="text-fg">R01 提回／退件</strong>固定長度檔為主，進行
          <strong className="text-fg">檢核與加工</strong>。
          開啟後請先上傳檔案；表單新建為進階選項。
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
            預設畫面會<strong className="text-fg">引導先上傳</strong>既有 ACH 固定長度{" "}
            <code className="font-mono text-xs">.txt</code>；新建空白表單收在「進階」
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
