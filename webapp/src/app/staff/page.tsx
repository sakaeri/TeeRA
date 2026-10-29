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
import { reportDisplay } from "@/lib/workReportDisplay";

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
    listStaffNotices(userId, membership.companyId, companyIds),
    listOwnShiftsNeedingReport(userId, companyIds),
    Promise.all(companyIds.map((id) => listKnownTaskNames(id))),
  ]);
  const unreadNotices = notices.filter((n) => !n.readAt);
  const knownTaskNames = Object.fromEntries(companyIds.map((id, i) => [id, knownTaskNamesByCompany[i]]));

  // カレンダー画面の「本日の出退勤」カード用 — 今日の分でまだ対応が
  // 済んでいないシフトだけ（対応済みは今まで通りタイムカードのページの
  // 履歴側で見る）。
  const todayStr = todayJst();
  // 今日の分に加え、前日以前の未提出も出す（日付が変わると前日の未提出に
  // 気付く場所がなかったため）。
  const popupCandidates = shiftsNeedingReport
    .filter((s) => s.date.toISOString().slice(0, 10) <= todayStr)
    .map((s) => ({
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
    }))
    .filter((s) => !isDone(s));
  const todayShifts = popupCandidates.filter((s) => s.date === todayStr);
  const pastUnsubmitted = popupCandidates.filter((s) => s.date < todayStr);
  // 前日以前の分は多いとポップアップが長くなるので3件まで（残りはタイムカードへ）
  const PAST_IN_POPUP = 3;

  // 1件のShiftRequestが複数日をまとめて持っているため、カレンダー表示用に
  // 「1日=1行」へ展開する。過去日は会社側が対応し忘れていてもマッチしよう
  // がなく無意味なので、会社側の一覧（ShiftRequestsSection）と同じく
  // 除外する（会社の回答待ち表示がスタッフ側にだけ残り続けないように）。
  const requestRows = pendingRequests
    .flatMap((r) =>
      r.dates.map((d) => ({
        id: `${r.id}-${d.toISOString().slice(0, 10)}`,
        date: d.toISOString().slice(0, 10),
        companyId: r.companyId,
        companyName: r.company.name,
        desire: r.desire,
        status: r.status,
      })),
    )
    .filter((r) => r.date >= todayStr);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col bg-white px-1 pb-24 pt-2 sm:block sm:bg-transparent sm:px-6 sm:py-10">
      <h1 className="mb-6 hidden font-serif-jp text-2xl font-bold sm:block">シフトカレンダー</h1>
      <StaffNoticesSection
        notices={unreadNotices.map((n) => ({ id: n.id, message: n.message, createdAt: n.createdAt.toISOString() }))}
      />
      <TodayShiftPopup
        shifts={[...todayShifts, ...pastUnsubmitted.slice(0, PAST_IN_POPUP)]}
        moreUnsubmittedCount={Math.max(pastUnsubmitted.length - PAST_IN_POPUP, 0)}
        knownTaskNamesByCompany={knownTaskNames}
      />
      <StaffCalendarView
        year={year}
        month={month}
        companies={myMemberships.map((m) => ({ id: m.companyId, name: m.companyName }))}
        shifts={shifts.map((s) => {
          const report = reportDisplay(s.workReport);
          return {
            id: s.id,
            date: s.date.toISOString().slice(0, 10),
            companyId: s.companyId,
            companyName: s.company.name,
            workplaceName: s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? null,
            startTime: s.startTime,
            endTime: s.endTime,
            isAllDay: s.isAllDay,
            isUndecided: s.isUndecided,
            // 提出済みの報告の状態（未提出ならnull）。打刻した時点でapprovalStatusは
            // PENDINGになるため、提出したかどうかはreportDisplayで判定する
            approvalStatus: report.approvalStatus,
            outcome: report.outcome,
            reportedTimeLabel: report.reportedTimeLabel,
            workedMinutes: s.workReport?.computedMinutes ?? 0,
            breakMinutes: s.workReport?.breakMinutes ?? 0,
            rejectionReason: report.approvalStatus === "REJECTED" ? (s.workReport?.rejectionReason ?? null) : null,
            clockedOut: Boolean(s.workReport?.clockOut),
            taskName: report.reportedTaskName ?? s.taskName ?? s.workReport?.taskName ?? null,
            status: s.status,
            // 募集から入ったシフトなら、募集の備考と追加のお知らせ
            recruitmentNote: s.publicRecruitment?.note ?? null,
            announcements: (s.publicRecruitment?.announcements ?? []).map((a) => ({
              id: a.id,
              body: a.body,
              createdAt: a.createdAt.toISOString(),
            })),
          };
        })}
        pendingRequests={requestRows}
      />
    </main>
  );
}
