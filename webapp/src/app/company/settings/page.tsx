import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
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

export default async function SettingsPage({ searchParams }: PageProps<"/company/settings">) {
  const { membership } = await requireCompanyAdminOrEditor();
  const sp = await searchParams;
  const initialTab = typeof sp.tab === "string" ? sp.tab : "basic";

  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });

  const [admins, teams, staff, templates, clients, reports] = await Promise.all([
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

  const shifts = await prisma.shift.findMany({
    where: { id: { in: reports.map((r) => r.shiftId) } },
  });
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <SettingsView
        initialTab={initialTab}
        companyName={company.name}
        invoiceRegistrationNumber={company.invoiceRegistrationNumber ?? ""}
        address={company.address ?? ""}
        phoneNumber={company.phoneNumber ?? ""}
        admins={admins.map((a) => ({
          userId: a.userId,
          name: a.user.name,
          email: a.user.email,
          role: a.role as "COMPANY_ADMIN" | "COMPANY_EDITOR",
        }))}
        teams={teams.map((t) => ({
          id: t.id,
          name: t.name,
          members: t.memberships.map((m) => ({
            userId: m.userId,
            name: m.user.name,
            role: m.role,
          })),
        }))}
        staff={staff.map((s) => ({ userId: s.userId, name: s.name }))}
        contractTemplates={templates.map((t) => ({
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
          };
        })}
      />
    </main>
  );
}
