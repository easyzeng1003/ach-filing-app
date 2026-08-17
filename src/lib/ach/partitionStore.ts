/**
 * 分割工作區（僅記憶體，不寫入 localStorage）
 * 大檔分割後逐包載入表單編輯 → 存回 → 合併輸出
 */
import { create } from "zustand";
import { generateFromSchema, isRowEmpty } from "./engine";
import { adaptP01ImportToR01, parseAchText } from "./import";
import { withLineEndingId } from "./lineEnding";
import { usePrefsStore } from "./prefsStore";
import {
  mergeAchPartitions,
  partitionAchFile,
  patchPartitionControlRecords,
  planPartitionsForEdit,
  rebuildPartitionPreservingDetails,
  type PartitionIndex,
  type PartitionEntry,
  type PartitionProgress,
} from "./partition";
import type {
  Branch,
  DetailRow,
  FormatSchema,
  HeaderValues,
  Txid,
} from "./schema";

function schemaForOutput(schema: FormatSchema): FormatSchema {
  return withLineEndingId(schema, usePrefsStore.getState().lineEnding);
}

export type PartitionPartState = {
  filename: string;
  content: string;
  detailCount: number;
  amount: number;
  seqFrom: number;
  seqTo: number;
  dirty: boolean;
};

export type PartitionSession = {
  formatCode: string;
  sourceFilename: string;
  index: PartitionIndex;
  parts: PartitionPartState[];
  /** 目前載入表單的包（0-based）；null＝尚未載入 */
  activeIndex: number | null;
};

type PartitionStore = {
  session: PartitionSession | null;
  startSession: (opts: {
    formatCode: string;
    sourceFilename: string;
    index: PartitionIndex;
    parts: { filename: string; content: string }[];
  }) => void;
  clearSession: () => void;
  setActiveIndex: (index: number | null) => void;
  /** 用目前表單內容覆寫作用中分割包，並同步控制首錄到全部分割包 */
  saveFormToActivePart: (
    schema: FormatSchema,
    header: HeaderValues,
    rows: DetailRow[],
    txids: Txid[],
    branches: Branch[],
  ) => { detailCount: number; amount: number };
  updatePartContent: (index: number, content: string, meta: {
    detailCount: number;
    amount: number;
  }) => void;
  markActiveDirty: () => void;
  getActivePart: () => PartitionPartState | null;
};

function syncIndex(session: PartitionSession): PartitionIndex {
  let totalDetailCount = 0;
  let totalAmount = 0;
  let seq = 1;
  const partitions: PartitionEntry[] = session.parts.map((p, i) => {
    const seqFrom = seq;
    const seqTo = seq + Math.max(0, p.detailCount) - 1;
    seq = seqTo + 1;
    totalDetailCount += p.detailCount;
    totalAmount += p.amount;
    return {
      index: i,
      filename: p.filename,
      detailCount: p.detailCount,
      amount: p.amount,
      seqFrom: p.detailCount > 0 ? seqFrom : seqFrom,
      seqTo: p.detailCount > 0 ? seqTo : seqFrom - 1,
      detailOffset: seqFrom - 1,
    };
  });
  return {
    ...session.index,
    totalDetailCount,
    totalAmount,
    partCount: partitions.length,
    partitions,
  };
}

