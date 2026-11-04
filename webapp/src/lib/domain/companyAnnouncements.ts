import "server-only";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { validateNoteAttachments, deleteNoteAttachmentFiles } from "@/lib/domain/noteAttachments";
import { noteAttachmentView, type NoteAttachmentInput } from "@/lib/noteAttachments";

// 会社からスタッフへのお知らせ。宛先は出した時点で決め、1人ずつStaffNoticeを作る
// （スタッフの「お知らせ」に溜まり、既読もそこで管理する）。出すと必ずプッシュ通知する。
//
// 宛先（audience）：
// ・ALL        全スタッフ＝自社スタッフ＋派遣スタッフ
// ・OWN        自社スタッフのみ（派遣会社から来ている人を除く）
// ・TEAMS      選んだチームのメンバー
// ・INDIVIDUAL 個別に選んだスタッフ
// 自社スタッフ＝スタッフ・兼務の管理者（仮アカウントは除く）。派遣スタッフ＝派遣会社から
// 自社に配属されているスタッフと、所属タグ（TeeRAを使っていない派遣会社）の付いたスタッフ。
export type AnnouncementAudience = "ALL" | "OWN" | "TEAMS" | "INDIVIDUAL";
export const ANNOUNCEMENT_AUDIENCES: AnnouncementAudience[] = ["ALL", "OWN", "TEAMS", "INDIVIDUAL"];

// 宛先の候補（個別に選ぶとき・宛先の判定に使う）
export async function listAnnouncementCandidates(companyId: string) {
  const [memberships, placements] = await Promise.all([
    prisma.companyMembership.findMany({
      where: { companyId, OR: [{ role: "STAFF" }, { canWorkShifts: true }], user: { isProxy: false } },
      select: { userId: true, viaAgencyRelationshipId: true, user: { select: { name: true } } },
    }),
    prisma.staffPlacement.findMany({
      where: {
        active: true,
        companyRelationship: { clientCompanyId: companyId, status: "ACTIVE" },
        staff: { isProxy: false },
      },
      select: { staffUserId: true, staff: { select: { name: true } } },
    }),
  ]);
  const byId = new Map<string, { userId: string; name: string; isAgency: boolean }>();
  for (const m of memberships) {
    byId.set(m.userId, { userId: m.userId, name: m.user.name, isAgency: Boolean(m.viaAgencyRelationshipId) });
  }
  for (const p of placements) {
    if (!byId.has(p.staffUserId)) byId.set(p.staffUserId, { userId: p.staffUserId, name: p.staff.name, isAgency: true });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export async function listAnnouncementRecipientIds(params: {
  companyId: string;
  audience: AnnouncementAudience;
  teamIds: string[];
  staffUserIds: string[];
}) {
  const candidates = await listAnnouncementCandidates(params.companyId);
  if (params.audience === "ALL") return candidates.map((c) => c.userId);
  if (params.audience === "OWN") return candidates.filter((c) => !c.isAgency).map((c) => c.userId);
  if (params.audience === "INDIVIDUAL") {
    const wanted = new Set(params.staffUserIds);
    return candidates.filter((c) => wanted.has(c.userId)).map((c) => c.userId);
  }
  const teamMembers = await prisma.teamMembership.findMany({
    where: { teamId: { in: params.teamIds }, team: { companyId: params.companyId } },
    select: { userId: true },
  });
  const inTeams = new Set(teamMembers.map((m) => m.userId));
  return candidates.filter((c) => inTeams.has(c.userId)).map((c) => c.userId);
}

function noticeMessage(title: string, body: string) {
  return body ? `【${title}】\n${body}` : `【${title}】`;
}

export async function createCompanyAnnouncement(params: {
  companyId: string;
  audience: AnnouncementAudience;
  teamIds: string[];
  staffUserIds: string[];
  title: string;
  body: string;
  attachments: NoteAttachmentInput[];
  createdByUserId: string;
}) {
  const title = params.title.trim();
  const body = params.body.trim();
  if (!title) throw new Error("title_required");
  const attachments = validateNoteAttachments(params.attachments);

  const recipientIds = await listAnnouncementRecipientIds(params);
  if (recipientIds.length === 0) throw new Error("no_recipients");
  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.companyAnnouncement.create({
      data: {
        companyId: params.companyId,
        audience: params.audience,
        teamIds: params.audience === "TEAMS" ? params.teamIds : [],
        staffUserIds: params.audience === "INDIVIDUAL" ? recipientIds : [],
        title,
        body,
        pushed: true,
        createdByUserId: params.createdByUserId,
        attachments: { create: attachments },
      },
    });
    await tx.staffNotice.createMany({
      data: recipientIds.map((staffUserId) => ({
        companyId: params.companyId,
        staffUserId,
        message: noticeMessage(title, body),
        companyAnnouncementId: created.id,
      })),
    });
    return created;
  });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { name: true } });
  await sendPushToUsers(recipientIds, { title: `${company.name}からのお知らせ`, body: title, url: "/staff/notices" });
  return { announcement, recipientCount: recipientIds.length };
}

