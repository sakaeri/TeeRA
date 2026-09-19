import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyStaffRole } from "@/lib/auth/session";
import {
  listStaffContracts,
  listStaffTaskRatesForStaff,
  resolveContractWageVersion,
  resolveRateVersion,
  excludeBaselineVersion,
} from "@/lib/domain/contracts";
import { listClients, listStaffVisibleRelationshipNotes } from "@/lib/domain/relationships";
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

// 契約一覧の見出しは、管理用のテンプレート名ではなく「雇用形態・業務内容」
// から機械的に生成する（会社側roster.tsのcontractDisplayTitleと同じ考え方）。
function contractDisplayTitle(employmentType: string, jobDescription: string) {
  const label = EMPLOYMENT_TYPE_LABEL[employmentType] ?? employmentType;
  return jobDescription ? `${label}・${jobDescription}` : label;
}

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

  // 業務単価の「勤務先」見出しから開く詳細（勤務地・緊急連絡先・共有メモ）
  // 用のデータを組み立てる。個別単価が設定されている勤務先だけでなく、
  // 配属記録(StaffPlacement)がある勤務先も対象にする — 配属はされていても
  // 個別単価までは設定していない（基本給・勤務先問わずの単価で運用）
  // ケースが普通にあるため、単価の有無だけで絞ると配属先が一覧から
  // 消えてしまう。
  const relationshipInfoById = new Map(
    clientRelationships.map((r) => [
      r.id,
      { name: r.clientCompany?.name ?? r.proxyName ?? "取引先", workLocation: r.workLocation, emergencyContact: r.emergencyContact },
    ]),
  );
  const myWorkplaceRelationshipIds = Array.from(
    new Set([
      ...taskRates.map((r) => r.companyRelationshipId).filter((id): id is string => id !== null),
      ...myPlacements.map((p) => p.companyRelationshipId),
    ]),
  );
  const workplaceNotesById = new Map(
    await Promise.all(
      myWorkplaceRelationshipIds.map(
        async (id) => [id, await listStaffVisibleRelationshipNotes(id, companyId)] as const,
      ),
    ),
  );
  const workplaces = myWorkplaceRelationshipIds
    .map((id) => {
      const info = relationshipInfoById.get(id);
      if (!info) return null;
      return {
        companyRelationshipId: id,
        name: info.name,
        workLocation: info.workLocation,
        emergencyContact: info.emergencyContact,
        notes: workplaceNotesById.get(id) ?? [],
      };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null);

  const activeContract = allContracts.find((c) => c.status === "ACTIVE") ?? null;
  const baseWage = activeContract
    ? {
        employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[activeContract.template.employmentType] ?? activeContract.template.employmentType,
        jobDescription: activeContract.template.jobDescription,
        currentLabel: `${WAGE_TYPE_LABEL[activeContract.template.wageType]}${
          resolveContractWageVersion(activeContract.wageVersions, today)?.wageAmount ?? activeContract.wageAmountSnapshot
        }円`,
        versions: excludeBaselineVersion(activeContract.wageVersions).map((v) => ({
          id: v.id,
          label: `${WAGE_TYPE_LABEL[activeContract.template.wageType]}${v.wageAmount}円`,
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
        })),
      }
    : null;

  // 契約中・過去分も同意前と同じ全文閲覧モーダルをいつでも開けるよう、
  // pendingContractsと同じTemplate形のtemplateDetailを両方に持たせる。
  function buildTemplateDetail(c: (typeof allContracts)[number]) {
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
          title: contractDisplayTitle(c.template.employmentType, c.template.jobDescription),
          status: c.status,
          wageAmountSnapshot: resolveContractWageVersion(c.wageVersions, today)?.wageAmount ?? c.wageAmountSnapshot,
          wageType: c.template.wageType,
          contractStartDate: (c.contractStartDate ?? c.template.contractStartDate).toISOString().slice(0, 10),
          templateDetail: buildTemplateDetail(c),
        }))}
        pendingContracts={pendingContracts.map((c) => ({
          id: c.id,
          title: contractDisplayTitle(c.template.employmentType, c.template.jobDescription),
          templateDetail: buildTemplateDetail(c),
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
            companyRelationshipId: r.companyRelationshipId,
            workplaceLabel: r.companyRelationshipId
              ? (r.companyRelationship?.clientCompany?.name ?? r.companyRelationship?.proxyName ?? "取引先")
              : "勤務先問わず",
            currentLabel: current ? `${WAGE_TYPE_LABEL[current.wageType]}${current.amount}円` : "単価未設定",
            versions: excludeBaselineVersion(r.versions).map((v) => ({
              id: v.id,
              label: v.wageType && v.amount != null ? `${WAGE_TYPE_LABEL[v.wageType]}${v.amount}円` : "単価未設定（終了）",
              effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
            })),
          };
        })}
        workplaces={workplaces}
      />
    </main>
  );
}
