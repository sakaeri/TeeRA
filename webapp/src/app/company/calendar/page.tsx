import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listShiftsForMonth, listShiftRequests } from "@/lib/domain/shifts";
import { listPublicRecruitments, affordableMaxEntries } from "@/lib/domain/recruitment";
import { listStaff } from "@/lib/domain/roster";
import { listTeams } from "@/lib/domain/teams";
import { listClients } from "@/lib/domain/relationships";
import { prisma } from "@/lib/prisma";
import { CalendarView } from "@/components/company/CalendarView";

export default async function CompanyCalendarPage({
  searchParams,
}: PageProps<"/company/calendar">) {
  const { membership } = await requireCompanyAdminOrEditor();
  const sp = await searchParams;

  const now = new Date();
  const year = Number(sp.y) || now.getUTCFullYear();
  const month = Number(sp.m) || now.getUTCMonth() + 1;

  const [shifts, staff, teams, shiftRequests, recruitments, company] = await Promise.all([
    listShiftsForMonth({ companyId: membership.companyId, year, month }),
    listStaff(membership.companyId),
    listTeams(membership.companyId),
    listShiftRequests({ companyId: membership.companyId, status: "PENDING" }),
    listPublicRecruitments({ companyId: membership.companyId }),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const affordable = await affordableMaxEntries(membership.companyId);
  const clients = company.agencyEnabled ? await listClients(membership.companyId) : [];

  return (
    <main className="mx-auto w-full max-w-6xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">シフトカレンダー</h1>
      <CalendarView
        year={year}
        month={month}
        shifts={shifts.map((s) => ({
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          staffName: s.staff.name,
          startTime: s.startTime,
          endTime: s.endTime,
          isAllDay: s.isAllDay,
          isUndecided: s.isUndecided,
          source: s.source,
          clientName: s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? undefined,
          approvalStatus: s.workReport?.approvalStatus ?? null,
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
          date: r.date.toISOString().slice(0, 10),
          startTime: r.startTime,
          endTime: r.endTime,
          maxEntries: r.maxEntries,
          filled: r.entries.filter((e) => e.status !== "REJECTED").length,
          lockedTee: r.lockedTee,
          status: r.status,
        }))}
        teeBalance={company.teeBalance}
        affordableMaxEntries={affordable}
        clients={clients.map((c) => ({ id: c.id, name: c.clientCompany?.name ?? c.proxyName ?? "" }))}
      />
    </main>
  );
}
