import "server-only";
import { prisma } from "@/lib/prisma";
import type {
  EmploymentType,
  WorkplaceType,
  ContractScheduleType,
  ContractPeriodType,
  WageType,
} from "@/generated/prisma/enums";

export type TemplateInput = {
  companyId: string;
  title: string;
  employmentType: EmploymentType;
  workplaceType: WorkplaceType;
  companyRelationshipId?: string;
  workplaceNote?: string;
  jobDescription: string;
  scheduleType: ContractScheduleType;
  workStartTime?: string;
  workEndTime?: string;
  actualWorkMinutes?: number;
  breakMinutes?: number;
  hasOvertime: boolean;
  overtimeNote?: string;
  fixedWeekdays: number[];
  shiftPatternNote?: string;
  restNote?: string;
  wageType: WageType;
  wageAmount: number;
  paymentClosingDay?: string;
  paymentDay?: string;
  paymentMethod?: string;
  contractPeriodType: ContractPeriodType;
  contractStartDate: Date;
  contractEndDate?: Date;
  hasRenewal: boolean;
  probationPeriodNote?: string;
  extraItems: { label: string; value: string }[];
};

export async function listTemplates(companyId: string) {
  return prisma.contractTemplate.findMany({
    where: { companyId },
    include: {
      staffContracts: { include: { staff: true } },
      companyRelationship: { include: { clientCompany: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createTemplate(input: TemplateInput) {
  return prisma.contractTemplate.create({ data: { ...input, extraItems: input.extraItems } });
}

async function countLiveContracts(templateId: string) {
  return prisma.staffContract.count({
    where: { templateId, status: { in: ["PENDING_CONSENT", "ACTIVE"] } },
  });
}

export async function recomputeTemplateLock(templateId: string) {
  const count = await countLiveContracts(templateId);
  const template = await prisma.contractTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (template.status === "ARCHIVED") return;
  await prisma.contractTemplate.update({
    where: { id: templateId },
    data: { status: count > 0 ? "LOCKED" : "ACTIVE" },
  });
}

// 編集: a LOCKED template (>=1 contracted staff) cannot be mutated — editing
// instead creates a titled duplicate, preserving the original's history
// (chat10). Templates with 0 contracted staff can be edited/deleted directly.
export async function updateOrDuplicateTemplate(params: {
  templateId: string;
  changes: Partial<TemplateInput>;
  duplicateTitle?: string;
}) {
  const template = await prisma.contractTemplate.findUniqueOrThrow({
    where: { id: params.templateId },
  });

  if (template.status === "LOCKED") {
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      status: _s,
      parentTemplateId: _p,
      extraItems,
      ...rest
    } = template;
    return prisma.contractTemplate.create({
      data: {
        ...rest,
        extraItems: (extraItems as { label: string; value: string }[] | null) ?? [],
        ...params.changes,
        title: params.duplicateTitle ?? `${template.title}（複製）`,
        parentTemplateId: template.id,
        status: "ACTIVE",
      },
    });
  }

  return prisma.contractTemplate.update({
    where: { id: template.id },
    data: params.changes,
  });
}

export async function deleteTemplate(templateId: string) {
  const count = await countLiveContracts(templateId);
  if (count > 0) throw new Error("template_has_contracted_staff");
  await prisma.contractTemplate.delete({ where: { id: templateId } });
}

// 管理者が契約書を用意する: スタッフが自由にテンプレートを選んで即時契約
// できてしまうと、エリアごとに単価が違うようなケースで誤ったテンプレートを
// 選んでも取り消せない、という事故につながるため、スタッフの自己選択は廃止
// した。契約はここで「確認待ち（PENDING_CONSENT）」として作成し、本人が
// 内容を確認して同意するまではACTIVEにしない（consentStaffContract参照）。
// wageAmountSnapshotは同意時点ではなく生成時点の金額を記録するが、テンプ
// レートは生成と同時にLOCKEDになり以後編集できないため、本人が実際に見て
// 同意する内容と乖離することはない。
export async function startStaffContract(params: { templateId: string; staffUserId: string }) {
  const template = await prisma.contractTemplate.findUniqueOrThrow({ where: { id: params.templateId } });

  const contract = await prisma.staffContract.create({
    data: {
      templateId: template.id,
      staffUserId: params.staffUserId,
      wageAmountSnapshot: template.wageAmount,
      contractStartDate: template.contractStartDate,
      contractEndDate: template.contractEndDate,
      status: "PENDING_CONSENT",
      wageVersions: {
        create: { wageAmount: template.wageAmount, effectiveFrom: template.contractStartDate },
      },
    },
  });

  await recomputeTemplateLock(template.id);
  return contract;
}

// スタッフ本人が確認待ちの契約書の内容を確認し、同意する。ここで初めて
// ACTIVEになり、稼働・給与計算の対象になる（payroll.tsはPENDING_CONSENTの
// 契約を計算に使わない）。
export async function consentStaffContract(params: { staffContractId: string; staffUserId: string }) {
  const contract = await prisma.staffContract.findFirstOrThrow({
    where: { id: params.staffContractId, staffUserId: params.staffUserId, status: "PENDING_CONSENT" },
  });
  return prisma.staffContract.update({
    where: { id: contract.id },
    data: { status: "ACTIVE", consentedAt: new Date() },
  });
}

// ダッシュボードの「契約書を生成」: an admin duplicates a template (pre-filled
// into the same create/edit/preview form used for templates), edits any
// field freely for this one staff member (wage, dates, etc.), and the result
// is saved as its own new ContractTemplate rather than mutating the base one
// — consistent with how editing a LOCKED template already always duplicates.
export async function generateStaffContractFromNewTemplate(params: {
  companyId: string;
  staffUserId: string;
  templateInput: Omit<TemplateInput, "companyId">;
}) {
  const template = await createTemplate({ ...params.templateInput, companyId: params.companyId });
  return startStaffContract({ templateId: template.id, staffUserId: params.staffUserId });
}

// 終了する: 本来の契約終了日より前に手動終了した場合、記録上の契約期間が
// 実態とズレたままにならないよう、終了日を「今日」に前倒しする（元の終了日
// が今日より前ならそのまま。給与計算はcontractEndDateで日付ごとに契約を
// 解決するため、ここがズレると過去分の計算に影響する）。
export async function endStaffContract(params: { staffContractId: string; noticeGivenAt: Date | null }) {
  const existing = await prisma.staffContract.findUniqueOrThrow({ where: { id: params.staffContractId } });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const contractEndDate = existing.contractEndDate && existing.contractEndDate < today ? existing.contractEndDate : today;

  const contract = await prisma.staffContract.update({
    where: { id: params.staffContractId },
    data: { status: "ENDED", noticeGivenAt: params.noticeGivenAt, contractEndDate },
  });
  await recomputeTemplateLock(contract.templateId);
  return contract;
}

// 業務内容単価と同じ「開始日付きバージョンを積む」方式で、指定日時点の
// 金額を1つ選ぶ純粋関数。基本給は「単価未設定」に戻ることが無い（雇用契約に
// は常に何らかの基本給がある）ため、resolveRateVersionと違ってnullマーカー
// の考慮は不要 — 常に最新の該当バージョンを返す。
export function resolveContractWageVersion<T extends { wageAmount: number; effectiveFrom: Date }>(
  versions: T[],
  asOf: Date,
): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom > asOf) continue;
    if (!best || v.effectiveFrom > best.effectiveFrom) best = v;
  }
  return best;
}

// 基本給の改定 — 業務内容単価と同じ「上書きせず開始日付きバージョンを積む
// ＋お知らせ」運用。契約書を結び直す（同意）フローは使わず、指定日から
// 新しい金額が有効になり、スタッフには非ブロッキングのお知らせだけを送る。
// 月給は日単位で変動する意味が薄いため、月初（1日）からの改定のみ許可する。
export async function addStaffContractWageVersion(params: {
  staffContractId: string;
  wageAmount: number;
  effectiveFrom: Date;
  createdByUserId: string;
}) {
  const contract = await prisma.staffContract.findUniqueOrThrow({
    where: { id: params.staffContractId },
    include: { template: true },
  });
  if (contract.template.wageType === "MONTHLY" && params.effectiveFrom.getUTCDate() !== 1) {
    throw new Error("monthly_wage_requires_month_start");
  }
  return prisma.staffContractWageVersion.create({
    data: {
      staffContractId: params.staffContractId,
      wageAmount: params.wageAmount,
      effectiveFrom: params.effectiveFrom,
      createdByUserId: params.createdByUserId,
    },
  });
}

export async function listStaffContracts(staffUserId: string) {
  return prisma.staffContract.findMany({
    where: { staffUserId },
    include: { template: true, wageVersions: true },
    orderBy: { createdAt: "desc" },
  });
}

// 単価は上書きせず、開始日付きのバージョンを積み重ねて履歴として残す
// （編集＝新バージョン追加、終了＝wageType/amountがnullのバージョン追加）。
// この関数はversions配列（effectiveFrom昇順）から、指定日時点で有効な
// バージョンを1つ選ぶ純粋関数 — invoicing.ts / payroll.ts の単価解決で使う。
export function resolveRateVersion<T extends { wageType: WageType | null; amount: number | null; effectiveFrom: Date }>(
  versions: T[],
  asOf: Date,
): { wageType: WageType; amount: number } | null {
  let active: T | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= asOf && (!active || v.effectiveFrom >= active.effectiveFrom)) {
      active = v;
    }
  }
  if (!active || active.wageType === null || active.amount === null) return null;
  return { wageType: active.wageType, amount: active.amount };
}

