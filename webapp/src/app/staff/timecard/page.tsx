import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { listOwnShiftsNeedingReport } from "@/lib/domain/workReports";
import { listKnownTaskNames } from "@/lib/domain/contracts";
import { StaffTimecardView } from "@/components/staff/StaffTimecardView";
import { prisma } from "@/lib/prisma";

function formatJstTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export default async function StaffTimecardPage() {
  const { userId } = await requireCompanyStaffRole();
  const myMemberships = await listMyMemberships(userId);
  const companyIds = myMemberships.map((m) => m.companyId);

  const [shifts, knownTaskNamesByCompany, placements] = await Promise.all([
    listOwnShiftsNeedingReport(userId, companyIds),
    Promise.all(companyIds.map((id) => listKnownTaskNames(id))),
    // シフト外の勤務の報告で選べる勤務先（本人が配属されている依頼主）
    prisma.staffPlacement.findMany({
      where: {
        staffUserId: userId,
        active: true,
        companyRelationship: { agencyCompanyId: { in: companyIds }, status: "ACTIVE" },
      },
      include: { companyRelationship: { include: { clientCompany: true } } },
    }),
  ]);
  const knownTaskNames = Object.fromEntries(companyIds.map((id, i) => [id, knownTaskNamesByCompany[i]]));

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">タイムカード・業務報告</h1>
      <StaffTimecardView
        knownTaskNamesByCompany={knownTaskNames}
        unscheduledCompanies={myMemberships.map((m) => ({
          companyId: m.companyId,
          companyName: m.companyName,
          workplaces: placements
            .filter((p) => p.companyRelationship.agencyCompanyId === m.companyId)
            .map((p) => ({
              companyRelationshipId: p.companyRelationshipId,
              name: p.companyRelationship.clientCompany?.name ?? p.companyRelationship.proxyName ?? "依頼主",
            })),
        }))}
        shifts={shifts.map((s) => ({
          id: s.id,
          workReportId: s.workReport?.id ?? null,
          date: s.date.toISOString().slice(0, 10),
          companyId: s.companyId,
          companyName: s.company.name,
          workplaceName: s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? null,
          startTime: s.startTime,
          endTime: s.endTime,
          taskName: s.workReport?.taskName ?? s.taskName,
          clockIn: s.workReport?.clockIn?.toISOString() ?? null,
          clockOut: s.workReport?.clockOut?.toISOString() ?? null,
          clockInTime: s.workReport?.clockIn ? formatJstTime(s.workReport.clockIn) : null,
          clockOutTime: s.workReport?.clockOut ? formatJstTime(s.workReport.clockOut) : null,
          breakMinutes: s.workReport?.breakMinutes ?? 0,
          outcome: s.workReport?.outcome ?? null,
          approvalStatus: s.workReport?.approvalStatus ?? null,
          rejectionReason: s.workReport?.rejectionReason ?? null,
          computedMinutes: s.workReport?.computedMinutes ?? 0,
          submittedAt: s.workReport?.submittedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
