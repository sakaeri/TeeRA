import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { StaffAffiliationsView } from "@/components/staff/StaffAffiliationsView";

export default async function StaffContractsListPage() {
  const { userId } = await requireCompanyStaffRole();
  const memberships = await listMyMemberships(userId);
  const companyIds = memberships.map((m) => m.companyId);

  // 会社ごとに「本人の確認待ち（要確認）」件数を出すため、まとめて1クエリで
  // 取得してからJS側でcompanyIdごとに数える。
  const pending = await prisma.staffContract.findMany({
    where: { staffUserId: userId, status: "PENDING_CONSENT", template: { companyId: { in: companyIds } } },
    select: { template: { select: { companyId: true } } },
  });
  const pendingByCompany = new Map<string, number>();
  for (const c of pending) {
    pendingByCompany.set(c.template.companyId, (pendingByCompany.get(c.template.companyId) ?? 0) + 1);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">所属先設定・雇用契約書</h1>
      <StaffAffiliationsView
        companies={memberships.map((m) => ({
          companyId: m.companyId,
          companyName: m.companyName,
          role: m.role,
          pendingCount: pendingByCompany.get(m.companyId) ?? 0,
        }))}
      />
    </main>
  );
}