// 賃金単価/請求単価テーブル — keyed by 配属先（自社=null または取引先）＋業務内容。
export async function listPlacementRates(companyId: string) {
  return prisma.companyPlacementRate.findMany({
    where: { companyId },
    include: { companyRelationship: true, versions: { orderBy: { effectiveFrom: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

// 依頼主単価/スタッフ単価の「＋業務内容を追加」で、自由入力による表記ゆれ
// （キャディ／キャディ業務／Caddie…）を防ぐための候補一覧。実際にシフトで
// 使われた業務名と、既に登録済みの単価表の業務名を統合して返す。
export async function listKnownTaskNames(companyId: string): Promise<string[]> {
  const [shiftNames, placementNames, staffRateNames] = await Promise.all([
    prisma.shift.findMany({
      where: { companyId, taskName: { not: null } },
      select: { taskName: true },
      distinct: ["taskName"],
    }),
    prisma.companyPlacementRate.findMany({ where: { companyId }, select: { taskName: true }, distinct: ["taskName"] }),
    prisma.staffTaskRate.findMany({ where: { companyId }, select: { taskName: true }, distinct: ["taskName"] }),
  ]);
  const names = new Set<string>();
  for (const s of shiftNames) if (s.taskName) names.add(s.taskName);
  for (const p of placementNames) names.add(p.taskName);
  for (const s of staffRateNames) names.add(s.taskName);
  return Array.from(names).sort((a, b) => a.localeCompare(b, "ja"));
}

// 業務内容名だけを登録する（単価は付けない）— シフト作成時のその場追加用。
// companyRelationshipId がnullの複合ユニークキーはPrismaのupsertでは扱えない
// ため、findFirst+create で代用する。
export async function registerPlacementTaskName(params: {
  companyId: string;
  companyRelationshipId?: string;
  taskName: string;
}) {
  const companyRelationshipId = params.companyRelationshipId || null;
  const existing = await prisma.companyPlacementRate.findFirst({
    where: {
      companyId: params.companyId,
      companyRelationshipId,
      taskName: params.taskName,
    },
  });
  if (existing) return existing;
  return prisma.companyPlacementRate.create({
    data: { companyId: params.companyId, companyRelationshipId, taskName: params.taskName },
  });
}

// 新しい単価バージョンを追加する（既存の単価を上書きしない）。
export async function addPlacementRateVersion(params: {
  companyId: string;
  companyRelationshipId?: string;
  taskName: string;
  wageType: WageType;
  amount: number;
  effectiveFrom: Date;
  createdByUserId: string;
}) {
  const rate = await registerPlacementTaskName({
    companyId: params.companyId,
    companyRelationshipId: params.companyRelationshipId,
    taskName: params.taskName,
  });
  return prisma.companyPlacementRateVersion.create({
    data: {
      placementRateId: rate.id,
      wageType: params.wageType,
      amount: params.amount,
      effectiveFrom: params.effectiveFrom,
      createdByUserId: params.createdByUserId,
    },
  });
}

// 承認済みの実績シフト（出勤した・承認済み）でこの単価が実際に参照されて
// いるかどうか。使用済みの単価は削除できない（過去の給与/請求計算の根拠を
// 壊さないため）。未使用なら、単価をいくつ積んでいても削除してよい
// （「終了する」機能は廃止 — 使わなくなった単価はそのまま放置すればよく、
// 一度も使われていないものだけ間違い登録の取消しとして削除できれば十分）。
export async function isPlacementRateUsed(placementRateId: string): Promise<boolean> {
  const rate = await prisma.companyPlacementRate.findUniqueOrThrow({ where: { id: placementRateId } });
  // 自社(companyRelationshipId=null)向けの登録は請求計算(CLIENTシフトのみ
  // 対象)からは参照されないため、常に未使用扱いでよい。
  if (!rate.companyRelationshipId) return false;
  const shifts = await prisma.shift.findMany({
    where: {
      companyId: rate.companyId,
      companyRelationshipId: rate.companyRelationshipId,
      source: "CLIENT",
      status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    },
    include: { workReport: true },
  });
  return shifts.some((s) => {
    if (!s.workReport || s.workReport.outcome !== "WORKED" || s.workReport.approvalStatus !== "APPROVED") return false;
    const effectiveTaskName = s.workReport.taskName ?? s.taskName;
    return effectiveTaskName === rate.taskName;
  });
}

export async function deletePlacementTaskName(id: string) {
  if (await isPlacementRateUsed(id)) throw new Error("rate_in_use");
  return prisma.companyPlacementRate.delete({ where: { id } });
}

// 給与単価テーブル（スタッフ×業務内容×勤務先）— keyed by staffUserId + taskName
// + companyRelationshipId（null＝勤務先を問わない、自社を含む）。
export async function listStaffTaskRates(companyId: string) {
  return prisma.staffTaskRate.findMany({
    where: { companyId },
    include: { versions: { orderBy: { effectiveFrom: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

// シフトの勤務先(companyRelationshipId)に一致する行を優先し、無ければ
// companyRelationshipId=null（勤務先を問わない）の行にフォールバックする。
export function pickStaffTaskRate<T extends { companyRelationshipId: string | null }>(
  rows: T[],
  shiftCompanyRelationshipId: string | null,
): T | null {
  const exact = rows.find((r) => r.companyRelationshipId === shiftCompanyRelationshipId);
  if (exact) return exact;
  if (shiftCompanyRelationshipId !== null) {
    const general = rows.find((r) => r.companyRelationshipId === null);
    if (general) return general;
  }
  return null;
}

// 業務内容名だけを登録する（単価は付けない）— 業務報告での新規追加など、
// その場登録用。companyRelationshipId がnullの複合ユニークキーはPrismaの
// upsertでは扱えないため、findFirst+create で代用する
// （registerPlacementTaskNameと同じ理由）。
export async function registerStaffTaskName(params: {
  companyId: string;
  staffUserId: string;
  taskName: string;
  companyRelationshipId?: string;
}) {
  const existing = await prisma.staffTaskRate.findFirst({
    where: {
      companyId: params.companyId,
      staffUserId: params.staffUserId,
      taskName: params.taskName,
      companyRelationshipId: params.companyRelationshipId ?? null,
    },
  });
  if (existing) return existing;
  return prisma.staffTaskRate.create({
    data: {
      companyId: params.companyId,
      staffUserId: params.staffUserId,
      taskName: params.taskName,
      companyRelationshipId: params.companyRelationshipId,
    },
  });
}

export async function addStaffTaskRateVersion(params: {
  companyId: string;
  staffUserId: string;
  taskName: string;
  companyRelationshipId?: string;
  wageType: WageType;
  amount: number;
  effectiveFrom: Date;
  createdByUserId: string;
}) {
  const rate = await registerStaffTaskName({
    companyId: params.companyId,
    staffUserId: params.staffUserId,
    taskName: params.taskName,
    companyRelationshipId: params.companyRelationshipId,
  });
  return prisma.staffTaskRateVersion.create({
    data: {
      staffTaskRateId: rate.id,
      wageType: params.wageType,
      amount: params.amount,
      effectiveFrom: params.effectiveFrom,
      createdByUserId: params.createdByUserId,
    },
  });
}

// 承認済みの実績シフト（出勤した・承認済み）でこの単価が実際に参照されて
// いるか（pickStaffTaskRateの解決結果がこの行と一致するか）を判定する。
// 使用済みなら削除不可、未使用ならいつでも削除できる（「終了する」機能は
// 廃止 — 使わなくなった単価はそのまま放置すればよい）。
export async function isStaffTaskRateUsed(staffTaskRateId: string): Promise<boolean> {
  const rate = await prisma.staffTaskRate.findUniqueOrThrow({ where: { id: staffTaskRateId } });
  const siblings = await prisma.staffTaskRate.findMany({
    where: { companyId: rate.companyId, staffUserId: rate.staffUserId, taskName: rate.taskName },
  });
  const shifts = await prisma.shift.findMany({
    where: {
      companyId: rate.companyId,
      staffUserId: rate.staffUserId,
      status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    },
    include: { workReport: true },
  });
  return shifts.some((s) => {
    if (!s.workReport || s.workReport.outcome !== "WORKED" || s.workReport.approvalStatus !== "APPROVED") return false;
    const effectiveTaskName = s.workReport.taskName ?? s.taskName;
    if (effectiveTaskName !== rate.taskName) return false;
    return pickStaffTaskRate(siblings, s.companyRelationshipId)?.id === rate.id;
  });
}

export async function deleteStaffTaskRate(id: string) {
  if (await isStaffTaskRateUsed(id)) throw new Error("rate_in_use");
  return prisma.staffTaskRate.delete({ where: { id } });
}