export const usePartitionStore = create<PartitionStore>((set, get) => ({
  session: null,

  startSession: ({ formatCode, sourceFilename, index, parts }) => {
    const byName = new Map(parts.map((p) => [p.filename, p.content]));
    const partStates: PartitionPartState[] = index.partitions.map((entry) => {
      const content = byName.get(entry.filename) ?? "";
      return {
        filename: entry.filename,
        content,
        detailCount: entry.detailCount,
        amount: entry.amount,
        seqFrom: entry.seqFrom,
        seqTo: entry.seqTo,
        dirty: false,
      };
    });
    set({
      session: {
        formatCode,
        sourceFilename,
        index,
        parts: partStates,
        activeIndex: null,
      },
    });
  },

  clearSession: () => set({ session: null }),

  setActiveIndex: (index) => {
    const session = get().session;
    if (!session) return;
    set({ session: { ...session, activeIndex: index } });
  },

  getActivePart: () => {
    const session = get().session;
    if (!session || session.activeIndex == null) return null;
    return session.parts[session.activeIndex] ?? null;
  },

  markActiveDirty: () => {
    const session = get().session;
    if (!session || session.activeIndex == null) return;
    const parts = session.parts.map((p, i) =>
      i === session.activeIndex ? { ...p, dirty: true } : p,
    );
    set({ session: { ...session, parts } });
  },

  updatePartContent: (index, content, meta) => {
    const session = get().session;
    if (!session || index < 0 || index >= session.parts.length) return;
    const parts = session.parts.map((p, i) =>
      i === index
        ? {
            ...p,
            content,
            detailCount: meta.detailCount,
            amount: meta.amount,
            dirty: false,
          }
        : p,
    );
    const next = { ...session, parts };
    next.index = syncIndex(next);
    // 更新 seq 顯示
    next.parts = next.parts.map((p, i) => {
      const e = next.index.partitions[i]!;
      return {
        ...p,
        seqFrom: e.seqFrom,
        seqTo: e.seqTo,
      };
    });
    set({ session: next });
  },

  saveFormToActivePart: (schema, header, rows, txids, branches) => {
    const session = get().session;
    if (!session || session.activeIndex == null) {
      throw new Error("沒有作用中的分割包");
    }
    if (schema.code !== session.formatCode) {
      throw new Error(
        `格式不符：工作區 ${session.formatCode}，目前 ${schema.code}`,
      );
    }
    const active = session.parts[session.activeIndex];
    if (!active) throw new Error("找不到作用中的分割包");
    const outSchema = schemaForOutput(schema);
    // 在原始明細列上 patch，保留 NOTE／MEMO 等非表單欄位
    const rebuilt = rebuildPartitionPreservingDetails(
      outSchema,
      active.content,
      header,
      rows,
      txids,
      branches,
    );

    // 控制首錄為工作區共用：同步寫入索引，並改寫其餘包的 BOF／EOF
    const parts = session.parts.map((p, i) => {
      if (i === session.activeIndex) {
        return {
          ...p,
          content: rebuilt.content,
          detailCount: rebuilt.detailCount,
          amount: rebuilt.amount,
          dirty: false,
        };
      }
      const patched = patchPartitionControlRecords(
        outSchema,
        p.content,
        header,
        txids,
        branches,
      );
      return {
        ...p,
        content: patched.content,
        detailCount: patched.detailCount,
        amount: patched.amount,
        dirty: false,
      };
    });

    const next: PartitionSession = {
      ...session,
      parts,
      index: {
        ...session.index,
        header: { ...header },
        headerLine: rebuilt.headerLine,
      },
    };
    next.index = syncIndex(next);
    next.parts = next.parts.map((p, i) => {
      const e = next.index.partitions[i]!;
      return {
        ...p,
        seqFrom: e.seqFrom,
        seqTo: e.seqTo,
      };
    });
    set({ session: next });

    return {
      detailCount: rebuilt.detailCount,
      amount: rebuilt.amount,
    };
  },
}));

/** 分割後的 P01 包改寫成 R01，供唯一編輯工作區載入 */
export function rewriteSessionPartsFromP01ToR01(
  p01: FormatSchema,
  r01: FormatSchema,
  txids: Txid[],
  branches: Branch[],
): void {
  const sess = usePartitionStore.getState().session;
  if (!sess || sess.formatCode === "ACHR01") return;
  const parts = sess.parts.map((p) => {
    const parsed = parseAchText(p.content, p01, { filename: p.filename });
    const adapted = adaptP01ImportToR01(parsed, r01);
    const gen = generateFromSchema(
      r01,
      adapted.header,
      adapted.rows,
      txids,
      branches,
    );
    return { filename: p.filename, content: gen.content };
  });
  usePartitionStore.getState().startSession({
    formatCode: "ACHR01",
    sourceFilename: sess.sourceFilename,
    index: { ...sess.index, formatCode: "ACHR01" },
    parts,
  });
  usePartitionStore.getState().setActiveIndex(0);
}

/** 將分割檔內容解析為表單資料（須 ≤ 可編輯上限） */
export function parsePartToForm(
  schema: FormatSchema,
  content: string,
  filename: string,
) {
  const result = parseAchText(content, schema, { filename });
  if (result.errors.length && result.detailCount === 0) {
    throw new Error(result.errors[0] ?? "分割檔解析失敗");
  }
  if (result.tooLargeForForm) {
    throw new Error(
      `此包 ${result.detailCount.toLocaleString("zh-TW")} 筆仍超過可編輯上限，請重新分割為更多包`,
    );
  }
  // 交易代號：明確以該包明細第一筆 TXID 為準
  const header = { ...result.header };
  const firstDetail = result.lines.find((l) => l.kind === "detail");
  const txidField = firstDetail?.fields.find(
    (f) => f.id === "TXID" || f.key === "txid",
  );
  const txid = (txidField?.value ?? "").trim();
  if (txid) header.txid = txid;

  return {
    header,
    rows: result.rows,
    detailCount: result.detailCount,
  };
}

