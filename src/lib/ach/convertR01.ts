/**
 * ACHP01（提出）⇄ ACHR01（提回／退件）轉換
 *
 * 依據財金《ACHP01-ACH入扣帳資料提出提回檔檔案規格》：
 * - 提出／提回共用 250 bytes／錄
 * - Header/Trailer CDATA：ACHP01 ⇄ ACHR01
 * - Detail TYPE：N ⇄ R
 * - 退件時每個明細列 1-based 第 15–37 碼與第 38–60 碼對調
 *   （PBANK+PCLNO ↔ RBANK+RCLNO）
 * - 退件必填：RCODE、PDATE、PSEQ、PSCHD（轉回 P01 時清空為 filler）
 * - 輸出 R01 時 PSEQ 用該列表單 pseq（上傳檔原值）；空白才回退 SEQ／列序
 * - Trailer YDATE：ACHR01 為 TDATE 前一日（ACHP01 空白）
 *
 * 輸出：單一整檔（不依收受行分檔）；
 * P01→R01 BOF／EOF：SORG 固定 9990250；RORG＝收受行代表行代號。
 * R01→P01 BOF／EOF：SORG 由提出行代號衍生；RORG 固定 9990250。
 */

import { generateFromSchema, resolveR01Ydate, resolveSorg } from "./engine";
import type {
  Branch,
  DetailRow,
  FormatSchema,
  HeaderValues,
  Txid,
} from "./schema";
import { safeDigits } from "./utils";

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
   * Trailer YDATE：輸出一律為 TDATE 前一日。
   */
  ydate?: string;
  /** 原提示交易日期 PDATE（8 碼）。未指定時使用提出檔處理日期。 */
  pdate?: string;
  /**
   * 原提示序號起算偏移（分塊轉檔、且列上無原上傳 SEQ 時）。
   * 實際 PSEQ 優先＝該列表單 pseq（檔案原值）；空白才用 SEQ 或 seqOffset + 塊內序號。
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
 * 只判斷明細 N/R：取明細（第一筆有 TYPE 值者）的交易型態字首。
 * - N＝提出：PBANK/PCLNO＝提出行／發動者；RBANK/RCLNO＝收受者。
 * - R＝提回／退件（已對調）：PBANK/PCLNO＝退件行；RBANK/RCLNO＝原提示行。
 * 無 TYPE 時回傳 null，由呼叫端沿用既有版面推斷。
 */
export function detailTypeOfRows(rows: DetailRow[]): "N" | "R" | null {
  const withType = rows.find((r) => String(r.type ?? "").trim());
  const c = String(withType?.type ?? "").trim().toUpperCase().charAt(0);
  return c === "N" || c === "R" ? c : null;
}

