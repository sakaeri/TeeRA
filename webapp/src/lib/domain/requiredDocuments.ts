import "server-only";
import { prisma } from "@/lib/prisma";
import { missingRequiredDocuments, type RequiredDocument } from "@/lib/requiredDocuments";

// 必須かどうかは契約書ごとに決める。同意待ち・契約中の契約書のどれか1つでも
// 必須なら、その会社では必要とみなす（契約書がまだ無い人には求めない）
const OPEN_CONTRACT = { status: { in: ["PENDING_CONSENT" as const, "ACTIVE" as const] } };

function requirementFrom(contracts: { template: { requireIdDocument: boolean; requireBankInfo: boolean } }[]) {
  return {
    requireIdDocument: contracts.some((c) => c.template.requireIdDocument),
    requireBankInfo: contracts.some((c) => c.template.requireBankInfo),
  };
}

// 自分（スタッフとして働く所属）が、会社に出していない必須の書類の一覧
export async function listMyMissingDocuments(userId: string) {
  const [memberships, contracts] = await Promise.all([
    prisma.companyMembership.findMany({
      where: { userId, OR: [{ role: "STAFF" }, { canWorkShifts: true }], user: { isProxy: false } },
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.staffContract.findMany({
      where: { staffUserId: userId, ...OPEN_CONTRACT },
      select: { template: { select: { companyId: true, requireIdDocument: true, requireBankInfo: true } } },
    }),
  ]);
  return memberships
    .map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      missing: missingRequiredDocuments(m, requirementFrom(contracts.filter((c) => c.template.companyId === m.companyId))),
    }))
    .filter((x): x is { companyId: string; companyName: string; missing: RequiredDocument[] } => x.missing.length > 0);
}

// 会社側：スタッフとして働く人のうち、必須の書類が出ていない人（仮アカウントは除く）
export async function listStaffMissingDocuments(companyId: string) {
  const [memberships, contracts] = await Promise.all([
    prisma.companyMembership.findMany({
      where: { companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }], user: { isProxy: false } },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.staffContract.findMany({
      where: { template: { companyId }, ...OPEN_CONTRACT },
      select: { staffUserId: true, template: { select: { requireIdDocument: true, requireBankInfo: true } } },
    }),
  ]);
  return memberships
    .map((m) => ({
      userId: m.userId,
      name: m.user.name,
      missing: missingRequiredDocuments(m, requirementFrom(contracts.filter((c) => c.staffUserId === m.userId))),
    }))
    .filter((x) => x.missing.length > 0);
}
