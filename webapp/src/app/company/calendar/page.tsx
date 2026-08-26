import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listShiftsForMonth, listShiftRequests, listShiftHistoryForMonth } from "@/lib/domain/shifts";
import {
  listPublicRecruitments,
  listClientRecruitments,
  affordableMaxEntries,
  resolveStaffOrigins,
} from "@/lib/domain/recruitment";
import { listStaff } from "@/lib/domain/roster";
import { listTeams } from "@/lib/domain/teams";
import { listClients, listAgencies } from "@/lib/domain/relationships";
import { prisma } from "@/lib/prisma";
import { todayJstParts } from "@/lib/date";
import { CalendarView } from "@/components/company/CalendarView";

export default async function CompanyCalendarPage({
  searchParams,
}: PageProps<"/company/calendar">) {
  const { membership } = await requireCompanyAdminOrEditor();
  const sp = await searchParams;

  const today = todayJstParts();
  const dateParam = typeof sp.date === "string" && sp.date ? sp.date : undefined;
  const [dateYear, dateMonth] = dateParam ? dateParam.split("-").map(Number) : [];
  const year = Number(sp.y) || dateYear || today.year;
  const month = Number(sp.m) || dateMonth || today.month;
  const teamId = typeof sp.team === "string" && sp.team ? sp.team : undefined;
  const relationshipId = typeof sp.rel === "string" && sp.rel ? sp.rel : undefined;

  const [shifts, shiftHistory, staff, teams, shiftRequests, recruitments, clientRecruitments, company] = await Promise.all([
    listShiftsForMonth({ companyId: membership.companyId, year, month, teamId, companyRelationshipId: relationshipId }),
    listShiftHistoryForMonth({ companyId: membership.companyId, year, month, teamId }),
    listStaff(membership.companyId),
    listTeams(membership.companyId),
    listShiftRequests({ companyId: membership.companyId, status: "PENDING" }),
    listPublicRecruitments({ companyId: membership.companyId }),
    listClientRecruitments(membership.companyId),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const affordable = await affordableMaxEntries(membership.companyId);
  const clients = company.agencyEnabled ? await listClients(membership.companyId) : [];
  const agencies = company.dispatchEnabled ? await listAgencies(membership.companyId) : [];

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
    <main className="mx-auto w-full max-w-6xl px-8 py-10">
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
          approvalStatus: s.workReport?.approvalStatus ?? null,
        }))}
        shiftHistory={shiftHistory.map((s) => ({
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          staffName: s.staff.name,
          publicRecruitmentId: s.publicRecruitmentId,
          status: s.status,
          originLabel: s.publicRecruitment ? `${s.publicRecruitment.company.name}／${s.publicRecruitment.title}` : null,
        }))}
        staffOptions={staff.map((s) => ({ id: s.userId, name: s.name }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        shiftRequests={shiftRequests.map((r) => ({
          id: r.id,
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
        agencies={agencies.map((a) => ({ id: a.id, name: a.agencyCompany?.name ?? a.proxyName ?? "" }))}
        selectedRelationshipId={relationshipId}
        companyName={company.name}
        initialSelectedDate={dateParam}
      />
    </main>
  );
}
