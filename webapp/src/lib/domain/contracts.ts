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

// 契約を結ぶ: for v1 this collapses "publish" and "承諾する" into one action
// (the prototype's preview -> optional hand-edit -> publish -> consent
// sequence). The wage amount is snapshotted at the moment of consent so a
// later rate change can be detected — but since a LOCKED template can never
// be mutated in place, changing pay for already-contracted staff always goes
// through duplicate-and-re-consent, not a silent amount change underneath.
export async function startStaffContract(params: { templateId: string; staffUserId: string }) {
  const template = await prisma.contractTemplate.findUniqueOrThrow({ where: { id: params.templateId } });

  const contract = await prisma.staffContract.create({
    data: {
      templateId: template.id,
      staffUserId: params.staffUserId,
      wageAmountSnapshot: template.wageAmount,
      contractStartDate: template.contractStartDate,
      contractEndDate: template.contractEndDate,
      status: "ACTIVE",
      consentedAt: new Date(),
    },
  });

  await recomputeTemplateLock(template.id);
  return contract;
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

export async function endStaffContract(staffContractId: string) {
  const contract = await prisma.staffContract.update({
    where: { id: staffContractId },
    data: { status: "ENDED" },
  });
  await recomputeTemplateLock(contract.templateId);
  return contract;
}

export async function listStaffContracts(staffUserId: string) {
  return prisma.staffContract.findMany({
    where: { staffUserId },
    include: { template: true },
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
  const existing = await prisma.companyPlacementRate.findFirst({
    where: {
      companyId: params.companyId,
      companyRelationshipId: params.companyRelationshipId ?? null,
      taskName: params.taskName,
    },
  });
  if (existing) return existing;
  return prisma.companyPlacementRate.create({
    data: { companyId: params.companyId, companyRelationshipId: params.companyRelationshipId, taskName: params.taskName },
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

// 単価を終了する（指定日から単価未設定に戻す）。履歴は消さず残る。
export async function endPlacementRate(params: {
  placementRateId: string;
  effectiveFrom: Date;
  createdByUserId: string;
}) {
  return prisma.companyPlacementRateVersion.create({
    data: {
      placementRateId: params.placementRateId,
      wageType: null,
      amount: null,
      effectiveFrom: params.effectiveFrom,
      createdByUserId: params.createdByUserId,
    },
  });
}

// バージョンが1つも無い（＝一度も単価が設定されたことがない）業務内容の登録だけを取り消す。
export async function deleteUnpricedPlacementTaskName(id: string) {
  const rate = await prisma.companyPlacementRate.findUniqueOrThrow({
    where: { id },
    include: { versions: true },
  });
  if (rate.versions.length > 0) throw new Error("has_rate_history");
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

// 単価を終了する（指定日から雇用契約の基本単価にフォールバックする状態に戻す）。
export async function endStaffTaskRate(params: {
  staffTaskRateId: string;
  effectiveFrom: Date;
  createdByUserId: string;
}) {
  return prisma.staffTaskRateVersion.create({
    data: {
      staffTaskRateId: params.staffTaskRateId,
      wageType: null,
      amount: null,
      effectiveFrom: params.effectiveFrom,
      createdByUserId: params.createdByUserId,
    },
  });
}
