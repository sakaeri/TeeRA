import { redirect } from "next/navigation";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { isCompanyScopeAdmin, isLeaderOnly, myManagedOrLedTeamIds } from "@/lib/auth/permissions";
import { listStaffWithSummary } from "@/lib/domain/roster";
import { listClients, listAgencies, countMonthlyShiftsByRelationship } from "@/lib/domain/relationships";
import { listTeams } from "@/lib/domain/teams";
import { listTemplates, listUploadOnlyTemplates, listKnownTaskNames } from "@/lib/domain/contracts";
import { RosterView } from "@/components/company/RosterView";
import { prisma } from "@/lib/prisma";

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};
const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

export default async function RosterPage({ searchParams }: PageProps<"/company/roster">) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (isLeaderOnly(membership)) redirect("/company/calendar");
  const sp = await searchParams;
  const initialStaffId = typeof sp.staff === "string" ? sp.staff : undefined;
  const initialStaffTab = sp.tab === "contracts" ? ("contracts" as const) : undefined;
  // ホームの「よく使う操作」から、追加メニュー・招待を開いた状態で来る
  const initialTab = sp.tab === "clients" || sp.tab === "agencies" ? sp.tab : undefined;
  const initialAddMenu = sp.add === "1";
  const initialInviteStaff = sp.invite === "staff";

  // 本部管理者/編集者以外（チームマネージャー/リーダー）には、自分が
  // 管轄するチームに所属するスタッフ・依頼主・派遣会社だけを見せる
  // （無関係な他チームの情報が邪魔にならないように）。
  const restrictToTeamIds = isCompanyScopeAdmin(membership) ? undefined : myManagedOrLedTeamIds(membership);

  // 依頼主一覧/派遣会社一覧タブは常時表示する（スタッフ一覧と同じく、0件でも
  // 「追加する」ボタン付きの空状態を出す）ので、agencyEnabled/dispatchEnabled
  // に関わらず常に取得する。
  const [staff, clients, agencies, teams, templates, uploadOnlyTemplates, knownTaskNames, company] = await Promise.all([
    listStaffWithSummary(membership.companyId, restrictToTeamIds),
    listClients(membership.companyId, restrictToTeamIds),
    listAgencies(membership.companyId, restrictToTeamIds),
    listTeams(membership.companyId),
    listTemplates(membership.companyId),
    listUploadOnlyTemplates(membership.companyId),
    listKnownTaskNames(membership.companyId),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const monthlyShiftCounts = await countMonthlyShiftsByRelationship(
    membership.companyId,
    [...clients.map((c) => c.id), ...agencies.filter((a) => a.agencyCompany).map((a) => a.id)],
    agencies.filter((a) => !a.agencyCompany).map((a) => a.id),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <RosterView
        staff={staff}
        companyName={company.name}
        initialStaffId={initialStaffId}
        initialStaffTab={initialStaffTab}
        initialTab={initialTab}
        initialAddMenu={initialAddMenu}
        initialInviteStaff={initialInviteStaff}
        knownTaskNames={knownTaskNames}
        clients={clients.map((c) => ({
          id: c.id,
          name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)",
          isProxy: !c.clientCompany,
          staffCount: c._count.staffPlacements,
          monthlyShiftCount: monthlyShiftCounts.get(c.id) ?? 0,
          teams: c.teamLinks.map((l) => ({ id: l.team.id, name: l.team.name })),
        }))}
        agencies={agencies.map((a) => ({
          id: a.id,
          name: a.agencyCompany?.name ?? a.proxyName ?? "(名称未設定)",
          isProxy: !a.agencyCompany,
          // プロキシ（実体の無い）派遣会社はStaffPlacementが作られないため、
          // 所属タグ付けされたスタッフ数（membershipsViaAgency）で数える。
          staffCount: a.agencyCompany ? a._count.staffPlacements : a._count.membershipsViaAgency,
          monthlyShiftCount: monthlyShiftCounts.get(a.id) ?? 0,
          teams: a.teamLinks.map((l) => ({ id: l.team.id, name: l.team.name })),
        }))}
        teams={teams
          .filter((t) => !restrictToTeamIds || restrictToTeamIds.includes(t.id))
          .map((t) => ({ id: t.id, name: t.name }))}
        isCompanyScopeAdmin={isCompanyScopeAdmin(membership)}
        myManagedTeams={membership.teamMemberships
          .filter((tm) => tm.role === "TEAM_MANAGER")
          .map((tm) => ({ id: tm.teamId, name: tm.teamName }))}
        templates={templates
          .filter((t) => t.status !== "ARCHIVED" && !t.isUploadOnly)
          .map((t) => ({
            id: t.id,
            title: t.title,
            employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[t.employmentType] ?? t.employmentType,
            wageLabel: `${WAGE_TYPE_LABEL[t.wageType]}${t.wageAmount}円`,
            workplaceName:
              t.workplaceType === "CLIENT"
                ? (t.workplaceNote ?? t.companyRelationship?.clientCompany?.name ?? t.companyRelationship?.proxyName ?? "配属先")
                : "自社",
            contractStartDate: t.contractStartDate.toISOString().slice(0, 10),
          }))}
        contractTemplates={templates
          // LOCKED（既に誰か契約中）でも「そのまま契約する」で複数人に
          // 割り当てられるようにするため、ARCHIVED以外は選択肢に含める。
          // isUploadOnlyの軽量テンプレは通常の生成フローの選択肢には出さない。
          .filter((t) => t.status !== "ARCHIVED" && !t.isUploadOnly)
          .map((t) => ({
            id: t.id,
            title: t.title,
            employmentType: t.employmentType,
            workplaceType: t.workplaceType,
            workplaceNote: t.workplaceNote,
            clientName: t.workplaceNote ?? t.companyRelationship?.clientCompany?.name ?? t.companyRelationship?.proxyName ?? null,
            jobDescription: t.jobDescription,
            scheduleType: t.scheduleType,
            workStartTime: t.workStartTime,
            workEndTime: t.workEndTime,
            actualWorkMinutes: t.actualWorkMinutes,
            breakMinutes: t.breakMinutes,
            hasOvertime: t.hasOvertime,
            overtimeNote: t.overtimeNote,
            fixedWeekdays: t.fixedWeekdays,
            shiftPatternNote: t.shiftPatternNote,
            restNote: t.restNote,
            wageType: t.wageType,
            wageAmount: t.wageAmount,
            paymentClosingDay: t.paymentClosingDay,
            paymentDay: t.paymentDay,
            paymentMethod: t.paymentMethod,
            contractPeriodType: t.contractPeriodType,
            contractStartDate: t.contractStartDate.toISOString().slice(0, 10),
            contractEndDate: t.contractEndDate ? t.contractEndDate.toISOString().slice(0, 10) : null,
            extraItems: (t.extraItems as { label: string; value: string }[] | null) ?? [],
            status: t.status,
            contractedStaffNames: t.staffContracts.filter((sc) => sc.status !== "ENDED").map((sc) => sc.staff.name),
          }))}
        uploadOnlyTemplates={uploadOnlyTemplates.map((t) => ({
          id: t.id,
          title: t.title,
          employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[t.employmentType] ?? t.employmentType,
          jobDescription: t.jobDescription,
          wageLabel: `${WAGE_TYPE_LABEL[t.wageType]}${t.wageAmount}円`,
          contractStartDate: t.contractStartDate.toISOString().slice(0, 10),
        }))}
      />
    </main>
  );
}
