import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listStaffContracts } from "@/lib/domain/contracts";
import { prisma } from "@/lib/prisma";
import { StaffContractsView } from "@/components/staff/StaffContractsView";

export default async function StaffContractsPage() {
  const { userId, membership } = await requireCompanyStaffRole();

  const [myContracts, availableTemplates] = await Promise.all([
    listStaffContracts(userId),
    prisma.contractTemplate.findMany({
      where: { companyId: membership.companyId, status: "ACTIVE" },
    }),
  ]);

  const contractedTemplateIds = new Set(
    myContracts.filter((c) => c.status !== "ENDED").map((c) => c.templateId),
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">所属先設定・雇用契約書</h1>
      <StaffContractsView
        myContracts={myContracts.map((c) => ({
          id: c.id,
          title: c.template.title,
          status: c.status,
          wageAmountSnapshot: c.wageAmountSnapshot,
          wageType: c.template.wageType,
          contractStartDate: (c.contractStartDate ?? c.template.contractStartDate).toISOString().slice(0, 10),
        }))}
        availableTemplates={availableTemplates
          .filter((t) => !contractedTemplateIds.has(t.id))
          .map((t) => ({
            id: t.id,
            title: t.title,
            wageType: t.wageType,
            wageAmount: t.wageAmount,
          }))}
      />
    </main>
  );
}
