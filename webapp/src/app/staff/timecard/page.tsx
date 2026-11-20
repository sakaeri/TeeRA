import { isMonthlyApproval } from "@/lib/reportApprovalTiming";
import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { listOwnShiftsNeedingReport } from "@/lib/domain/workReports";
import { listKnownTaskNames, listTaskNamesByWorkplace } from "@/lib/domain/contracts";
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

export default async function StaffTimecardPage({ searchParams }: PageProps<"/staff/timecard">) {
  const { userId } = await requireCompanyStaffRole();
  // カレンダーの「＋」→「シフト外で働いた日を報告する」から来た時は、報告の画面を開いた状態にする
  const sp = await searchParams;
  const openUnscheduled = sp.unscheduled === "1";
  // 「＋」→「まとめて報告」から来た時は、まとめて報告を開いた状態にする
  const openBulk = sp.bulk === "1";
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
  // シフト外の勤務の業務内容の入力候補：本人が最近使った業務内容（会社ごとに新しい順）と、勤務先に登録されている業務内容
  const [recentReports, taskNamesByWorkplace] = await Promise.all([
    prisma.workReport.findMany({
      where: { staffUserId: userId, taskName: { not: null }, submittedAt: { not: null }, shift: { companyId: { in: companyIds } } },
      select: { taskName: true, shift: { select: { companyId: true } } },
      orderBy: { submittedAt: "desc" },
      take: 100,
    }),
    // 業務内容の候補は勤務先ごとに出す
    listTaskNamesByWorkplace(companyIds),
  ]);
  const recentTaskNamesByCompany = new Map<string, string[]>();
  for (const r of recentReports) {
    const list = recentTaskNamesByCompany.get(r.shift.companyId) ?? [];
    if (r.taskName && !list.includes(r.taskName) && list.length < 5) list.push(r.taskName);
    recentTaskNamesByCompany.set(r.shift.companyId, list);
  }
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <StaffTimecardView
        openUnscheduled={openUnscheduled}
        openBulk={openBulk}
        knownTaskNamesByCompany={knownTaskNames}
        taskNamesByWorkplace={taskNamesByWorkplace}
        unscheduledCompanies={myMemberships.map((m) => ({
          companyId: m.companyId,
          companyName: m.companyName,
          recentTaskNames: recentTaskNamesByCompany.get(m.companyId) ?? [],
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
          workplaceChangedFrom: s.workReport?.workplaceChangedFrom ?? null,
          companyRelationshipId: s.companyRelationshipId,
          startTime: s.startTime,
          endTime: s.endTime,
          taskName: s.workReport?.taskName ?? s.taskName,
          clockIn: s.workReport?.clockIn?.toISOString() ?? null,
          clockOut: s.workReport?.clockOut?.toISOString() ?? null,
          clockInTime: s.workReport?.clockIn ? formatJstTime(s.workReport.clockIn) : null,
          clockOutTime: s.workReport?.clockOut ? formatJstTime(s.workReport.clockOut) : null,
          breakMinutes: s.workReport?.breakMinutes ?? 0,
          comment: s.workReport?.comment ?? null,
          outcome: s.workReport?.outcome ?? null,
          approvalStatus: s.workReport?.approvalStatus ?? null,
          monthlyApproval: isMonthlyApproval(s.companyRelationship),
          rejectionReason: s.workReport?.rejectionReason ?? null,
          computedMinutes: s.workReport?.computedMinutes ?? 0,
          submittedAt: s.workReport?.submittedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  );
}
