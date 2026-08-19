import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listOwnShiftsNeedingReport } from "@/lib/domain/workReports";
import { StaffTimecardView } from "@/components/staff/StaffTimecardView";

export default async function StaffTimecardPage() {
  const { userId } = await requireCompanyStaffRole();
  const shifts = await listOwnShiftsNeedingReport(userId);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">タイムカード・業務報告</h1>
      <StaffTimecardView
        shifts={shifts.map((s) => ({
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          companyName: s.company.name,
          startTime: s.startTime,
          endTime: s.endTime,
          clockIn: s.workReport?.clockIn?.toISOString() ?? null,
          clockOut: s.workReport?.clockOut?.toISOString() ?? null,
          outcome: s.workReport?.outcome ?? null,
          approvalStatus: s.workReport?.approvalStatus ?? null,
          computedMinutes: s.workReport?.computedMinutes ?? 0,
        }))}
      />
    </main>
  );
}
