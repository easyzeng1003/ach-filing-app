/**
 * ACHP01（提出）→ ACHR01（提回／退件）轉換
 *
 * 依據財金《ACHP01-ACH入扣帳資料提出提回檔檔案規格》：
 * - 提出／提回共用 250 bytes／錄
 * - Header/Trailer CDATA：ACHP01 → ACHR01
 * - Detail TYPE：N → R
 * - 退件時對調：PBANK/PCLNO ← 原 RBANK/RCLNO；RBANK/RCLNO ← 原 PBANK/PCLNO
 * - 退件必填：RCODE、PDATE、PSEQ、PSCHD
 * - Trailer YDATE：ACHR01 置放前一營業日（ACHP01 空白）
 *
 * 輸出：單一整檔（不依收受行分檔）；
 * BOF／EOF：SORG 固定 9990250；RORG＝收受行代表行代號。
 */

import { generateFromSchema, resolveSorg } from "./engine";
import type {
  Branch,
  DetailRow,
  FormatSchema,
  HeaderValues,
  Txid,
} from "./schema";
import { prevRocDate, safeDigits } from "./utils";

/** 財金資訊公司單位代號（ACHR01 發送單位） */
export const ACHR01_SORG = "9990250";

export type ReturnCode = {
  code: string;
  label: string;
};

/** 財金規格退件理由代號（ACHP01/ACHR01 欄位說明） */
export const RETURN_CODES: ReturnCode[] = [
  { code: "01", label: "01 存款不足（SD）" },
  { code: "02", label: "02 非委託用戶（SD）" },
  { code: "03", label: "03 已終止委託用戶（SD）" },
  { code: "04", label: "04 無此帳號（SC,SD）" },
  { code: "05", label: "05 收受者統編錯誤（SC,SD）" },
  { code: "06", label: "06 無此用戶號碼（SD）" },
  { code: "07", label: "07 用戶號碼不符（SD）" },
  { code: "08", label: "08 信用卡額度不足（SD）" },
  { code: "09", label: "09 未開卡（SD）" },
  { code: "10", label: "10 部分存款不足（SD651）" },
  { code: "11", label: "11 超過扣款限額（SD）" },
  { code: "12", label: "12 信用卡未續卡（SD）" },
  { code: "13", label: "13 信用卡其他問題（SD）" },
  { code: "22", label: "22 帳戶已結清（SC,SD）" },
  { code: "23", label: "23 靜止戶（SC,SD）" },
  { code: "24", label: "24 凍結戶（SC,SD）" },
  { code: "25", label: "25 帳戶存款遭法院強制執行（SC,SD）" },
  { code: "26", label: "26 警示戶（SC,SD）" },
  { code: "27", label: "27 該用戶已死亡（SC,SD）" },
  { code: "28", label: "28 發動行申請停止入扣帳（SC,SD）" },
  { code: "91", label: "91 未交易或匯入失敗（票交所匯出）" },
  { code: "99", label: "99 其它（SC,SD）" },
];

export type ConvertP01ToR01Options = {
  /** 退件理由代號（2 碼），套用至所有明細 */
  rcode: string;
  /**
   * Trailer YDATE（前一營業日，民國年 8 碼 YYYYMMDD）。
   * 未指定時以提出檔處理日期往前推一日（簡易日曆日）。
   */
  ydate?: string;
  /** 原提示交易日期 PDATE（8 碼）。未指定時使用提出檔處理日期。 */
  pdate?: string;
  /**
   * 原提示序號起算偏移（分塊轉檔用）。
   * 實際 PSEQ = seqOffset + 塊內序號（塊內自 1 起）。
   */
  seqOffset?: number;
  /**
   * 收受行代表行代號（7 碼）→ 寫入 ACHR01 BOF／EOF 的 RORG。
   * 中信 `822*` 會正規成 `8220901`。
   */
  agentBank: string;
};

export type ConvertedR01File = {
  content: string;
  filename: string;
  count: number;
  amount: number;
  /** 表頭採用的退件行（首筆）；整檔不依收受行分檔 */
  returnBank: string;
  lines: string[];
};

export type ConvertP01ToR01Result = {
  files: ConvertedR01File[];
  detailCount: number;
  ydate: string;
  pdate: string;
  rcode: string;
};

function requireRoc8(value: string, label: string): string {
  const d = safeDigits(value);
  if (d.length !== 8) {
    throw new Error(`${label}須為 8 碼民國年月日（目前 ${d.length || 0} 碼）`);
  }
  return d;
}

function requireRcode(value: string): string {
  const d = safeDigits(value);
  if (d.length === 0 || d.length > 2) {
    throw new Error(`退件理由代號須為 2 碼（目前「${value}」）`);
  }
  return d.padStart(2, "0");
}

/** 正規化收受行代表行代號（7 碼；822* → 8220901） */
export function requireAgentBank(value: string, branches: Branch[]): string {
  const d = safeDigits(value);
  if (d.length !== 7) {
    throw new Error(
      `代表行代號須為 7 碼（目前 ${d.length || 0} 碼「${value}」）`,
    );
  }
  return resolveSorg(d, branches);
}

