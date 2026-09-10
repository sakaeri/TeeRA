import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { listStaffShiftsForMonth, listOwnPendingShiftRequests } from "@/lib/domain/shifts";
import { listStaffNotices } from "@/lib/domain/notices";
import { todayJstParts } from "@/lib/date";
import { StaffCalendarView } from "@/components/staff/StaffCalendarView";
import { StaffNoticesSection } from "@/components/staff/StaffNoticesSection";

export default async function StaffHomePage({
  searchParams,
}: PageProps<"/staff">) {
  const { userId, membership } = await requireCompanyStaffRole();
  const sp = await searchParams;

  const today = todayJstParts();
  const year = Number(sp.y) || today.year;
  const month = Number(sp.m) || today.month;

  const myMemberships = await listMyMemberships(userId);
  const companyIds = myMemberships.map((m) => m.companyId);

  const [shifts, pendingRequests, notices] = await Promise.all([
    listStaffShiftsForMonth({ staffUserId: userId, companyIds, year, month }),
    listOwnPendingShiftRequests({ staffUserId: userId, companyIds }),
    listStaffNotices(userId, membership.companyId),
  ]);
  const unreadNotices = notices.filter((n) => !n.readAt);

  // 1件のShiftRequestが複数日をまとめて持っているため、カレンダー表示用に
  // 「1日=1行」へ展開する。
  const requestRows = pendingRequests.flatMap((r) =>
    r.dates.map((d) => ({
      id: `${r.id}-${d.toISOString().slice(0, 10)}`,
      date: d.toISOString().slice(0, 10),
      companyId: r.companyId,
      companyName: r.company.name,
      desire: r.desire,
    })),
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">シフトカレンダー</h1>
      <StaffNoticesSection
        notices={unreadNotices.map((n) => ({ id: n.id, message: n.message, createdAt: n.createdAt.toISOString() }))}
      />
      <StaffCalendarView
        year={year}
        month={month}
        companies={myMemberships.map((m) => ({ id: m.companyId, name: m.companyName }))}
        shifts={shifts.map((s) => ({
          id: s.id,
          date: s.date.toISOString().slice(0, 10),
          companyId: s.companyId,
          companyName: s.company.name,
          startTime: s.startTime,
          endTime: s.endTime,
          isAllDay: s.isAllDay,
          isUndecided: s.isUndecided,
          approvalStatus: s.workReport?.approvalStatus ?? null,
        }))}
        pendingRequests={requestRows}
      />
    </main>
  );
}
