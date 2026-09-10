import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listStaffContracts, listStaffTaskRatesForStaff, resolveContractWageVersion, resolveRateVersion } from "@/lib/domain/contracts";
import { listClients } from "@/lib/domain/relationships";
import { todayJst } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { StaffContractsView } from "@/components/staff/StaffContractsView";

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

export default async function StaffCompanyContractsPage({ params }: PageProps<"/staff/contracts/[companyId]">) {
  const { userId } = await requireCompanyStaffRole();
  const { companyId } = await params;

  // 兼務(role≠STAFF)ケースもあるため、roleでは絞らずuserId+companyIdの
  // 一意な組み合わせで所属を確認する。
  const myMembership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!myMembership) notFound();

  const [allContracts, company, taskRates, clientRelationships] = await Promise.all([
    listStaffContracts(userId, companyId),
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    listStaffTaskRatesForStaff(companyId, userId),
    listClients(companyId),
  ]);

  const today = new Date();
  const rateToday = new Date(`${todayJst()}T23:59:59.999Z`);
  const myContracts = allContracts.filter((c) => c.status !== "PENDING_CONSENT");
  const pendingContracts = allContracts.filter((c) => c.status === "PENDING_CONSENT");
  const clientNames = clientRelationships
    .filter((r) => r.status === "ACTIVE")
    .map((r) => r.clientCompany?.name ?? r.proxyName ?? "取引先");

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href="/staff/contracts" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-primary">
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        所属先一覧に戻る
      </Link>
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">{company.name}</h1>
      <StaffContractsView
        companyId={companyId}
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
        taskRates={taskRates.map((r) => {
          const current = resolveRateVersion(r.versions, rateToday);
          return {
            id: r.id,
            taskName: r.taskName,
            workplaceLabel: r.companyRelationshipId
              ? (r.companyRelationship?.clientCompany?.name ?? "取引先")
              : "勤務先問わず",
            currentLabel: current ? `${WAGE_TYPE_LABEL[current.wageType]}${current.amount}円` : "単価未設定",
            versions: r.versions.map((v) => ({
              id: v.id,
              label: v.wageType && v.amount != null ? `${WAGE_TYPE_LABEL[v.wageType]}${v.amount}円` : "単価未設定（終了）",
              effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
            })),
          };
        })}
        clientNames={clientNames}
      />
    </main>
  );
}