function padSeq8(seq: number | string): string {
  const d = safeDigits(String(seq));
  return d.padStart(8, "0").slice(-8);
}

/**
 * 將 ACHP01 表單資料轉成 ACHR01 提回／退件檔。
 * 一律輸出單一整檔（不依收受行分檔）；呼叫端可先排除再傳入。
 */
export function convertP01ToR01(
  r01Schema: FormatSchema,
  p01Header: HeaderValues,
  p01Rows: DetailRow[],
  txids: Txid[],
  branches: Branch[],
  options: ConvertP01ToR01Options,
): ConvertP01ToR01Result {
  if (r01Schema.code !== "ACHR01") {
    throw new Error("轉檔目標格式須為 ACHR01");
  }

  const rcode = requireRcode(options.rcode);
  const agentBank = requireAgentBank(options.agentBank, branches);
  const tdate = requireRoc8(String(p01Header.date ?? ""), "處理日期（TDATE）");
  const pdate = requireRoc8(options.pdate ?? tdate, "原提示交易日期（PDATE）");
  const ydateRaw = options.ydate?.trim()
    ? options.ydate
    : (prevRocDate(tdate) ?? "");
  const ydate = requireRoc8(ydateRaw, "前一營業日（YDATE）");

  const presenterBank = safeDigits(String(p01Header.bankCode ?? ""));
  const presenterAccount = safeDigits(String(p01Header.account ?? ""));
  if (presenterBank.length !== 7) {
    throw new Error("提出行銀行代號須為 7 碼");
  }
  if (!presenterAccount) {
    throw new Error("發動者帳號未輸入");
  }

  const nonEmpty = p01Rows.filter((r) => !isP01DetailEmpty(r));
  if (nonEmpty.length === 0) {
    throw new Error("沒有明細列可轉檔");
  }

  const seqOffset = Math.max(0, Math.floor(options.seqOffset ?? 0));

  const items: Array<{ row: DetailRow; origSeq: number; returnBank: string }> =
    [];
  let seq = 0;
  for (const row of nonEmpty) {
    seq += 1;
    const returnBank = safeDigits(String(row.bankCode ?? ""));
    if (returnBank.length !== 7) {
      throw new Error(`第 ${seqOffset + seq} 筆收受者銀行代號須為 7 碼`);
    }
    items.push({ row, origSeq: seqOffset + seq, returnBank });
  }

  const headerBank = items[0]!.returnBank;
  const header: HeaderValues = {
    date: tdate,
    txid: String(p01Header.txid ?? ""),
    bankCode: headerBank,
    agentBank,
    account: safeDigits(String(items[0]!.row.account ?? "")),
    taxId: String(p01Header.taxId ?? ""),
    ydate,
  };

  const rows: DetailRow[] = items.map(({ row, origSeq, returnBank }) => {
    const recvAccount = safeDigits(String(row.account ?? ""));
    if (recvAccount.length === 0) {
      throw new Error(`原提示序號 ${padSeq8(origSeq)} 收受者帳號未輸入`);
    }
    return {
      id: row.id,
      bankCode: returnBank,
      account:
        recvAccount.length < 16 ? recvAccount.padStart(16, "0") : recvAccount,
      taxId: String(row.taxId ?? ""),
      userNo: String(row.userNo ?? ""),
      amount: String(row.amount ?? ""),
      origBankCode: presenterBank,
      origAccount:
        presenterAccount.length < 16
          ? presenterAccount.padStart(16, "0")
          : presenterAccount,
      rcode,
      pdate,
      pseq: padSeq8(origSeq),
      pschd: "B",
    };
  });

  const generated = generateFromSchema(
    r01Schema,
    header,
    rows,
    txids,
    branches,
  );

  const bad = generated.lines.find((l) => l.length !== r01Schema.recordLength);
  if (bad) {
    throw new Error(
      `提回列長度 ${bad.length} 與定義 ${r01Schema.recordLength} 不符`,
    );
  }

  const detailLine = generated.lines[1] ?? "";
  if (detailLine[0] !== "R") {
    throw new Error("提回明細 TYPE 應為 R");
  }
  if (!generated.lines[0]?.includes("ACHR01")) {
    throw new Error("提回首錄 CDATA 應為 ACHR01");
  }

  return {
    files: [
      {
        content: generated.content,
        filename: generated.filename,
        count: generated.count,
        amount: generated.amount,
        returnBank: headerBank,
        lines: generated.lines,
      },
    ],
    detailCount: nonEmpty.length,
    ydate,
    pdate,
    rcode,
  };
}

function isP01DetailEmpty(row: DetailRow): boolean {
  const keys = ["bankCode", "account", "taxId", "userNo", "amount"] as const;
  return keys.every((k) => !String(row[k] ?? "").trim());
}
