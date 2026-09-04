import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resolveRateVersion } from "@/lib/domain/contracts";

// 依頼主一覧 (from this company's perspective as the sending/agency side):
// companies this company sends staff to. ownerCompanyIdでは絞らない —
// 関係を作った側でなくても、自分がagencyCompanyId側として紐づいて
// いれば見える（本アカウント連携の意味を持たせるための双方向可視化）。
export async function listClients(companyId: string) {
  return prisma.companyRelationship.findMany({
    where: { agencyCompanyId: companyId },
    include: { clientCompany: true },
    orderBy: { createdAt: "asc" },
  });
}

// 派遣会社一覧 (from this company's perspective as the receiving/client side):
// companies that send staff to this company. 同上、ownerCompanyIdでは絞らない。
export async function listAgencies(companyId: string) {
  return prisma.companyRelationship.findMany({
    where: { clientCompanyId: companyId },
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

// 招待する: invite the proxy counterpart to link their own real company
// account to this relationship (CLIENT_UPGRADE / AGENCY_UPGRADE).
// companyRelationshipIdを省略した場合は「本アカウントを招待」で新規に関係を
// 作る場合 — まだ関係(CompanyRelationship)自体は存在せず、招待が実際に
// 相手に受諾された時点(redeemCompanyRelationshipInvite)で初めて作成される。
// 招待を発行しただけでは名簿には何も現れない。
export async function inviteRelationshipUpgrade(params: {
  companyRelationshipId?: string;
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

// 取引先/派遣会社情報の削除 — 間違えて仮アカウントを二重作成してしまった
// 場合の取り消し用（deleteStaffと同じ考え方）。本アカウントと連携済み
// （相手企業が紐づいている）関係、および稼働実績（シフト・請求書・配属）が
// 一件でもある関係は対象外。単価テーブルや契約書テンプレート、チームとの
// 紐付けは単なる設定情報なのでブロックせずcascadeで一緒に消える
// （schema.prisma参照）。
export async function deleteCompanyRelationship(params: { companyId: string; companyRelationshipId: string }) {
  const relationship = await prisma.companyRelationship.findFirstOrThrow({
    where: { id: params.companyRelationshipId, ownerCompanyId: params.companyId },
  });
  // 依頼主一覧なら自社がagencyCompanyId側、相手はclientCompanyId — その逆が
  // 派遣会社一覧。getClientMonthDetailのisProxy判定と同じ考え方。
  const isClientDirection = relationship.agencyCompanyId === params.companyId;
  const counterpartCompanyId = isClientDirection ? relationship.clientCompanyId : relationship.agencyCompanyId;
  if (counterpartCompanyId) throw new Error("not_proxy");

  const [shiftCount, invoiceCount, placementCount] = await Promise.all([
    prisma.shift.count({ where: { companyRelationshipId: params.companyRelationshipId } }),
    prisma.invoice.count({ where: { companyRelationshipId: params.companyRelationshipId } }),
    prisma.staffPlacement.count({ where: { companyRelationshipId: params.companyRelationshipId } }),
  ]);
  if (shiftCount > 0 || invoiceCount > 0 || placementCount > 0) throw new Error("has_activity");

  await prisma.companyRelationship.delete({ where: { id: params.companyRelationshipId } });
}

// 関係の当事者（オーナー or 本アカウント連携済みの相手）かどうかを確認する
// — 双方向可視化に伴い、オーナー限定にすべきでない操作（配属解除など）は
// こちらを使う。オーナー限定の操作（単価設定・チーム紐付け・関係の削除）は
// 引き続きownerCompanyIdでのチェックを使うこと。
export async function assertRelationshipParty(companyRelationshipId: string, companyId: string) {
  const relationship = await prisma.companyRelationship.findFirst({
    where: {
      id: companyRelationshipId,
      OR: [{ agencyCompanyId: companyId }, { clientCompanyId: companyId }],
    },
  });
  if (!relationship) throw new Error("forbidden");
  return relationship;
}

// 配属解除（出禁）— 行は消さずactive=false・endedAtを記録するだけ。オーダー
// への再エントリー不可はisStaffEligibleForRecruitment等の読み取り側が
// active=trueだけを見ることで自然に成立する。再配属（シフト作成/オーダー
// アサインでの自動配属）は同じ行をactive=trueに戻すので、説得して出禁を
// 解除する運用も特別な操作なしでそのまま成立する。
export async function unplaceStaff(params: { companyRelationshipId: string; staffUserId: string }) {
  await prisma.staffPlacement.updateMany({
    where: { companyRelationshipId: params.companyRelationshipId, staffUserId: params.staffUserId, active: true },
    data: { active: false, endedAt: new Date() },
  });
}

const WAGE_TYPE_LABEL: Record<string, string> = { HOURLY: "時給", DAILY: "日給", MONTHLY: "月給" };

// 依頼主詳細パネルの稼働履歴タブ: 対象月のこの取引先向けシフト×業務報告を日付ごとにまとめる。
// companyIdは「自社」であればよく、関係を作った側(ownerCompanyId)である
// 必要はない — 本アカウント連携済みの相手側からも同じ関係が見える
// （listClients/listAgenciesの双方向可視化と対になる仕様）。
export async function getClientMonthDetail(params: {
  companyId: string;
  companyRelationshipId: string;
  year: number;
  month: number;
}) {
  const relationship = await prisma.companyRelationship.findFirstOrThrow({
    where: {
      id: params.companyRelationshipId,
      OR: [{ agencyCompanyId: params.companyId }, { clientCompanyId: params.companyId }],
    },
    include: { clientCompany: true, agencyCompany: true },
  });
  // 依頼主一覧（自社がagencyCompanyId側）なら相手はclientCompany、派遣会社
  // 一覧（自社がclientCompanyId側）なら相手はagencyCompany — PDF絞り込み
  // ラベルの向き判定と同じ考え方。
  const isClientDirection = relationship.agencyCompanyId === params.companyId;
  const counterpartCompany = isClientDirection ? relationship.clientCompany : relationship.agencyCompany;
  // シフト・単価は常に派遣元（agencyCompanyId）が作成する — 依頼主側の
  // 本アカウントから見ている場合はparams.companyIdと一致しないので、
  // 関係自体が持つagencyCompanyIdで絞る（自社/相手を問わず正しく引ける）。
  const shiftOwnerCompanyId = relationship.agencyCompanyId;

  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  // shiftOwnerCompanyId未リンク（相手がまだ仮アカウントのまま）だと
  // シフト・単価はまだ一件も存在し得ないので、クエリせず空のまま返す。
  const [shifts, placementRates, placements] = await Promise.all([
    shiftOwnerCompanyId
      ? prisma.shift.findMany({
          where: {
            companyId: shiftOwnerCompanyId,
            companyRelationshipId: params.companyRelationshipId,
            date: { gte: start, lt: end },
            status: { notIn: ["SUPERSEDED", "CANCELLED"] },
          },
          include: { workReport: true, staff: true },
          orderBy: { date: "asc" },
        })
      : [],
    shiftOwnerCompanyId
      ? prisma.companyPlacementRate.findMany({
          where: { companyId: shiftOwnerCompanyId, companyRelationshipId: params.companyRelationshipId },
          include: { versions: { orderBy: { effectiveFrom: "desc" } } },
          orderBy: { createdAt: "asc" },
        })
      : [],
    prisma.staffPlacement.findMany({
      where: { companyRelationshipId: params.companyRelationshipId },
      include: { staff: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const staffMap = new Map<string, string>();
  for (const s of shifts) staffMap.set(s.staffUserId, s.staff.name);
  const unapprovedCount = shifts.filter((s) => s.workReport && s.workReport.approvalStatus !== "APPROVED").length;
  const today = new Date();
  const relationshipNotes = await listRelationshipNotes(params.companyRelationshipId);
  const teamLinks = await prisma.teamClientRelationship.findMany({
    where: { companyRelationshipId: params.companyRelationshipId, team: { companyId: params.companyId } },
    include: { team: true },
  });

  return {
    relationshipId: relationship.id,
    name: counterpartCompany?.name ?? relationship.proxyName ?? "",
    isProxy: !counterpartCompany,
    teams: teamLinks.map((l) => ({ teamId: l.teamId, teamName: l.team.name })),
    placements: placements.map((p) => ({
      staffUserId: p.staffUserId,
      staffName: p.staff.name,
      active: p.active,
      startedAt: p.createdAt.toISOString().slice(0, 10),
      endedAt: p.endedAt ? p.endedAt.toISOString().slice(0, 10) : null,
    })),
    relationshipNotes: relationshipNotes.map((n) => ({
      id: n.id,
      content: n.content,
      authorName: n.author.name,
      createdAt: n.createdAt.toISOString().slice(0, 10),
    })),
    shiftCount: shifts.length,
    unapprovedCount,
    staff: Array.from(staffMap.entries()).map(([userId, name]) => ({ userId, name })),
    placementRates: placementRates.map((r) => {
      const current = resolveRateVersion(r.versions, today);
      return {
        id: r.id,
        taskName: r.taskName,
        currentLabel: current ? `${WAGE_TYPE_LABEL[current.wageType]}${current.amount}円` : "単価未設定",
        versions: r.versions.map((v) => ({
          id: v.id,
          label: v.wageType && v.amount != null ? `${WAGE_TYPE_LABEL[v.wageType]}${v.amount}円` : "単価未設定（終了）",
          effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
        })),
      };
    }),
    days: shifts.map((s) => ({
      shiftId: s.id,
      date: s.date.toISOString().slice(0, 10),
      staffName: s.staff.name,
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      isUndecided: s.isUndecided,
      approvalStatus: s.workReport?.approvalStatus ?? null,
      taskName: s.workReport?.taskName ?? s.taskName,
    })),
  };
}

// 情報メモ: StaffNoteと同じく、誰がいつ書いたか分かるよう追記式の一覧で
// 持つ。更新はなく、削除のみ（誤記は削除して書き直す）。
export async function listRelationshipNotes(companyRelationshipId: string) {
  return prisma.relationshipNote.findMany({
    where: { companyRelationshipId },
    include: { author: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function addRelationshipNote(params: { companyRelationshipId: string; authorUserId: string; content: string }) {
  const content = params.content.trim();
  if (!content) throw new Error("empty_content");
  return prisma.relationshipNote.create({
    data: { companyRelationshipId: params.companyRelationshipId, authorUserId: params.authorUserId, content },
  });
}

export async function deleteRelationshipNote(id: string) {
  return prisma.relationshipNote.delete({ where: { id } });
}
