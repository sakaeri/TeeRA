import "server-only";
import { prisma } from "@/lib/prisma";
import { missingRequiredDocuments, type RequiredDocument } from "@/lib/requiredDocuments";

// 自分（スタッフとして働く所属）が、会社に出していない必須の書類の一覧
export async function listMyMissingDocuments(userId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { userId, OR: [{ role: "STAFF" }, { canWorkShifts: true }], user: { isProxy: false } },
    include: { company: { select: { id: true, name: true, requireIdDocument: true, requireBankInfo: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships
    .map((m) => ({ companyId: m.companyId, companyName: m.company.name, missing: missingRequiredDocuments(m, m.company) }))
    .filter((x): x is { companyId: string; companyName: string; missing: RequiredDocument[] } => x.missing.length > 0);
}

// 会社側：スタッフとして働く人のうち、必須の書類が出ていない人（仮アカウントは除く）
export async function listStaffMissingDocuments(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { requireIdDocument: true, requireBankInfo: true },
  });
  if (!company.requireIdDocument && !company.requireBankInfo) return [];
  const memberships = await prisma.companyMembership.findMany({
    where: { companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }], user: { isProxy: false } },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships
    .map((m) => ({ userId: m.userId, name: m.user.name, missing: missingRequiredDocuments(m, company) }))
    .filter((x) => x.missing.length > 0);
}
