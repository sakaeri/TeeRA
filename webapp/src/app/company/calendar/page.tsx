import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { reportDisplay } from "@/lib/workReportDisplay";
import { listShiftsForMonth, listShiftRequests, listShiftHistoryForMonth } from "@/lib/domain/shifts";
import { isCompanyScopeAdmin, myManagedOrLedTeamIds } from "@/lib/auth/permissions";
import {
  listPublicRecruitments,
  listClientRecruitments,
  affordableMaxEntries,
  resolveStaffOrigins,
  settlePastRecruitments,
} from "@/lib/domain/recruitment";
import { listStaff } from "@/lib/domain/roster";
import { listTeams } from "@/lib/domain/teams";
import { listClients, listAgencies, listAssignableAgencyStaff } from "@/lib/domain/relationships";
import { listPlacementRates, listPastTaskNamesForRelationship } from "@/lib/domain/contracts";
import { prisma } from "@/lib/prisma";
import { todayJstParts, earliestAllowedMonth, isBeforeCutoff } from "@/lib/date";
import { CalendarView } from "@/components/company/CalendarView";
import { redirect } from "next/navigation";

export default async function CompanyCalendarPage({
  searchParams,
}: PageProps<"/company/calendar">) {
  const { membership } = await requireCompanyAdminOrEditor();
  const sp = await searchParams;

  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });
  const historyCutoff = earliestAllowedMonth(company.planTier);

  const today = todayJstParts();
  const dateParam = typeof sp.date === "string" && sp.date ? sp.date : undefined;
  const [dateYear, dateMonth] = dateParam ? dateParam.split("-").map(Number) : [];
  const year = Number(sp.y) || dateYear || today.year;
  const month = Number(sp.m) || dateMonth || today.month;
  const relationshipId = typeof sp.rel === "string" && sp.rel ? sp.rel : undefined;

  if (isBeforeCutoff(year, month, historyCutoff)) {
    const params = new URLSearchParams({ y: String(historyCutoff!.year), m: String(historyCutoff!.month) });
    if (typeof sp.team === "string" && sp.team) params.set("team", sp.team);
    if (typeof sp.rel === "string" && sp.rel) params.set("rel", sp.rel);
    redirect(`/company/calendar?${params.toString()}`);
  }

  // 会社スコープの管理者/編集者は全社のシフトを見られる。チームマネージャー/
  // リーダーは自分が所属するチームのシフトしか見えない — sp.teamは「その中で
  // さらに1チームに絞る」ための任意フィルターであり、所属外のチームIDが来ても
  // 無視する（restrictToTeamIdsで最終的にDB側でも弾かれる）。
  const isAdmin = isCompanyScopeAdmin(membership);
  const myTeamIds = myManagedOrLedTeamIds(membership);
  const requestedTeamId = typeof sp.team === "string" && sp.team ? sp.team : undefined;
  const teamId = isAdmin || (requestedTeamId && myTeamIds.includes(requestedTeamId)) ? requestedTeamId : undefined;
  const restrictToTeamIds = isAdmin ? undefined : myTeamIds;

  // 過去日になっても埋まらなかった公開募集の枠を、このページを開いた
  // タイミングで自動精算する（未使用分のTeeを返金）— 以降のlistPublic
  // Recruitmentsに結果を反映させるため、Promise.allより前に完了させる。
  await settlePastRecruitments(membership.companyId);

  const [shifts, shiftHistory, staff, teams, shiftRequests, recruitments, clientRecruitments] = await Promise.all([
    listShiftsForMonth({ companyId: membership.companyId, year, month, teamId, restrictToTeamIds, companyRelationshipId: relationshipId }),
    listShiftHistoryForMonth({ companyId: membership.companyId, year, month, teamId, restrictToTeamIds }),
    listStaff(membership.companyId, restrictToTeamIds),
    listTeams(membership.companyId),
    listShiftRequests({ companyId: membership.companyId, status: "PENDING" }),
    listPublicRecruitments({ companyId: membership.companyId }),
    listClientRecruitments(membership.companyId),
  ]);

  const affordable = await affordableMaxEntries(membership.companyId);
  const clients = company.agencyEnabled ? await listClients(membership.companyId, restrictToTeamIds) : [];
  const agencies = company.dispatchEnabled ? await listAgencies(membership.companyId, restrictToTeamIds) : [];
  const assignableAgencyStaff = company.dispatchEnabled ? await listAssignableAgencyStaff(membership.companyId) : [];
  const agencyRelationshipIds = [...new Set(assignableAgencyStaff.map((s) => s.companyRelationshipId))];
  const agencyTaskNamesByRelationship = Object.fromEntries(
    await Promise.all(
      agencyRelationshipIds.map(async (id) => [id, await listPastTaskNamesForRelationship(id)] as const),
    ),
  );
  // 自社(社内)勤務のシフトでも業務内容を選べるようにしたため、依頼主連携の
  // 有無に関わらず常に取得する（companyRelationshipId=nullの登録もここに含む）。
  const placementRates = await listPlacementRates(membership.companyId);

  // source=INHOUSEのシフトに立っているスタッフが、自社の名簿メンバーなのか
  // 配属記録のある派遣スタッフなのか公開募集経由なのかをまとめて解決する。
  const inhouseStaffIds = shifts.filter((s) => s.source !== "CLIENT").map((s) => s.staffUserId);
  const staffOrigins = await resolveStaffOrigins({ companyId: membership.companyId, staffUserIds: inhouseStaffIds });
  const originLabel = (origin: ReturnType<typeof staffOrigins.get>) => {
    if (!origin) return undefined;
    if (origin.kind === "SELF") return "自社";
    if (origin.kind === "PLACEMENT") return `配属：${origin.agencyCompanyName}`;
    return "公開募集";
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col bg-white px-1 pb-24 pt-2 sm:block sm:bg-transparent sm:px-8 sm:py-10">
      <CalendarView
        year={year}
        month={month}
        selectedTeamId={teamId}
        shifts={shifts.map((s) => ({
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          staffUserId: s.staffUserId,
          staffName: s.staff.name,
          startTime: s.startTime,
          endTime: s.endTime,
          isAllDay: s.isAllDay,
          isUndecided: s.isUndecided,
          source: s.source,
          clientName: s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? undefined,
          companyRelationshipId: s.companyRelationshipId,
          note: s.note,
          createdVia: s.createdVia,
          publicRecruitmentId: s.publicRecruitmentId,
          originLabel: s.source === "CLIENT" ? undefined : originLabel(staffOrigins.get(s.staffUserId)),
          // 業務報告が提出されたら、その内容（実績時間・業務内容・欠勤/キャンセル）
          // をカレンダーに反映する。勤務先はシフトのまま（報告では変えられない）。
          ...(() => {
            const report = reportDisplay(s.workReport);
            return {
              approvalStatus: report.approvalStatus,
              outcome: report.outcome,
              reportedTimeLabel: report.reportedTimeLabel,
              cancelFeeAmount: s.cancellation?.feeAmount ?? 0,
              taskName: report.reportedTaskName ?? s.taskName ?? s.workReport?.taskName ?? null,
            };
          })(),
          status: s.status,
          ownShift: s.companyId === membership.companyId,
          // 派遣会社が自社（依頼主）の現場に入れたシフト（派遣会社名義）
          agencyName:
            s.companyId !== membership.companyId ? (s.companyRelationship?.agencyCompany?.name ?? "派遣会社") : undefined,
        }))}
        shiftHistory={shiftHistory.map((s) => ({
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          staffUserId: s.staffUserId,
          staffName: s.staff.name,
          publicRecruitmentId: s.publicRecruitmentId,
          status: s.status,
          // 依頼主に取り消されたもの（月表示・日別詳細に「取消」として残す）
          clientCancelled: Boolean(s.cancellation && s.cancellation.source !== "AGENCY_OWN"),
          workplaceLabel: historyWorkplaceLabel(s, membership.companyId),
          taskName: s.taskName,
          // 時間は「別の枠に変更」の時だけ出す — 何が変わったかを見るのに要る。
          // 取り消しでは勤務先・理由の方が大事で、時間は行を長くするだけ。
          timeLabel:
            s.status === "SUPERSEDED" ? (s.isUndecided ? "未定" : s.isAllDay ? "終日" : `${s.startTime}〜${s.endTime}`) : null,
          reasonLabel: historyReasonLabel(s.cancellation),
        }))}
        staffOptions={staff.map((s) => ({ id: s.userId, name: s.name, viaAgencyRelationshipName: s.viaAgencyRelationshipName }))}
        teams={teams
          .filter((t) => isAdmin || myTeamIds.includes(t.id))
          .map((t) => ({
            id: t.id,
            name: t.name,
            clientIds: t.clientLinks.map((l) => l.companyRelationshipId),
            staffIds: t.memberships.map((m) => m.userId),
          }))}
        shiftRequests={shiftRequests.map((r) => ({
          id: r.id,
          staffUserId: r.staffUserId,
          staffName: r.staff.name,
          desire: r.desire,
          dates: r.dates.map((d) => d.toISOString().slice(0, 10)),
          note: r.note,
        }))}
        recruitments={recruitments.map((r) => ({
          id: r.id,
          title: r.title,
          note: r.note,
          date: r.date.toISOString().slice(0, 10),
          startTime: r.startTime,
          endTime: r.endTime,
          isUndecided: r.isUndecided,
          maxEntries: r.maxEntries,
          filled: r.entries.filter((e) => e.status !== "REJECTED").length,
          lockedTee: r.lockedTee,
          status: r.status,
          visibility: r.visibility,
          hourlyWage: r.hourlyWage,
          wageType: r.wageType,
          extraItems: r.extraItems as { label: string; value: string }[],
        }))}
        clientRecruitments={clientRecruitments.map((r) => ({
          id: r.id,
          clientCompanyName: r.company.name,
          title: r.title,
          date: r.date.toISOString().slice(0, 10),
          startTime: r.startTime,
          endTime: r.endTime,
          maxEntries: r.maxEntries,
          filled: r.entries.filter((e) => e.status !== "REJECTED").length,
        }))}
        teeBalance={company.teeBalance}
        affordableMaxEntries={affordable}
        clients={clients.map((c) => ({ id: c.id, name: c.clientCompany?.name ?? c.proxyName ?? "" }))}
        placementRates={placementRates.map((r) => ({
          id: r.id,
          companyRelationshipId: r.companyRelationshipId,
          taskName: r.taskName,
        }))}
        agencies={agencies.map((a) => ({ id: a.id, name: a.agencyCompany?.name ?? a.proxyName ?? "" }))}
        agencyStaffOptions={assignableAgencyStaff}
        agencyTaskNamesByRelationship={agencyTaskNamesByRelationship}
        selectedRelationshipId={relationshipId}
        companyName={company.name}
        initialSelectedDate={dateParam}
        historyCutoff={historyCutoff}
      />
    </main>
  );
}

