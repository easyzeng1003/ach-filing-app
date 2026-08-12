import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useRefStore } from "@/lib/ach/store";
import { formatTxTypeLabel } from "@/lib/ach/engine";
import { toast } from "sonner";

export function RefsPanel() {
  const { txids, branches, loading, refreshRefs, formatList } = useRefStore();
  const [tab, setTab] = useState<"txid" | "branch" | "formats">("txid");
  const [q, setQ] = useState("");
  const formats = formatList();

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (tab === "formats") {
      if (!query) return formats;
      return formats.filter(
        (f) =>
          f.code.toLowerCase().includes(query) ||
          f.name.toLowerCase().includes(query) ||
          (f.shortCode || "").toLowerCase().includes(query),
      );
    }
    if (tab === "txid") {
      if (!query) return txids;
      return txids.filter((t) => {
        const typeLabel = formatTxTypeLabel(t.type).toLowerCase();
        return (
          t.code.includes(query) ||
          t.name.toLowerCase().includes(query) ||
          t.type.toLowerCase().includes(query) ||
          typeLabel.includes(query) ||
          (query.includes("代收") && t.type === "SD") ||
          (query.includes("代付") && t.type === "SC")
        );
      });
    }
    if (!query) return branches.slice(0, 200);
    return branches
      .filter((b) => b.code.includes(query) || b.name.toLowerCase().includes(query))
      .slice(0, 300);
  }, [tab, q, txids, branches, formats]);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-lg font-bold">代碼與檔案代號</h2>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading}
          onClick={async () => {
            await refreshRefs();
            toast.success("已重新載入");
          }}
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          重新載入
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {(
          [
            ["txid", "交易代號"],
            ["branch", "銀行代碼"],
            ["formats", "檔案代號"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            className="field-input pl-9"
            placeholder="搜尋…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className="scroll-panel max-h-[65vh] border-0 rounded-none">
        <table className="data-table">
          <thead>
            <tr>
              {tab === "formats" ? (
                <>
                  <th>檔案代號</th>
                  <th>簡稱</th>
                  <th>名稱</th>
                  <th>說明</th>
                </>
              ) : tab === "txid" ? (
                <>
                  <th>代號</th>
                  <th>類別</th>
                  <th>名稱</th>
                </>
              ) : (
                <>
                  <th>代號</th>
                  <th>名稱</th>
                  <th>總行代號</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {tab === "formats"
              ? (list as typeof formats).map((f) => (
                  <tr key={f.code}>
                    <td className="font-mono font-semibold">{f.code}</td>
                    <td>{f.shortCode}</td>
                    <td>{f.name}</td>
                    <td className="text-muted">{f.description}</td>
                  </tr>
                ))
              : tab === "txid"
                ? (list as typeof txids).map((t) => (
                    <tr key={t.code}>
                      <td className="font-mono font-semibold">{t.code}</td>
                      <td>{formatTxTypeLabel(t.type)}</td>
                      <td>{t.name}</td>
                    </tr>
                  ))
                : (list as typeof branches).map((b) => (
                    <tr key={b.code}>
                      <td className="font-mono font-semibold">{b.code}</td>
                      <td>{b.name}</td>
                      <td className="font-mono text-muted">{b.head}</td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
