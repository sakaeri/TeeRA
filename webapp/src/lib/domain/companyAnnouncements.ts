import "server-only";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";

// 会社からスタッフへのお知らせ。宛先は出した時点で決め、1人ずつStaffNoticeを作る
// （スタッフのホームの「お知らせ」に出て、既読もそこで管理する）。
//
// 宛先：
// ・自社スタッフ（スタッフ・兼務の管理者）。チームを選んだときはそのチームのメンバーだけ
// ・派遣スタッフ（includeAgencyStaff）：派遣会社から自社に配属されているスタッフ、
//   TeeRAを使っていない派遣会社から来ている（所属タグの付いた）スタッフ
export async function listAnnouncementRecipientIds(params: {
  companyId: string;
  teamId: string | null;
  includeAgencyStaff: boolean;
}) {
  const teamMemberIds = params.teamId
    ? new Set(
        (await prisma.teamMembership.findMany({ where: { teamId: params.teamId }, select: { userId: true } })).map(
          (m) => m.userId,
        ),
      )
    : null;

  const memberships = await prisma.companyMembership.findMany({
    where: {
      companyId: params.companyId,
      OR: [{ role: "STAFF" }, { canWorkShifts: true }],
      user: { isProxy: false },
    },
    select: { userId: true, viaAgencyRelationshipId: true },
  });
  const ids = new Set<string>();
  for (const m of memberships) {
    const isAgencyTagged = Boolean(m.viaAgencyRelationshipId);
    if (isAgencyTagged ? !params.includeAgencyStaff : teamMemberIds && !teamMemberIds.has(m.userId)) continue;
    ids.add(m.userId);
  }

  if (params.includeAgencyStaff) {
    const placements = await prisma.staffPlacement.findMany({
      where: {
        active: true,
        companyRelationship: { clientCompanyId: params.companyId, status: "ACTIVE" },
        staff: { isProxy: false },
      },
      select: { staffUserId: true },
    });
    for (const p of placements) ids.add(p.staffUserId);
  }
  return [...ids];
}

export async function createCompanyAnnouncement(params: {
  companyId: string;
  teamId: string | null;
  title: string;
  body: string;
  includeAgencyStaff: boolean;
  push: boolean;
  expiresOn: Date | null;
  createdByUserId: string;
}) {
  const title = params.title.trim();
  const body = params.body.trim();
  if (!title) throw new Error("title_required");

  const recipientIds = await listAnnouncementRecipientIds(params);
  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.companyAnnouncement.create({
      data: {
        companyId: params.companyId,
        teamId: params.teamId,
        title,
        body,
        includeAgencyStaff: params.includeAgencyStaff,
        pushed: params.push,
        expiresOn: params.expiresOn,
        createdByUserId: params.createdByUserId,
      },
    });
    await tx.staffNotice.createMany({
      data: recipientIds.map((staffUserId) => ({
        companyId: params.companyId,
        staffUserId,
        message: body ? `【${title}】\n${body}` : `【${title}】`,
        companyAnnouncementId: created.id,
      })),
    });
    return created;
  });

  if (params.push && recipientIds.length > 0) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { name: true } });
    await sendPushToUsers(recipientIds, {
      title: `${company.name}からのお知らせ`,
      body: title,
      url: "/staff",
    });
  }
  return { announcement, recipientCount: recipientIds.length };
}

// 会社側の一覧（新しい順）。既読の人数も出す。
export async function listCompanyAnnouncements(companyId: string, restrictToTeamIds?: string[] | null) {
  const rows = await prisma.companyAnnouncement.findMany({
    where: {
      companyId,
      ...(restrictToTeamIds ? { teamId: { in: restrictToTeamIds } } : {}),
    },
    include: {
      team: { select: { name: true } },
      notices: { select: { readAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    teamId: r.teamId,
    teamName: r.team?.name ?? null,
    includeAgencyStaff: r.includeAgencyStaff,
    pushed: r.pushed,
    expiresOn: r.expiresOn?.toISOString().slice(0, 10) ?? null,
    createdAt: r.createdAt.toISOString(),
    recipientCount: r.notices.length,
    readCount: r.notices.filter((n) => n.readAt).length,
  }));
}

export async function deleteCompanyAnnouncement(companyId: string, announcementId: string) {
  await prisma.companyAnnouncement.deleteMany({ where: { id: announcementId, companyId } });
}
