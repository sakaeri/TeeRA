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
    include: { staffContracts: { include: { staff: true } }, companyRelationship: true },
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

async function recomputeTemplateLock(templateId: string) {
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
      status: "ACTIVE",
      consentedAt: new Date(),
    },
  });

  await recomputeTemplateLock(template.id);
  return contract;
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

// 賃金単価/請求単価テーブル — keyed by 配属先（自社=null または取引先）＋業務内容.
export async function listPlacementRates(companyId: string) {
  return prisma.companyPlacementRate.findMany({
    where: { companyId },
    include: { companyRelationship: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function upsertPlacementRate(params: {
  companyId: string;
  companyRelationshipId?: string;
  taskName: string;
  wageType: WageType;
  amount: number;
}) {
  const existing = await prisma.companyPlacementRate.findFirst({
    where: {
      companyId: params.companyId,
      companyRelationshipId: params.companyRelationshipId ?? null,
      taskName: params.taskName,
    },
  });

  if (existing) {
    return prisma.companyPlacementRate.update({
      where: { id: existing.id },
      data: { wageType: params.wageType, amount: params.amount },
    });
  }

  return prisma.companyPlacementRate.create({
    data: {
      companyId: params.companyId,
      companyRelationshipId: params.companyRelationshipId,
      taskName: params.taskName,
      wageType: params.wageType,
      amount: params.amount,
    },
  });
}

export async function deletePlacementRate(id: string) {
  return prisma.companyPlacementRate.delete({ where: { id } });
}