// 変更履歴の勤務先。依頼主の現場は依頼主名、他社の募集に入った枠はその会社名、
// それ以外は自社。
function historyWorkplaceLabel(
  s: {
    companyRelationship: { clientCompany: { name: string } | null; proxyName: string | null } | null;
    publicRecruitment: { companyId: string; company: { name: string } } | null;
  },
  myCompanyId: string,
) {
  if (s.companyRelationship) return s.companyRelationship.clientCompany?.name ?? s.companyRelationship.proxyName ?? "依頼主";
  if (s.publicRecruitment && s.publicRecruitment.companyId !== myCompanyId) return s.publicRecruitment.company.name;
  return "自社";
}

// 取り消しの理由とキャンセル料。記録の無い（この機能より前の）取り消しは空。
function historyReasonLabel(c: { source: string; feeAmount: number } | null) {
  if (!c) return null;
  const reason =
    c.source === "CLIENT_APP"
      ? "依頼主取消（アプリ）"
      : c.source === "CLIENT_REPORTED"
        ? "依頼主取消（電話等）"
        : c.source === "STAFF_REPORTED"
          ? "勤務先キャンセル（スタッフ報告）"
          : "自社都合";
  return c.feeAmount > 0 ? `${reason}・キャンセル料 ${c.feeAmount.toLocaleString()}円` : reason;
}
