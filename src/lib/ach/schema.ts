/** JSON 參數化的 ACH 檔案格式定義 */

export type Charset = "digit" | "alnum" | "any";

export type PadSpec = {
  side: "left" | "right" | "none";
  char?: string;
  onBlur?: boolean;
};

export type TxTypeCode = "SD" | "SC";

export type ValidationRule =
  | { type: "required"; message?: string }
  | { type: "requiredIfAny"; message?: string }
  | {
      /** 僅當表頭交易代號對應類別符合時，比照 requiredIfAny（代收 SD／代付 SC） */
      type: "requiredIfTxType";
      txTypes: TxTypeCode[];
      message?: string;
    }
  | { type: "exactLength"; length: number; message?: string }
  | { type: "maxLength"; length: number; message?: string }
  | { type: "oneOfLengths"; lengths: number[]; message?: string }
  | { type: "rocDate"; notPast?: boolean; message?: string }
  | {
      type: "txid";
      /** 代號數值下限（舊規則；ACHP02 代收類仍可用） */
      minValue?: number;
      /** 僅允許指定交易類別（SD 代收／SC 代付） */
      txTypes?: TxTypeCode[];
      message?: string;
    }
  | { type: "branchCode"; message?: string }
  | { type: "number"; message?: string }
  | { type: "maxIntegerDigits"; length: number; message?: string };

export type FormFieldDef = {
  key: string;
  /** 對應 records.detail 欄位 ID（與檔案欄序同步） */
  id?: string;
  label: string;
  placeholder?: string;
  inputType: "text" | "rocDate" | "amount" | "select";
  length: number;
  charset: Charset;
  required?: boolean;
  pad?: PadSpec;
  validation?: { rules: ValidationRule[] };
  picker?: "txid" | "branch" | null;
  metaFrom?: "txid" | "branch" | null;
  optionsFrom?: "authOptions";
  /**
   * 是否可在明細列篩選。預設 true。
   * 設為 false 可從篩選列隱藏該欄。
   */
  filterable?: boolean;
  /** 寫入 JSON／檔案但不出現在編輯表（literal／filler／衍生欄） */
  hidden?: boolean;
  export?: {
    charset?: Charset;
    length?: number;
    pad?: PadSpec;
    transform?: "floorInt" | "firstChar";
  };
  ui?: {
    mono?: boolean;
    colSpan?: number;
    minWidth?: string;
    align?: "left" | "right";
  };
  /** 財金規格「欄位起」（1-based digit 位置，含端點） */
  digitStart?: number;
  /** 財金規格「欄位迄」（1-based digit 位置，含端點） */
  digitEnd?: number;
};

export type RecordFieldSource =
  | "literal"
  | "formatCode"
  | "version"
  | "header"
  | "detail"
  | "runtime"
  | "derived"
  | "filler";

export type RecordFieldDef = {
  id: string;
  source: RecordFieldSource;
  /** 財金規格／Excel 欄位中文名（如「首錄別」「處理日期」） */
  label?: string;
  /** literal 值 */
  value?: string;
  /** header / detail 欄位 key */
  key?: string;
  /** runtime / derived 函式名 */
  fn?: "nowHms" | "sorg" | "txType" | "seq" | "totalCount" | "totalAmount";
  length: number;
  charset?: Charset;
  pad?: PadSpec;
  fill?: string;
  transform?: "floorInt" | "firstChar";
  /** 財金規格「欄位起」（1-based digit 位置，含端點） */
  digitStart?: number;
  /** 財金規格「欄位迄」（1-based digit 位置，含端點） */
  digitEnd?: number;
};

export type AuthOptionDef = {
  value: string;
  label: string;
  note: string;
  desc: string;
};

/** 成品輸出格式：txt 固定長度｜html 報表｜js 資料模組 */
export type ExportFormatId = "txt" | "html" | "js";

export type FormatSchema = {
  code: string;
  shortCode: string;
  name: string;
  description?: string;
  version: string;
  recordLength: number;
  lineEnding: string;
  filenamePattern: string;
  features: {
    sumAmount: boolean;
    amountKey: string | null;
    authOptions: boolean;
    /** 是否啟用明細篩選列（預設 true） */
    detailFilter?: boolean;
    /**
     * 成品輸出格式清單。預設 ["txt"]。
     * 可擴充 ["txt","html","js"]。
     */
    exportFormats?: ExportFormatId[];
  };
  authOptions?: AuthOptionDef[];
  form: {
    header: FormFieldDef[];
    detail: FormFieldDef[];
  };
  records: {
    header: { fields: RecordFieldDef[] };
    detail: { fields: RecordFieldDef[] };
    trailer: { fields: RecordFieldDef[] };
  };
};

export type FormatIndexEntry = {
  code: string;
  shortCode: string;
  name: string;
  description?: string;
  schemaFile: string;
  icon?: string;
};

export type FormatIndex = {
  version: number;
  description?: string;
  defaultCode: string;
  formats: FormatIndexEntry[];
};

export type Branch = {
  code: string;
  name: string;
  head: string;
};

export type Txid = {
  code: string;
  type: string;
  name: string;
  flag: string;
};

export type HeaderValues = Record<string, string>;
export type DetailRow = { id: string } & Record<string, string>;
