import { redirect } from "next/navigation";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage, isCompanyScopeAdmin, isLeaderOnly } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { listTeams } from "@/lib/domain/teams";
import { listStaff } from "@/lib/domain/roster";
import { listTemplates } from "@/lib/domain/contracts";
import { listClients } from "@/lib/domain/relationships";
import { listPendingReportsForCompany } from "@/lib/domain/workReports";
import { SettingsView } from "@/components/company/SettingsView";

const OUTCOME_LABEL: Record<string, string> = {
  WORKED: "出勤した",
  ABSENT: "欠勤",
  CANCELLED_BY_EMPLOYER: "勤務先からのキャンセル",
};

function formatJstTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

export default async function SettingsPage({ searchParams }: PageProps<"/company/settings">) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (isLeaderOnly(membership)) redirect("/company/calendar");
  // チームマネージャーには、会社の口座・本部メンバー・他のチーム・契約書
  // テンプレート・他チームの業務報告を見せない（変更はサーバー側でも拒否済み）。
  const isCompanyAdmin = isCompanyScopeAdmin(membership);
  const managedTeamIds = new Set(
    membership.teamMemberships.filter((tm) => tm.role === "TEAM_MANAGER").map((tm) => tm.teamId),
  );
  const sp = await searchParams;
  const initialTab = typeof sp.tab === "string" ? sp.tab : "basic";

  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });

  const [allAdmins, allTeams, allStaff, allTemplates, clients, allReports] = await Promise.all([
    prisma.companyMembership.findMany({
      where: {
        companyId: membership.companyId,
        role: { in: ["COMPANY_ADMIN", "COMPANY_EDITOR"] },
      },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    listTeams(membership.companyId),
    listStaff(membership.companyId),
    listTemplates(membership.companyId),
    company.agencyEnabled ? listClients(membership.companyId) : Promise.resolve([]),
    listPendingReportsForCompany(membership.companyId),
  ]);

  const admins = isCompanyAdmin ? allAdmins : [];
  const teams = isCompanyAdmin ? allTeams : allTeams.filter((t) => managedTeamIds.has(t.id));
  const staff = isCompanyAdmin ? allStaff : [];
  const templates = isCompanyAdmin ? allTemplates : [];
  const reports = allReports.filter((r) => canManage(membership, r.shift.teamId));

  const shifts = await prisma.shift.findMany({
    where: { id: { in: reports.map((r) => r.shiftId) } },
  });
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10 print:p-0">
      <SettingsView
        initialTab={initialTab}
        isCompanyAdmin={isCompanyAdmin}
        currentUserId={userId}
        companyName={company.name}
        address={company.address ?? ""}
        phoneNumber={company.phoneNumber ?? ""}
        // 以下は本部の管理者/編集者だけに渡す
        invoiceRegistrationNumber={isCompanyAdmin ? (company.invoiceRegistrationNumber ?? "") : ""}
        notificationEmail={isCompanyAdmin ? (company.notificationEmail ?? "") : ""}
        bankName={isCompanyAdmin ? (company.bankName ?? "") : ""}
        branchName={isCompanyAdmin ? (company.branchName ?? "") : ""}
        accountType={isCompanyAdmin ? (company.accountType ?? "") : ""}
        accountNumber={isCompanyAdmin ? (company.accountNumber ?? "") : ""}
        accountHolderName={isCompanyAdmin ? (company.accountHolderName ?? "") : ""}
        teeBalance={company.teeBalance}
        admins={admins.map((a) => ({
          userId: a.userId,
          name: a.user.name,
          email: a.user.email,
          role: a.role as "COMPANY_ADMIN" | "COMPANY_EDITOR",
          canWorkShifts: a.canWorkShifts,
        }))}
        teams={teams.map((t) => ({
          id: t.id,
          name: t.name,
          notificationEmail: t.notificationEmail ?? "",
          members: t.memberships.map((m) => ({
            userId: m.userId,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
          })),
        }))}
        staff={staff.map((s) => ({ userId: s.userId, name: s.name }))}
        contractTemplates={templates
          .filter((t) => !t.isUploadOnly)
          .map((t) => ({
          id: t.id,
          title: t.title,
          employmentType: t.employmentType,
          workplaceType: t.workplaceType,
          workplaceNote: t.workplaceNote,
          clientName: t.workplaceNote ?? t.companyRelationship?.clientCompany?.name ?? t.companyRelationship?.proxyName ?? null,
          jobDescription: t.jobDescription,
          scheduleType: t.scheduleType,
          workStartTime: t.workStartTime,
          workEndTime: t.workEndTime,
          actualWorkMinutes: t.actualWorkMinutes,
          breakMinutes: t.breakMinutes,
          hasOvertime: t.hasOvertime,
          overtimeNote: t.overtimeNote,
          fixedWeekdays: t.fixedWeekdays,
          shiftPatternNote: t.shiftPatternNote,
          restNote: t.restNote,
          wageType: t.wageType,
          wageAmount: t.wageAmount,
          paymentClosingDay: t.paymentClosingDay,
          paymentDay: t.paymentDay,
          paymentMethod: t.paymentMethod,
          contractPeriodType: t.contractPeriodType,
          contractStartDate: t.contractStartDate.toISOString().slice(0, 10),
          contractEndDate: t.contractEndDate ? t.contractEndDate.toISOString().slice(0, 10) : null,
          extraItems: (t.extraItems as { label: string; value: string }[] | null) ?? [],
          status: t.status,
          contractedStaffNames: t.staffContracts
            .filter((sc) => sc.status !== "ENDED")
            .map((sc) => sc.staff.name),
        }))}
        contractClients={clients.map((c) => ({
          id: c.id,
          name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)",
        }))}
        workReports={reports.map((r) => {
          const shift = shiftById.get(r.shiftId);
          return {
            id: r.id,
            staffName: r.staff.name,
            outcome: OUTCOME_LABEL[r.outcome] ?? r.outcome,
            date: shift?.date.toISOString().slice(0, 10) ?? "",
            computedHours: (r.computedMinutes / 60).toFixed(1),
            comment: r.comment,
            taskName: r.taskName ?? shift?.taskName ?? null,
            clockInTime: r.clockIn ? formatJstTime(r.clockIn) : null,
            clockOutTime: r.clockOut ? formatJstTime(r.clockOut) : null,
            breakMinutes: r.breakMinutes,
            isUnscheduled: r.shift.createdVia === "STAFF_REPORT",
          };
        })}
      />
    </main>
  );
}
