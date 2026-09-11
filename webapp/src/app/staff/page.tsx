import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { listStaffShiftsForMonth, listOwnPendingShiftRequests } from "@/lib/domain/shifts";
import { listOwnShiftsNeedingReport } from "@/lib/domain/workReports";
import { listKnownTaskNames } from "@/lib/domain/contracts";
import { listStaffNotices } from "@/lib/domain/notices";
import { todayJst, todayJstParts } from "@/lib/date";
import { StaffCalendarView } from "@/components/staff/StaffCalendarView";
import { StaffNoticesSection } from "@/components/staff/StaffNoticesSection";
import { TodayShiftPopup } from "@/components/staff/TodayShiftPopup";
import { isDone } from "@/lib/staffShiftStatus";

function formatJstTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

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

  const [shifts, pendingRequests, notices, shiftsNeedingReport, knownTaskNamesByCompany] = await Promise.all([
    listStaffShiftsForMonth({ staffUserId: userId, companyIds, year, month }),
    listOwnPendingShiftRequests({ staffUserId: userId, companyIds }),
    listStaffNotices(userId, membership.companyId),
    listOwnShiftsNeedingReport(userId, companyIds),
    Promise.all(companyIds.map((id) => listKnownTaskNames(id))),
  ]);
  const unreadNotices = notices.filter((n) => !n.readAt);
  const knownTaskNames = Object.fromEntries(companyIds.map((id, i) => [id, knownTaskNamesByCompany[i]]));

  // カレンダー画面の「本日の出退勤」カード用 — 今日の分でまだ対応が
  // 済んでいないシフトだけ（対応済みは今まで通りタイムカードのページの
  // 履歴側で見る）。
  const todayStr = todayJst();
  const todayShifts = shiftsNeedingReport
    .filter((s) => s.date.toISOString().slice(0, 10) === todayStr)
    .map((s) => ({
      id: s.id,
      workReportId: s.workReport?.id ?? null,
      date: s.date.toISOString().slice(0, 10),
      companyId: s.companyId,
      companyName: s.company.name,
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
    }))
    .filter((s) => !isDone(s));

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
    <main className="mx-auto w-full max-w-4xl px-1 py-4 sm:px-6 sm:py-10">
      <h1 className="mb-6 hidden font-serif-jp text-2xl font-bold sm:block">シフトカレンダー</h1>
      <StaffNoticesSection
        notices={unreadNotices.map((n) => ({ id: n.id, message: n.message, createdAt: n.createdAt.toISOString() }))}
      />
      <TodayShiftPopup shifts={todayShifts} knownTaskNamesByCompany={knownTaskNames} />
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
          taskName: s.taskName ?? s.workReport?.taskName ?? null,
        }))}
        pendingRequests={requestRows}
      />
    </main>
  );
}
