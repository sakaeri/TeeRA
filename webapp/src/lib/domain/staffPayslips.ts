import "server-only";
import { prisma } from "@/lib/prisma";
import { getEmploymentType } from "@/lib/domain/payroll";

// スタッフのアプリの「給料明細」。会社が発行した明細（の最新の発行内容）だけを見せる（下書きは見せない）。
// 給与明細を電子で渡すには本人の同意が要るので、会社ごとに一度「同意する」を押してもらってから見せる。
export async function listMyPayslips(staffUserId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { userId: staffUserId },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const slips = await prisma.salarySlip.findMany({
    where: { staffUserId, companyId: { in: memberships.map((m) => m.companyId) }, issues: { some: {} } },
    include: { issues: { orderBy: { issuedAt: "desc" } } },
    orderBy: { targetMonth: "desc" },
  });
  const companies = await Promise.all(
    memberships.map(async (m) => {
      const own = slips.filter((s) => s.companyId === m.companyId);
      return {
        companyId: m.companyId,
        companyName: m.company.name,
        consented: Boolean(m.payslipEConsentAt),
        slips: await Promise.all(
          own.map(async (s) => {
            const latest = s.issues[0];
            const snap = latest.snapshot as { net?: number; issuedAt?: string };
            const employmentType = await getEmploymentType(s.companyId, staffUserId, s.targetMonth);
            return {
              id: s.id,
              issueId: latest.id,
              targetMonth: s.targetMonth,
              issuedAt: (snap.issuedAt ?? latest.issuedAt.toISOString()).slice(0, 10),
              net: snap.net ?? 0,
              revised: s.issues.length > 1,
              isContractor: employmentType === "CONTRACTOR",
            };
          }),
        ),
      };
    }),
  );
  return companies.filter((c) => c.slips.length > 0);
}

export async function consentToElectronicPayslip(staffUserId: string, companyId: string) {
  await prisma.companyMembership.updateMany({
    where: { userId: staffUserId, companyId, payslipEConsentAt: null },
    data: { payslipEConsentAt: new Date() },
  });
}
