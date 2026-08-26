import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// 依頼主一覧 (from this company's perspective as the sending/agency side):
// companies this company sends staff to.
export async function listClients(companyId: string) {
  return prisma.companyRelationship.findMany({
    where: { ownerCompanyId: companyId, agencyCompanyId: companyId },
    include: { clientCompany: true },
    orderBy: { createdAt: "asc" },
  });
}

// 派遣会社一覧 (from this company's perspective as the receiving/client side):
// companies that send staff to this company.
export async function listAgencies(companyId: string) {
  return prisma.companyRelationship.findMany({
    where: { ownerCompanyId: companyId, clientCompanyId: companyId },
    include: { agencyCompany: true },
    orderBy: { createdAt: "asc" },
  });
}

// "+ 取引先名簿を追加" -> 依頼主名簿: activates companyModules.agency and
// creates a proxy client relationship in one step (chat29's one-click flow).
export async function activateAgencyModuleWithProxyClient(params: {
  companyId: string;
  proxyName: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: params.companyId },
      data: { agencyEnabled: true },
    });
    return tx.companyRelationship.create({
      data: {
        ownerCompanyId: params.companyId,
        agencyCompanyId: params.companyId,
        clientCompanyId: null,
        proxyName: params.proxyName,
      },
    });
  });
}

// "+ 取引先名簿を追加" -> 派遣会社名簿: activates companyModules.dispatch and
// creates a proxy agency relationship in one step.
export async function activateDispatchModuleWithProxyAgency(params: {
  companyId: string;
  proxyName: string;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: params.companyId },
      data: { dispatchEnabled: true },
    });
    return tx.companyRelationship.create({
      data: {
        ownerCompanyId: params.companyId,
        clientCompanyId: params.companyId,
        agencyCompanyId: null,
        proxyName: params.proxyName,
      },
    });
  });
}

export async function addRealClient(params: { companyId: string; proxyName: string }) {
  return prisma.companyRelationship.create({
    data: {
      ownerCompanyId: params.companyId,
      agencyCompanyId: params.companyId,
      clientCompanyId: null,
      proxyName: params.proxyName,
    },
  });
}

export async function addRealAgency(params: { companyId: string; proxyName: string }) {
  return prisma.companyRelationship.create({
    data: {
      ownerCompanyId: params.companyId,
      clientCompanyId: params.companyId,
      agencyCompanyId: null,
      proxyName: params.proxyName,
    },
  });
}

// 「本アカウントを招待」で依頼主/派遣会社を追加する場合は、名前を入力させず
// 招待URLだけをその場で発行する — 相手が招待を受諾すれば相手の会社名がその
// まま関係の名前になるので、proxyNameは不要（null）。
export async function inviteNewClient(params: { companyId: string; createdByUserId: string }) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId } });
  if (!company.agencyEnabled) {
    await prisma.company.update({ where: { id: params.companyId }, data: { agencyEnabled: true } });
  }
  const rel = await prisma.companyRelationship.create({
    data: {
      ownerCompanyId: params.companyId,
      agencyCompanyId: params.companyId,
      clientCompanyId: null,
      proxyName: null,
    },
  });
  return inviteRelationshipUpgrade({
    companyRelationshipId: rel.id,
    companyId: params.companyId,
    createdByUserId: params.createdByUserId,
    kind: "CLIENT_UPGRADE",
  });
}

export async function inviteNewAgency(params: { companyId: string; createdByUserId: string }) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId } });
  if (!company.dispatchEnabled) {
    await prisma.company.update({ where: { id: params.companyId }, data: { dispatchEnabled: true } });
  }
  const rel = await prisma.companyRelationship.create({
    data: {
      ownerCompanyId: params.companyId,
      clientCompanyId: params.companyId,
      agencyCompanyId: null,
      proxyName: null,
    },
  });
  return inviteRelationshipUpgrade({
    companyRelationshipId: rel.id,
    companyId: params.companyId,
    createdByUserId: params.createdByUserId,
    kind: "AGENCY_UPGRADE",
  });
}

// 招待する: invite the proxy counterpart to link their own real company
// account to this relationship (CLIENT_UPGRADE / AGENCY_UPGRADE).
export async function inviteRelationshipUpgrade(params: {
  companyRelationshipId: string;
  companyId: string; // owner company issuing the invite
  createdByUserId: string;
  kind: "CLIENT_UPGRADE" | "AGENCY_UPGRADE";
}) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  return prisma.inviteToken.create({
    data: {
      token,
      kind: params.kind,
      companyId: params.companyId,
      companyRelationshipId: params.companyRelationshipId,
      createdByUserId: params.createdByUserId,
      expiresAt,
    },
  });
}

export async function setRelationshipStatus(params: {
  companyRelationshipId: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  return prisma.companyRelationship.update({
    where: { id: params.companyRelationshipId },
    data: { status: params.status },
  });
}

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

// 依頼主詳細パネルの稼働履歴タブ: 対象月のこの取引先向けシフト×業務報告を日付ごとにまとめる。
export async function getClientMonthDetail(params: {
  companyId: string;
  companyRelationshipId: string;
  year: number;
  month: number;
}) {
  const relationship = await prisma.companyRelationship.findFirstOrThrow({
    where: { id: params.companyRelationshipId, ownerCompanyId: params.companyId },
    include: { clientCompany: true, agencyCompany: true },
  });
  // 依頼主一覧（自社がagencyCompanyId側）なら相手はclientCompany、派遣会社
  // 一覧（自社がclientCompanyId側）なら相手はagencyCompany — PDF絞り込み
  // ラベルの向き判定と同じ考え方。
  const isClientDirection = relationship.agencyCompanyId === params.companyId;
  const counterpartCompany = isClientDirection ? relationship.clientCompany : relationship.agencyCompany;

  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  const [shifts, placementRates] = await Promise.all([
    prisma.shift.findMany({
      where: {
        companyId: params.companyId,
        companyRelationshipId: params.companyRelationshipId,
        date: { gte: start, lt: end },
        status: { notIn: ["SUPERSEDED", "CANCELLED"] },
      },
      include: { workReport: true, staff: true },
      orderBy: { date: "asc" },
    }),
    prisma.companyPlacementRate.findMany({
      where: { companyId: params.companyId, companyRelationshipId: params.companyRelationshipId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const staffMap = new Map<string, string>();
  for (const s of shifts) staffMap.set(s.staffUserId, s.staff.name);
  const unapprovedCount = shifts.filter((s) => s.workReport && s.workReport.approvalStatus !== "APPROVED").length;

  return {
    relationshipId: relationship.id,
    name: counterpartCompany?.name ?? relationship.proxyName ?? "",
    isProxy: !counterpartCompany,
    note: relationship.note ?? "",
    shiftCount: shifts.length,
    unapprovedCount,
    staff: Array.from(staffMap.entries()).map(([userId, name]) => ({ userId, name })),
    placementRates: placementRates.map((r) => ({
      id: r.id,
      taskName: r.taskName,
      amountLabel: `${WAGE_TYPE_LABEL[r.wageType]}${r.amount}円`,
    })),
    days: shifts.map((s) => ({
      shiftId: s.id,
      date: s.date.toISOString().slice(0, 10),
      staffName: s.staff.name,
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      isUndecided: s.isUndecided,
      approvalStatus: s.workReport?.approvalStatus ?? null,
    })),
  };
}

export async function updateClientNote(params: { companyRelationshipId: string; note: string }) {
  return prisma.companyRelationship.update({
    where: { id: params.companyRelationshipId },
    data: { note: params.note.trim() || null },
  });
}
