import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { listOwnShiftsNeedingReport } from "@/lib/domain/workReports";
import { listKnownTaskNames } from "@/lib/domain/contracts";
import { StaffTimecardView } from "@/components/staff/StaffTimecardView";

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

  const [shifts, knownTaskNamesByCompany] = await Promise.all([
    listOwnShiftsNeedingReport(userId, companyIds),
    Promise.all(companyIds.map((id) => listKnownTaskNames(id))),
  ]);
  const knownTaskNames = Object.fromEntries(companyIds.map((id, i) => [id, knownTaskNamesByCompany[i]]));

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">タイムカード・業務報告</h1>
      <StaffTimecardView
        knownTaskNamesByCompany={knownTaskNames}
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
          computedMinutes: s.workReport?.computedMinutes ?? 0,
          submittedAt: s.workReport?.submittedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
