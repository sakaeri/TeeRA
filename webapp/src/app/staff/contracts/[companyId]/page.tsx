import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listStaffContracts, listStaffTaskRatesForStaff, resolveContractWageVersion, resolveRateVersion } from "@/lib/domain/contracts";
import { listClients } from "@/lib/domain/relationships";
import { todayJst } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { StaffContractsView } from "@/components/staff/StaffContractsView";

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };
const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};

export default async function StaffCompanyContractsPage({ params }: PageProps<"/staff/contracts/[companyId]">) {
  const { userId } = await requireCompanyStaffRole();
  const { companyId } = await params;

  // 兼務(role≠STAFF)ケースもあるため、roleでは絞らずuserId+companyIdの
  // 一意な組み合わせで所属を確認する。
  const myMembership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId, companyId } },
  });
  if (!myMembership) notFound();

  const [allContracts, company, taskRates, clientRelationships, myPlacements] = await Promise.all([
    listStaffContracts(userId, companyId),
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    listStaffTaskRatesForStaff(companyId, userId),
    listClients(companyId),
    prisma.staffPlacement.findMany({
      where: { staffUserId: userId, active: true, companyRelationship: { agencyCompanyId: companyId, status: "ACTIVE" } },
      select: { companyRelationshipId: true },
    }),
  ]);

  const today = new Date();
  const rateToday = new Date(`${todayJst()}T23:59:59.999Z`);
  const myContracts = allContracts.filter((c) => c.status !== "PENDING_CONSENT");
  const pendingContracts = allContracts.filter((c) => c.status === "PENDING_CONSENT");
  // 配属先一覧はこの会社とつながっている依頼主全部ではなく、本人が実際に
  // 配属記録(StaffPlacement)を持つ依頼主だけを参考情報として出す
  // (依頼主が正式なCompanyアカウントと連携する前の仮登録＝proxyNameの
  // 段階でも配属自体はあり得るため、clientCompanyIdではなく
  // companyRelationshipIdで突き合わせる)。
  const placedRelationshipIds = new Set(myPlacements.map((p) => p.companyRelationshipId));
  const clientNames = clientRelationships
    .filter((r) => r.status === "ACTIVE" && placedRelationshipIds.has(r.id))
    .map((r) => r.clientCompany?.name ?? r.proxyName ?? "取引先");

  const activeContract = allContracts.find((c) => c.status === "ACTIVE") ?? null;
  const baseWage = activeContract
    ? {
        employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[activeContract.template.employmentType] ?? activeContract.template.employmentType,
        jobDescription: activeContract.template.jobDescription,
        currentLabel: `${WAGE_TYPE_LABEL[activeContract.template.wageType]}${
          resolveContractWageVersion(activeContract.wageVersions, today)?.wageAmount ?? activeContract.wageAmountSnapshot
        }円`,
        versions: activeContract.wageVersions.map((v) => ({
          id: v.id,
          label: `${WAGE_TYPE_LABEL[activeContract.template.wageType]}${v.wageAmount}円`,
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
        })),
      }
    : null;

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
        baseWage={baseWage}
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
