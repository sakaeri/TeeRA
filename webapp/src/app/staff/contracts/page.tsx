import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listStaffContracts, resolveContractWageVersion } from "@/lib/domain/contracts";
import { prisma } from "@/lib/prisma";
import { StaffContractsView } from "@/components/staff/StaffContractsView";

export default async function StaffContractsPage() {
  const { userId, membership } = await requireCompanyStaffRole();

  const [allContracts, myMembership, company] = await Promise.all([
    listStaffContracts(userId, membership.companyId),
    prisma.companyMembership.findFirstOrThrow({
      where: { userId, companyId: membership.companyId, role: "STAFF" },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const today = new Date();
  const myContracts = allContracts.filter((c) => c.status !== "PENDING_CONSENT");
  const pendingContracts = allContracts.filter((c) => c.status === "PENDING_CONSENT");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">所属先設定・雇用契約書</h1>
      <StaffContractsView
        companyName={company.name}
        myContracts={myContracts.map((c) => ({
          id: c.id,
          title: c.template.title,
          status: c.status,
          wageAmountSnapshot: resolveContractWageVersion(c.wageVersions, today)?.wageAmount ?? c.wageAmountSnapshot,
          wageType: c.template.wageType,
          contractStartDate: (c.contractStartDate ?? c.template.contractStartDate).toISOString().slice(0, 10),
        }))}
        pendingContracts={pendingContracts.map((c) => ({
          id: c.id,
          templateDetail: {
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
          },
        }))}
        idDocumentFrontUrl={myMembership.idDocumentFrontUrl}
        idDocumentBackUrl={myMembership.idDocumentBackUrl}
        bankInfo={{
          bankName: myMembership.bankName ?? "",
          branchName: myMembership.branchName ?? "",
          accountType: myMembership.accountType ?? "",
          accountNumber: myMembership.accountNumber ?? "",
          accountHolderName: myMembership.accountHolderName ?? "",
        }}
      />
    </main>
  );
}
