import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listStaffWithSummary } from "@/lib/domain/roster";
import { listClients, listAgencies } from "@/lib/domain/relationships";
import { listTeams } from "@/lib/domain/teams";
import { listTemplates } from "@/lib/domain/contracts";
import { prisma } from "@/lib/prisma";
import { RosterView } from "@/components/company/RosterView";

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  PART_TIME: "アルバイト",
  FIXED_TERM_EMPLOYEE: "契約社員",
  FULL_TIME: "正社員",
  CONTRACTOR: "業務委託",
  DISPATCH_STAFF: "派遣社員",
};
const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

export default async function RosterPage() {
  const { membership } = await requireCompanyAdminOrEditor();

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: membership.companyId },
  });

  const [staff, clients, agencies, teams, templates] = await Promise.all([
    listStaffWithSummary(membership.companyId),
    company.agencyEnabled ? listClients(membership.companyId) : Promise.resolve([]),
    company.dispatchEnabled ? listAgencies(membership.companyId) : Promise.resolve([]),
    listTeams(membership.companyId),
    listTemplates(membership.companyId),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <RosterView
        staff={staff}
        clients={clients.map((c) => ({
          id: c.id,
          name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)",
          isProxy: !c.clientCompany,
          status: c.status,
        }))}
        agencies={agencies.map((a) => ({
          id: a.id,
          name: a.agencyCompany?.name ?? a.proxyName ?? "(名称未設定)",
          isProxy: !a.agencyCompany,
          status: a.status,
        }))}
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        templates={templates
          .filter((t) => t.status !== "ARCHIVED")
          .map((t) => ({
            id: t.id,
            title: t.title,
            employmentTypeLabel: EMPLOYMENT_TYPE_LABEL[t.employmentType] ?? t.employmentType,
            wageLabel: `${WAGE_TYPE_LABEL[t.wageType]}${t.wageAmount}円`,
            workplaceName:
              t.workplaceType === "CLIENT"
                ? (t.workplaceNote ?? t.companyRelationship?.clientCompany?.name ?? t.companyRelationship?.proxyName ?? "配属先")
                : "自社",
          }))}
        agencyEnabled={company.agencyEnabled}
        dispatchEnabled={company.dispatchEnabled}
      />
    </main>
  );
}
