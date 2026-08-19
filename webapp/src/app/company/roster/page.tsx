import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listStaffWithSummary } from "@/lib/domain/roster";
import { listClients, listAgencies } from "@/lib/domain/relationships";
import { listTeams } from "@/lib/domain/teams";
import { prisma } from "@/lib/prisma";
import { RosterView } from "@/components/company/RosterView";

export default async function RosterPage() {
  const { membership } = await requireCompanyAdminOrEditor();

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: membership.companyId },
  });

  const [staff, clients, agencies, teams] = await Promise.all([
    listStaffWithSummary(membership.companyId),
    company.agencyEnabled ? listClients(membership.companyId) : Promise.resolve([]),
    company.dispatchEnabled ? listAgencies(membership.companyId) : Promise.resolve([]),
    listTeams(membership.companyId),
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
        agencyEnabled={company.agencyEnabled}
        dispatchEnabled={company.dispatchEnabled}
      />
    </main>
  );
}
