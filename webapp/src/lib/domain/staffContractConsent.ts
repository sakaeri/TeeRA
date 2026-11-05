import "server-only";
import { prisma } from "@/lib/prisma";
import { listStaffContracts } from "@/lib/domain/contracts";

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};

type StaffContractRow = Awaited<ReturnType<typeof listStaffContracts>>[number];

// 契約一覧の見出しは、管理用のテンプレート名ではなく「雇用形態・業務内容」
// から機械的に生成する（会社側roster.tsのcontractDisplayTitleと同じ考え方）。
export function contractDisplayTitle(employmentType: string, jobDescription: string) {
  const label = EMPLOYMENT_TYPE_LABEL[employmentType] ?? employmentType;
  return jobDescription ? `${label}・${jobDescription}` : label;
}

// 契約書の全文表示（TemplateModal）に渡す形。契約中・過去分・確認待ちで共通
export function buildTemplateDetail(c: StaffContractRow) {
  return {
    id: c.template.id,
    title: c.template.title,
    employmentType: c.template.employmentType,
    workplaceType: c.template.workplaceType,
    workplaceNote: c.template.workplaceNote,
    clientName: null,
    jobDescription: c.template.jobDescription,
    scheduleType: c.template.scheduleType,
    workStartTime: c.template.workStartTime,
    workEndTime: c.template.workEndTime,
    actualWorkMinutes: c.template.actualWorkMinutes,
    breakMinutes: c.template.breakMinutes,
    hasOvertime: c.template.hasOvertime,
    requireIdDocument: c.template.requireIdDocument,
    requireBankInfo: c.template.requireBankInfo,
    overtimeNote: c.template.overtimeNote,
    fixedWeekdays: c.template.fixedWeekdays,
    shiftPatternNote: c.template.shiftPatternNote,
    restNote: c.template.restNote,
    wageType: c.template.wageType,
    wageAmount: c.wageAmountSnapshot,
    paymentClosingDay: c.template.paymentClosingDay,
    paymentDay: c.template.paymentDay,
    paymentMethod: c.template.paymentMethod,
    contractPeriodType: c.template.contractPeriodType,
    contractStartDate: (c.contractStartDate ?? c.template.contractStartDate).toISOString().slice(0, 10),
    contractEndDate: (c.contractEndDate ?? c.template.contractEndDate)?.toISOString().slice(0, 10) ?? null,
    extraItems: (c.template.extraItems as { label: string; value: string }[] | null) ?? [],
    status: c.template.status,
    contractedStaffNames: [] as string[],
  };
}

// 確認待ちの契約書を、その場で確認・同意してもらうためのデータ一式
// （契約書の全文・提出済みの身分証・振込先・住所・電話番号）。所属していなければnull
export async function loadPendingContractConsent(userId: string, companyId: string) {
  const membership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
    include: { user: true, company: { select: { name: true } } },
  });
  if (!membership) return null;
  const contracts = (await listStaffContracts(userId, companyId)).filter((c) => c.status === "PENDING_CONSENT");
  return {
    companyId,
    companyName: membership.company.name,
    myName: membership.user.name,
    address: membership.user.address ?? "",
    phoneNumber: membership.user.phoneNumber ?? "",
    idDocumentFrontUrl: membership.idDocumentFrontUrl ?? "",
    idDocumentBackUrl: membership.idDocumentBackUrl ?? "",
    bankInfo: {
      bankName: membership.bankName ?? "",
      branchName: membership.branchName ?? "",
      accountType: membership.accountType ?? "",
      accountNumber: membership.accountNumber ?? "",
      accountHolderName: membership.accountHolderName ?? "",
    },
    contracts: contracts.map((c) => ({
      id: c.id,
      title: contractDisplayTitle(c.template.employmentType, c.template.jobDescription),
      templateDetail: buildTemplateDetail(c),
      requireIdDocument: c.template.requireIdDocument,
      requireBankInfo: c.template.requireBankInfo,
    })),
  };
}

export type PendingContractConsentData = NonNullable<Awaited<ReturnType<typeof loadPendingContractConsent>>>;
