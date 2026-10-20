import { createHash } from "node:crypto";

// 雇用契約書の本文（PDF・同意記録のハッシュ用）。画面の全文表示
// （ContractsView.tsxのTemplateModalのプレビュー）と同じ項目・同じ書き方に
// そろえる。同意した時点の内容はこの形のままStaffContract.consentSnapshotに
// 保存し、あとから書式が変わっても同意した内容をそのまま出せるようにする。

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};
const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };
const WEEKDAYS = [
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
  { value: 0, label: "日" },
];

export type ContractDocument = {
  companyName: string;
  companyAddress: string | null;
  partyName: string;
  partyAddress: string | null;
  partyPhoneNumber: string | null;
  intro: string;
  rows: { label: string; value: string }[];
};

type TemplateFields = {
  employmentType: string;
  workplaceNote: string | null;
  jobDescription: string;
  scheduleType: string | null;
  workStartTime: string | null;
  workEndTime: string | null;
  actualWorkMinutes: number | null;
  breakMinutes: number | null;
  hasOvertime: boolean;
  overtimeNote: string | null;
  fixedWeekdays: number[];
  shiftPatternNote: string | null;
  restNote: string | null;
  wageType: string;
  paymentClosingDay: string | null;
  paymentDay: string | null;
  paymentMethod: string | null;
  contractPeriodType: string | null;
  extraItems: unknown;
};

export function buildContractDocument(params: {
  company: { name: string; address: string | null };
  party: { name: string; address: string | null; phoneNumber: string | null };
  template: TemplateFields;
  wageAmount: number;
  contractStartDate: string; // YYYY-MM-DD
  contractEndDate: string | null;
}): ContractDocument {
  const t = params.template;
  const start = params.contractStartDate;
  const isFixed = t.scheduleType !== "SHIFT";
  const workingDays = WEEKDAYS.filter((d) => t.fixedWeekdays.includes(d.value)).map((d) => d.label).join("・");
  const offDays = WEEKDAYS.filter((d) => !t.fixedWeekdays.includes(d.value)).map((d) => d.label).join("・");
  const actualWorkHours = t.actualWorkMinutes ? String(t.actualWorkMinutes / 60) : "8";
  const breakMinutes = t.breakMinutes != null ? String(t.breakMinutes) : "60";
  const extraItems = Array.isArray(t.extraItems) ? (t.extraItems as { label: string; value: string }[]) : [];

  return {
    companyName: params.company.name,
    companyAddress: params.company.address,
    partyName: params.party.name,
    partyAddress: params.party.address,
    partyPhoneNumber: params.party.phoneNumber,
    intro: `${params.company.name}（以下「甲」）と${params.party.name}（以下「乙」）は、${start}より、以下の内容で雇用契約を締結する。`,
    rows: [
      { label: "雇用形態", value: EMPLOYMENT_TYPE_LABEL[t.employmentType] ?? t.employmentType },
      { label: "雇用開始日", value: start },
      {
        label: "契約期間",
        value: t.contractPeriodType === "FIXED_TERM" ? `有期（${start}〜${params.contractEndDate || "未設定"}）` : "無期",
      },
      { label: "就業場所", value: t.workplaceNote || "自社" },
      { label: "業務内容", value: t.jobDescription || "未設定" },
      {
        label: "シフト",
        value: isFixed
          ? `固定（${workingDays || "未設定"}）`
          : `シフト制${t.shiftPatternNote ? `（${t.shiftPatternNote}）` : ""}`,
      },
      {
        label: "休み",
        value: isFixed ? `${offDays || "未設定"}${t.restNote ? `・${t.restNote}` : ""}` : t.restNote || "未設定",
      },
      {
        label: "所定の勤務時間",
        value: isFixed
          ? `${t.workStartTime || "--:--"}〜${t.workEndTime || "--:--"}（実働${actualWorkHours}時間／休憩${breakMinutes}分）`
          : "シフト制",
      },
      { label: "残業の有無", value: t.hasOvertime ? `あり${t.overtimeNote ? `（${t.overtimeNote}）` : ""}` : "なし" },
      { label: "賃金", value: `${WAGE_TYPE_LABEL[t.wageType] ?? t.wageType} ${params.wageAmount}円` },
      {
        label: "賃金の支払方法",
        value: `締め日 ${t.paymentClosingDay || "未設定"}／支払日 ${t.paymentDay || "未設定"}／${t.paymentMethod ?? ""}`,
      },
      ...extraItems.map((i) => ({ label: i.label, value: i.value || "—" })),
    ],
  };
}

// キーを並べ替えたJSON。DB（jsonb）はキーの順番を保たないため、保存した
// スナップショットからでも同じハッシュを計算し直せるようにする。
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 同意した内容（本文・当事者・同意日時）の指紋。1文字でも変わると値が変わる。
export function hashContractConsent(document: ContractDocument, consentedAt: string): string {
  return createHash("sha256").update(canonicalJson({ document, consentedAt })).digest("hex");
}
