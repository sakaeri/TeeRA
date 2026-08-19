import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listStaffShiftsForMonth } from "@/lib/domain/shifts";
import { StaffCalendarView } from "@/components/staff/StaffCalendarView";

export default async function StaffHomePage({
  searchParams,
}: PageProps<"/staff">) {
  const { userId } = await requireCompanyStaffRole();
  const sp = await searchParams;

  const now = new Date();
  const year = Number(sp.y) || now.getUTCFullYear();
  const month = Number(sp.m) || now.getUTCMonth() + 1;

  const shifts = await listStaffShiftsForMonth({ staffUserId: userId, year, month });

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">シフトカレンダー</h1>
      <StaffCalendarView
        year={year}
        month={month}
        shifts={shifts.map((s) => ({
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          companyName: s.company.name,
          startTime: s.startTime,
          endTime: s.endTime,
          isAllDay: s.isAllDay,
          isUndecided: s.isUndecided,
        }))}
      />
    </main>
  );
}
