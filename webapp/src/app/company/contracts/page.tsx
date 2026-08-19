import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listTemplates, listPlacementRates } from "@/lib/domain/contracts";
import { listClients } from "@/lib/domain/relationships";
import { prisma } from "@/lib/prisma";
import { ContractsView } from "@/components/company/ContractsView";

export default async function ContractsPage() {
  const { membership } = await requireCompanyAdminOrEditor();

  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });
  const [templates, rates, clients] = await Promise.all([
    listTemplates(membership.companyId),
    listPlacementRates(membership.companyId),
    company.agencyEnabled ? listClients(membership.companyId) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">雇用契約書・賃金単価</h1>
      <ContractsView
        templates={templates.map((t) => ({
          id: t.id,
          title: t.title,
          employmentType: t.employmentType,
          workplaceType: t.workplaceType,
          clientName: t.companyRelationship?.proxyName ?? null,
          wageType: t.wageType,
          wageAmount: t.wageAmount,
          status: t.status,
          contractedStaffNames: t.staffContracts
            .filter((sc) => sc.status !== "ENDED")
            .map((sc) => sc.staff.name),
        }))}
        rates={rates.map((r) => ({
          id: r.id,
          clientName: r.companyRelationship?.proxyName ?? "自社",
          companyRelationshipId: r.companyRelationshipId,
          taskName: r.taskName,
          wageType: r.wageType,
          amount: r.amount,
        }))}
        clients={clients.map((c) => ({
          id: c.id,
          name: c.clientCompany?.name ?? c.proxyName ?? "(名称未設定)",
        }))}
      />
    </main>
  );
}