/** R01 PSEQ ← 檔案／表單 pseq；空白才回退 SEQ 或列序 */
function pseqFromUploadedSeq(row: DetailRow, fallbackSeq: number): string {
  const fromPseq = safeDigits(String(row.pseq ?? ""));
  if (fromPseq) return padSeq8(fromPseq);
  const fromSeq = safeDigits(String(row.seq ?? ""));
  if (fromSeq) return padSeq8(fromSeq);
  return padSeq8(fallbackSeq);
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
  const ydate = resolveR01Ydate(options.ydate, tdate);

  const headerPresenterBank = safeDigits(String(p01Header.bankCode ?? ""));
  const headerPresenterAccount = safeDigits(String(p01Header.account ?? ""));

  const nonEmpty = p01Rows.filter((r) => !isP01DetailEmpty(r));
  if (nonEmpty.length === 0) {
    throw new Error("沒有明細列可轉檔");
  }

  const seqOffset = Math.max(0, Math.floor(options.seqOffset ?? 0));

  // 只判斷明細 N/R —— 逐列判斷（不再用首列型態代表整檔）：
  // - N＝提出：PBANK/PCLNO＝發動者、RBANK/RCLNO＝收受者 → 輸出回應時對調
  //   （收受者→退件行放 PBANK；發動者→原提示放 RBANK）。
  // - R＝已是提回對調：PBANK/PCLNO＝退件行/收受者、RBANK/RCLNO＝原提示/發動者 → 保留。
  // 各列先排成最終提回版面（PBANK＝退件行、RBANK＝原提示），引擎不再整批對調。
  let seq = 0;
  const rows: DetailRow[] = [];
  for (const row of nonEmpty) {
    seq += 1;
    const origSeq = seqOffset + seq;
    const isR =
      String(row.type ?? "").trim().toUpperCase().charAt(0) === "R";
    // 退件行（收受者）→ PBANK/PCLNO
    const retnBank = safeDigits(String((isR ? row.origBankCode : row.bankCode) ?? ""));
    const retnAcct = safeDigits(String((isR ? row.origAccount : row.account) ?? ""));
    // 原提示（發動者）→ RBANK/RCLNO；缺列值時回退表頭
    const presBankRaw = safeDigits(String((isR ? row.bankCode : row.origBankCode) ?? ""));
    const presAcctRaw = safeDigits(String((isR ? row.account : row.origAccount) ?? ""));
    const presBank = presBankRaw.length === 7 ? presBankRaw : headerPresenterBank;
    const presAcct = presAcctRaw || headerPresenterAccount;
    if (retnBank.length !== 7) {
      throw new Error(`第 ${origSeq} 筆收受者銀行代號須為 7 碼`);
    }
    if (!retnAcct) {
      throw new Error(`原提示序號 ${padSeq8(origSeq)} 收受者帳號未輸入`);
    }
    if (presBank.length !== 7) {
      throw new Error(`第 ${origSeq} 筆提出行銀行代號須為 7 碼`);
    }
    if (!presAcct) {
      throw new Error(`第 ${origSeq} 筆發動者帳號未輸入`);
    }
    rows.push({
      id: row.id,
      // PBANK/PCLNO＝退件行/收受者
      origBankCode: retnBank,
      origAccount:
        retnAcct.length < 16 ? retnAcct.padStart(16, "0") : retnAcct,
      // RBANK/RCLNO＝原提示/發動者
      bankCode: presBank,
      account: presAcct.length < 16 ? presAcct.padStart(16, "0") : presAcct,
      taxId: String(row.taxId ?? ""),
      userNo: String(row.userNo ?? ""),
      amount: String(row.amount ?? ""),
      rcode,
      pdate,
      pseq: pseqFromUploadedSeq(row, origSeq),
      pschd: "B",
    });
  }

  const headerBank = safeDigits(String(rows[0]!.origBankCode ?? ""));
  const header: HeaderValues = {
    date: tdate,
    txid: String(p01Header.txid ?? ""),
    bankCode: headerBank,
    agentBank,
    account: safeDigits(String(rows[0]!.origAccount ?? "")),
    taxId: String(p01Header.taxId ?? ""),
    ydate,
  };

  const generated = generateFromSchema(r01Schema, header, rows, txids, branches, {
    swapR01Banks: false,
  });

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

function isR01DetailEmpty(row: DetailRow): boolean {
  const keys = [
    "bankCode",
    "account",
    "origBankCode",
    "origAccount",
    "amount",
  ] as const;
  return keys.every((k) => !String(row[k] ?? "").trim());
}

export type ConvertR01ToP01Options = {
  /**
   * 覆寫處理日期（8 碼民國年月日）。
   * 未指定時使用提回檔處理日期。
   */
  date?: string;
  /**
   * 原檔輸出：保留每列原始 TYPE（N/R），不強制改為 P01 的 N。
   */
  preserveDetailType?: boolean;
  /**
   * 明細為 R 時參照此 schema（ACHR01）的明細規範輸出，即使首錄／尾錄為 P01。
   * 搭配 preserveDetailType 使用。
   */
  responseDetailSchema?: FormatSchema;
};

export type ConvertedP01File = {
  content: string;
  filename: string;
  count: number;
  amount: number;
  /** 提出行（R01 RBANK／origBankCode，原提示行） */
  presenterBank: string;
  lines: string[];
};

export type ConvertR01ToP01Result = {
  files: ConvertedP01File[];
  detailCount: number;
  /** 轉成 P01 後的表頭（提出行＝R01 原提示行 RBANK） */
  header: HeaderValues;
  /** 轉成 P01 後的明細（收受行＝R01 退件行 PBANK） */
  rows: DetailRow[];
};

function r01BankAcct(
  row: DetailRow,
  side: "orig" | "recv",
): { bank: string; acct: string } {
  if (side === "orig") {
    return {
      bank: safeDigits(String(row.origBankCode ?? "")),
      acct: safeDigits(String(row.origAccount ?? "")),
    };
  }
  return {
    bank: safeDigits(String(row.bankCode ?? "")),
    acct: safeDigits(String(row.account ?? "")),
  };
}

/**
 * 將 ACHR01 提回／退件表單資料轉回 ACHP01 提出檔。
 * - TYPE R→N；CDATA ACHR01→ACHP01
 * - 逐列判斷 N/R：N 保留（提示行在 PBANK/PCLNO）；R 對調回提出（提示行取自 RBANK/RCLNO）
 * - 清除 RCODE／PDATE／PSEQ／PSCHD／YDATE
 * - 一律輸出單一整檔
 */
export function convertR01ToP01(
  p01Schema: FormatSchema,
  r01Header: HeaderValues,
  r01Rows: DetailRow[],
  txids: Txid[],
  branches: Branch[],
  options: ConvertR01ToP01Options = {},
): ConvertR01ToP01Result {
  if (p01Schema.code !== "ACHP01") {
    throw new Error("轉檔目標格式須為 ACHP01");
  }

  const tdate = requireRoc8(
    options.date?.trim()
      ? options.date
      : String(r01Header.date ?? ""),
    "處理日期（TDATE）",
  );

  const nonEmpty = r01Rows.filter((r) => !isR01DetailEmpty(r));
  if (nonEmpty.length === 0) {
    throw new Error("沒有明細列可轉檔");
  }

  // 只判斷明細 N/R —— 逐列判斷（不用首列型態代表整檔）：
  // - N＝提出：提示行（發動者）在 PBANK/PCLNO、收受者在 RBANK/RCLNO → 保留版面。
  // - R＝提回對調：提示行（原發動者）在 RBANK/RCLNO、退件行（收受者）在 PBANK/PCLNO
  //   → 對調回提出（發動者→PBANK、收受者→RBANK）。
  // 原檔輸出（preserveDetailType）維持逐列原樣：提示行一律取自 PBANK/PCLNO、不對調、
  // 保留每列 TYPE 與回應欄位（RCODE／PDATE／PSEQ／PSCHD）。
  let seq = 0;
  const rows: DetailRow[] = [];
  for (const row of nonEmpty) {
    seq += 1;
    const rowIsR =
      !options.preserveDetailType &&
      String(row.type ?? "").trim().toUpperCase().charAt(0) === "R";
    const presenter = r01BankAcct(row, rowIsR ? "recv" : "orig");
    const recv = r01BankAcct(row, rowIsR ? "orig" : "recv");
    if (presenter.bank.length !== 7) {
      throw new Error(`第 ${seq} 筆原提示行銀行代號須為 7 碼`);
    }
    if (!presenter.acct) {
      throw new Error(`第 ${seq} 筆原發動者帳號未輸入`);
    }
    if (recv.bank.length !== 7) {
      throw new Error(`第 ${seq} 筆收受者銀行代號須為 7 碼`);
    }
    if (!recv.acct) {
      throw new Error(`第 ${seq} 筆收受者帳號未輸入`);
    }
    const txid =
      String(row.txid ?? "").trim() || String(r01Header.txid ?? "").trim();
    rows.push({
      id: row.id,
      bankCode: recv.bank,
      account: recv.acct.length < 16 ? recv.acct.padStart(16, "0") : recv.acct,
      taxId: String(row.taxId ?? ""),
      userNo: String(row.userNo ?? ""),
      amount: String(row.amount ?? ""),
      // 逐列保留發動者統編（CID），避免輸出時回退表頭統編或空白
      cid: String(row.cid ?? ""),
      origBankCode: presenter.bank,
      origAccount:
        presenter.acct.length < 16
          ? presenter.acct.padStart(16, "0")
          : presenter.acct,
      ...(txid ? { txid } : {}),
      // 原檔輸出：保留該列原始 TYPE，並保留回應（R）明細欄位（RCODE／PDATE／PSEQ／PSCHD），
      // 使「BOF 為 P01 但明細為 R」時明細仍能參照 ACHR01 明細規範輸出。
      ...(options.preserveDetailType && String(row.type ?? "").trim()
        ? {
            type: String(row.type),
            rcode: String(row.rcode ?? ""),
            pdate: String(row.pdate ?? ""),
            pseq: String(row.pseq ?? ""),
            pschd: String(row.pschd ?? ""),
          }
        : {}),
    });
  }

  // 表頭提出行＝首列提示行（發動者）
  const presenterBank = safeDigits(String(rows[0]!.origBankCode ?? ""));
  const presenterAccount = safeDigits(String(rows[0]!.origAccount ?? ""));

  const headerTxid =
    String(r01Header.txid ?? "").trim() ||
    String(rows[0]?.txid ?? "").trim();

  const header: HeaderValues = {
    date: tdate,
    txid: headerTxid,
    bankCode: presenterBank,
    account:
      presenterAccount.length < 16
        ? presenterAccount.padStart(16, "0")
        : presenterAccount,
    taxId: String(r01Header.taxId ?? ""),
  };

  const generated = generateFromSchema(
    p01Schema,
    header,
    rows,
    txids,
    branches,
    options.preserveDetailType
      ? {
          preserveDetailType: true,
          // 明細為 R 時參照 ACHR01 明細規範（RCODE／PDATE／PSEQ／PSCHD）
          responseDetailSchema: options.responseDetailSchema,
        }
      : undefined,
  );

  const bad = generated.lines.find((l) => l.length !== p01Schema.recordLength);
  if (bad) {
    throw new Error(
      `提出列長度 ${bad.length} 與定義 ${p01Schema.recordLength} 不符`,
    );
  }

  const detailLine = generated.lines[1] ?? "";
  // 原檔輸出保留原始 TYPE 時不強制為 N
  if (!options.preserveDetailType && detailLine[0] !== "N") {
    throw new Error("提出明細 TYPE 應為 N");
  }
  if (!generated.lines[0]?.includes("ACHP01")) {
    throw new Error("提出首錄 CDATA 應為 ACHP01");
  }

  return {
    files: [
      {
        content: generated.content,
        filename: generated.filename,
        count: generated.count,
        amount: generated.amount,
        presenterBank,
        lines: generated.lines,
      },
    ],
    detailCount: nonEmpty.length,
    header,
    rows,
  };
}

export type ConvertToggleOptions = {
  /** 退件理由代號（2 碼）；有 N→R 明細時必填 */
  rcode?: string;
  /** 原提示交易日期 PDATE（8 碼）；未指定時用處理日期 */
  pdate?: string;
  /** Trailer YDATE（ACHR01 尾錄）；預設處理日前一日 */
  ydate?: string;
  /** 代表行代號（ACHR01 BOF/EOF RORG）；首尾錄為 ACHR01 時必填 */
  agentBank?: string;
};

export type ConvertToggleResult = {
  content: string;
  filename: string;
  lines: string[];
  count: number;
  amount: number;
  detailCount: number;
  /** N→R（提出→回應）筆數 */
  toR: number;
  /** R→N（回應→提出）筆數 */
  toN: number;
  rcode: string;
};

/**
 * 單一「轉檔輸出」：逐列 N⇄R 互換（同時處理 n→r 與 r→n）。
 * - 明細 N → 回應 R：提示／提回互換（PBANK/PCLNO ↔ RBANK/RCLNO）、TYPE=R，
 *   並依 ACHR01 明細規範填 RCODE／PDATE／PSEQ／PSCHD。
 * - 明細 R → 提出 N：提示／提回互換、TYPE=N，清除 R 明細欄位。
 * 首錄／尾錄格式由 envSchema（輸出格式下拉，ACHP01／ACHR01）決定，與明細互換拆開；
 * 明細為 R 者一律參照 ACHR01 明細規範（即使首尾錄為 ACHP01）。
 */
export function convertToggleDetails(
  envSchema: FormatSchema,
  p01Schema: FormatSchema,
  r01Schema: FormatSchema,
  header: HeaderValues,
  rows: DetailRow[],
  txids: Txid[],
  branches: Branch[],
  options: ConvertToggleOptions = {},
): ConvertToggleResult {
  if (envSchema.code !== "ACHP01" && envSchema.code !== "ACHR01") {
    throw new Error("輸出格式須為 ACHP01 或 ACHR01");
  }
  const tdate = requireRoc8(String(header.date ?? ""), "處理日期（TDATE）");
  const nonEmpty = rows.filter(
    (r) => !isP01DetailEmpty(r) || !isR01DetailEmpty(r),
  );
  if (nonEmpty.length === 0) {
    throw new Error("沒有明細列可轉檔");
  }
  const hasToR = nonEmpty.some(
    (r) => String(r.type ?? "").trim().toUpperCase().charAt(0) !== "R",
  );
  const rcode = hasToR ? requireRcode(options.rcode ?? "") : "";
  const pdate = hasToR
    ? requireRoc8(options.pdate ?? tdate, "原提示交易日期（PDATE）")
    : "";
  const agentBank =
    envSchema.code === "ACHR01"
      ? requireAgentBank(options.agentBank ?? "", branches)
      : safeDigits(String(options.agentBank ?? ""));
  const ydate = resolveR01Ydate(options.ydate, tdate);

  let seq = 0;
  let toR = 0;
  let toN = 0;
  const flipped: DetailRow[] = nonEmpty.map((row) => {
    seq += 1;
    const isR = String(row.type ?? "").trim().toUpperCase().charAt(0) === "R";
    const newType = isR ? "N" : "R";
    if (newType === "R") toR += 1;
    else toN += 1;
    // 提示／提回互換：新 PBANK/PCLNO ← 原 RBANK/RCLNO；新 RBANK/RCLNO ← 原 PBANK/PCLNO
    const newOrigBank = safeDigits(String(row.bankCode ?? ""));
    const newOrigAcct = safeDigits(String(row.account ?? ""));
    const newBank = safeDigits(String(row.origBankCode ?? ""));
    const newAcct = safeDigits(String(row.origAccount ?? ""));
    if (newOrigBank.length !== 7) {
      throw new Error(`第 ${seq} 筆收受者／退件行銀行代號須為 7 碼`);
    }
    if (newBank.length !== 7) {
      throw new Error(`第 ${seq} 筆提出行／原提示行銀行代號須為 7 碼`);
    }
    if (!newOrigAcct || !newAcct) {
      throw new Error(`第 ${seq} 筆帳號未輸入`);
    }
    // 輸出 SEQ(7-14)：優先取來源序號（7-14）；空白才用列序。
    const srcSeqDigits = safeDigits(String(row.seq ?? ""));
    const outSeq = srcSeqDigits ? padSeq8(srcSeqDigits) : padSeq8(seq);
    const base: DetailRow = {
      id: row.id,
      origBankCode: newOrigBank,
      origAccount:
        newOrigAcct.length < 16 ? newOrigAcct.padStart(16, "0") : newOrigAcct,
      bankCode: newBank,
      account: newAcct.length < 16 ? newAcct.padStart(16, "0") : newAcct,
      taxId: String(row.taxId ?? ""),
      userNo: String(row.userNo ?? ""),
      amount: String(row.amount ?? ""),
      // 逐列保留發動者統編（CID 74-83）、交易代號；SEQ 取來源序號（7-14）
      cid: String(row.cid ?? ""),
      seq: outSeq,
      ...(String(row.txid ?? "").trim() ? { txid: String(row.txid) } : {}),
      type: newType,
    } as DetailRow;
    if (newType === "R") {
      base.rcode = rcode;
      base.pdate = pdate;
      // 原提示序號 PSEQ(108-115) ← 來源 SEQ(7-14)，與輸出 SEQ 一致
      base.pseq = outSeq;
      base.pschd = "B";
    }
    return base;
  });

  const headerOut: HeaderValues = {
    date: tdate,
    txid: String(header.txid ?? ""),
    bankCode: safeDigits(String(flipped[0]!.origBankCode ?? "")),
    account: safeDigits(String(flipped[0]!.origAccount ?? "")),
    taxId: String(header.taxId ?? ""),
    ...(envSchema.code === "ACHR01" ? { agentBank, ydate } : {}),
  };

  const generated = generateFromSchema(
    envSchema,
    headerOut,
    flipped,
    txids,
    branches,
    {
      preserveDetailType: true,
      // 明細各依自身型態的規範：R→ACHR01、N→ACHP01（與首尾錄格式拆開）
      responseDetailSchema: r01Schema,
      submitDetailSchema: p01Schema,
      swapR01Banks: false,
    },
  );

  const bad = generated.lines.find((l) => l.length !== envSchema.recordLength);
  if (bad) {
    throw new Error(
      `列長度 ${bad.length} 與定義 ${envSchema.recordLength} 不符`,
    );
  }

  return {
    content: generated.content,
    filename: generated.filename,
    lines: generated.lines,
    count: generated.count,
    amount: generated.amount,
    detailCount: nonEmpty.length,
    toR,
    toN,
    rcode,
  };
}