/**
 * 大檔自動分割並進入編輯：依可編輯上限規劃包數，寫入工作區並載入第 1 包。
 */
export async function splitFileAndStartEdit(opts: {
  file: File;
  schema: FormatSchema;
  txids: Txid[];
  branches: Branch[];
  detailCount: number;
  preferredPartCount?: number;
  onProgress?: (p: PartitionProgress) => void;
}): Promise<{
  partCount: number;
  totalDetailCount: number;
  autoRaised: boolean;
  sourceHeaderLine?: string;
  sourceTrailerLine?: string;
  first: {
    header: HeaderValues;
    rows: DetailRow[];
    fileName: string;
    detailCount: number;
  };
}> {
  const plan = planPartitionsForEdit(
    opts.detailCount || 1,
    opts.preferredPartCount,
  );
  const outSchema = schemaForOutput(opts.schema);
  const partFiles: { filename: string; content: string }[] = [];
  const index = await partitionAchFile(
    opts.file,
    outSchema,
    opts.txids,
    opts.branches,
    {
      partCount: plan.partCount,
      onProgress: opts.onProgress,
      onPartition: (p) => {
        partFiles.push({ filename: p.filename, content: p.content });
      },
    },
  );

  usePartitionStore.getState().startSession({
    formatCode: opts.schema.code,
    sourceFilename: opts.file.name,
    index,
    parts: partFiles,
  });

  const first = partFiles[0];
  if (!first) throw new Error("分割結果為空");
  const parsed = parsePartToForm(opts.schema, first.content, first.filename);
  usePartitionStore.getState().setActiveIndex(0);

  return {
    partCount: index.partCount,
    totalDetailCount: index.totalDetailCount,
    autoRaised: plan.autoRaised,
    sourceHeaderLine: index.sourceHeaderLine ?? index.headerLine,
    sourceTrailerLine: index.sourceTrailerLine,
    first: {
      header: parsed.header,
      rows: parsed.rows,
      fileName: first.filename,
      detailCount: parsed.detailCount,
    },
  };
}

/** 合併工作區全部分割包為單一 ACH 檔 */
export function mergeSessionToFile(
  schema: FormatSchema,
  session: PartitionSession,
  txids: Txid[],
  branches: Branch[],
  options?: {
    exclude?: import("./exclude").ExcludeRulesDoc | null;
    processDate?: string | null;
    agentBank?: string | null;
  },
) {
  const index = syncIndex(session);
  const parts: Record<string, string> = {};
  for (const p of session.parts) {
    parts[p.filename] = p.content;
  }
  return mergeAchPartitions(
    schemaForOutput(schema),
    { index, parts },
    txids,
    branches,
    {
      exclude: options?.exclude ?? null,
      processDate: options?.processDate,
      agentBank: options?.agentBank,
    },
  );
}

/**
 * 收集分割工作區「全部包」的表頭＋明細（整檔，非僅目前開啟的那一包）。
 * 呼叫前請先將目前表單存回 active part（若有未存變更）。
 */
export function collectSessionRows(
  schema: FormatSchema,
  session: PartitionSession,
): {
  header: HeaderValues;
  rows: DetailRow[];
  /** 與 rows 對齊：分割工作區包號＋該包內列號（皆 1-based） */
  partRefs: { part: number; row: number }[];
} {
  if (!session.parts.length) {
    throw new Error("分割工作區沒有可轉檔的包");
  }
  const header: HeaderValues = { ...session.index.header };
  const rows: DetailRow[] = [];
  const partRefs: { part: number; row: number }[] = [];
  for (let p = 0; p < session.parts.length; p++) {
    const part = session.parts[p]!;
    const parsed = parsePartToForm(schema, part.content, part.filename);
    if (rows.length === 0) {
      Object.assign(header, parsed.header);
    }
    parsed.rows.forEach((row, j) => {
      rows.push(row);
      partRefs.push({ part: p + 1, row: j + 1 });
    });
  }
  return { header, rows, partRefs };
}

export function countNonEmptyRows(
  schema: FormatSchema,
  rows: DetailRow[],
): number {
  return rows.filter((r) => !isRowEmpty(r, schema)).length;
}

/** 供外部取得同步後的 index（合併下載用） */
export function sessionIndex(session: PartitionSession): PartitionIndex {
  return syncIndex(session);
}