// タイトル・本文・添付を直す。受け取ったスタッフのお知らせにもそのまま反映する
// （通知は送り直さず、既読もそのまま）。宛先は変えない。
export async function updateCompanyAnnouncement(params: {
  companyId: string;
  announcementId: string;
  title: string;
  body: string;
  attachments: NoteAttachmentInput[];
}) {
  const title = params.title.trim();
  const body = params.body.trim();
  if (!title) throw new Error("title_required");
  const attachments = validateNoteAttachments(params.attachments);
  const current = await prisma.companyAnnouncement.findFirstOrThrow({
    where: { id: params.announcementId, companyId: params.companyId },
    include: { attachments: true },
  });
  const keepUrls = new Set(attachments.map((a) => a.url));
  const removed = current.attachments.filter((a) => !keepUrls.has(a.url));
  const existingUrls = new Set(current.attachments.map((a) => a.url));
  const added = attachments.filter((a) => !existingUrls.has(a.url));

  await prisma.$transaction([
    prisma.companyAnnouncement.update({
      where: { id: current.id },
      data: { title, body, editedAt: new Date() },
    }),
    prisma.staffNotice.updateMany({
      where: { companyAnnouncementId: current.id },
      data: { message: noticeMessage(title, body) },
    }),
    prisma.noteAttachment.deleteMany({ where: { id: { in: removed.map((a) => a.id) } } }),
    prisma.noteAttachment.createMany({ data: added.map((a) => ({ ...a, companyAnnouncementId: current.id })) }),
  ]);
  await deleteNoteAttachmentFiles(removed.map((a) => a.url));
}

const AUDIENCE_LABEL: Record<string, string> = {
  ALL: "全スタッフ",
  OWN: "自社スタッフのみ",
  TEAMS: "チーム",
  INDIVIDUAL: "個別",
};

// 会社側の一覧（新しい順）。teamIdsは見る人がマネージャーのとき、そのチーム宛ての分だけに絞る
export async function listCompanyAnnouncements(companyId: string, restrictToTeamIds?: string[] | null) {
  const [rows, teams] = await Promise.all([
    prisma.companyAnnouncement.findMany({
      where: { companyId },
      include: { attachments: { orderBy: { createdAt: "asc" } }, notices: { select: { staffUserId: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.team.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  return rows
    .filter((r) => {
      if (!restrictToTeamIds) return true;
      const ids = (r.teamIds as string[]) ?? [];
      return r.audience === "TEAMS" && ids.length > 0 && ids.every((id) => restrictToTeamIds.includes(id));
    })
    .map((r) => {
      const ids = (r.teamIds as string[]) ?? [];
      const audienceLabel =
        r.audience === "TEAMS"
          ? ids.map((id) => teamName.get(id) ?? "削除したチーム").join("・")
          : r.audience === "INDIVIDUAL"
            ? `個別（${r.notices.length}人）`
            : (AUDIENCE_LABEL[r.audience] ?? "全スタッフ");
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        audienceLabel,
        createdAt: r.createdAt.toISOString(),
        edited: Boolean(r.editedAt),
        attachments: r.attachments.map((a) => ({
          url: a.url,
          fileName: a.fileName,
          contentType: a.contentType,
          size: a.size,
          view: noteAttachmentView(a),
        })),
      };
    });
}

export async function deleteCompanyAnnouncement(companyId: string, announcementId: string) {
  const current = await prisma.companyAnnouncement.findFirst({
    where: { id: announcementId, companyId },
    include: { attachments: true },
  });
  if (!current) return;
  await prisma.companyAnnouncement.delete({ where: { id: current.id } });
  await deleteNoteAttachmentFiles(current.attachments.map((a) => a.url));
}
