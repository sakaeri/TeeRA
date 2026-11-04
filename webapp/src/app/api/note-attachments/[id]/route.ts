import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { canManageCompanySettings, hasAnyTeamManagementRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

// 社内メモの添付ファイル（画像・PDF）を返す。メモを見られる人にだけ返す：
// ・スタッフの社内メモ — そのスタッフの会社で社内メモを扱える人（本部の管理者・編集者）
// ・取引先の社内メモ — 書いた会社で社内メモを扱える人。スタッフにも共有しているメモは、
//   その勤務先に配属されているスタッフ本人も
// ・スタッフへのお知らせ — 受け取ったスタッフ本人と、出した会社の管理者・編集者・マネージャー
export async function GET(_request: Request, { params }: RouteContext<"/api/note-attachments/[id]">) {
  const { id } = await params;
  const { userId } = await verifySession();
  const attachment = await prisma.noteAttachment.findUnique({
    where: { id },
    include: { staffNote: { include: { membership: true } }, relationshipNote: true, companyAnnouncement: true },
  });
  if (!attachment) return new Response("not found", { status: 404 });

  const membership = await getActiveMembership(userId);
  const canManageNotesOf = (companyId: string) =>
    !!membership && membership.companyId === companyId && canManageCompanySettings(membership);

  let allowed = false;
  if (attachment.staffNote) {
    allowed = canManageNotesOf(attachment.staffNote.membership.companyId);
  } else if (attachment.relationshipNote) {
    const note = attachment.relationshipNote;
    allowed = canManageNotesOf(note.companyId);
    if (!allowed && note.visibleToStaff) {
      const placement = await prisma.staffPlacement.findFirst({
        where: { companyRelationshipId: note.companyRelationshipId, staffUserId: userId, active: true },
      });
      allowed = !!placement;
    }
  } else if (attachment.companyAnnouncement) {
    const announcement = attachment.companyAnnouncement;
    allowed =
      !!membership &&
      membership.companyId === announcement.companyId &&
      (canManageCompanySettings(membership) || hasAnyTeamManagementRole(membership));
    if (!allowed) {
      const notice = await prisma.staffNotice.findFirst({
        where: { companyAnnouncementId: announcement.id, staffUserId: userId },
        select: { id: true },
      });
      allowed = !!notice;
    }
  }
  if (!allowed) return new Response("forbidden", { status: 403 });

  const upstream = await fetch(attachment.url);
  if (!upstream.ok || !upstream.body) return new Response("not found", { status: 404 });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
