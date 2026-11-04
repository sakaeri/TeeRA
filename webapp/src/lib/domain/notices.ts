import "server-only";
import { prisma } from "@/lib/prisma";
import { noteAttachmentView } from "@/lib/noteAttachments";

// スタッフ向けの一方向のお知らせ（例：個別単価の変更・終了）。同意は求めず、
// 既読管理のみ。給与計算はこれとは無関係に、シフト日付時点で有効な単価で
// 常に進む — お知らせは「伝えた」という記録を残すためのもの。
export async function createStaffNotice(params: { companyId: string; staffUserId: string; message: string }) {
  return prisma.staffNotice.create({ data: params });
}

// スタッフのお知らせ（所属している会社・派遣先の会社すべて）。新しい順に溜まっていく。
// 会社からのお知らせ（ダッシュボードで出したもの）はタイトル・本文・添付を、それ以外
// （単価の変更・募集の追加のお知らせなど）は本文の1行目をタイトルとして返す。
export async function listAllStaffNotices(staffUserId: string, options: { take?: number; unreadOnly?: boolean } = {}) {
  const rows = await prisma.staffNotice.findMany({
    where: { staffUserId, ...(options.unreadOnly ? { readAt: null } : {}) },
    include: {
      company: { select: { id: true, name: true } },
      companyAnnouncement: { include: { attachments: { orderBy: { createdAt: "asc" } } } },
    },
    orderBy: { createdAt: "desc" },
    take: options.take ?? 200,
  });
  return rows.map((n) => {
    const a = n.companyAnnouncement;
    // 「【見出し】本文」（募集の追加のお知らせ）は見出しをタイトルに、それ以外は1行目をタイトルに
    const lines = n.message.split("\n");
    const heading = lines[0].match(/^【([^】]*)】(.*)$/);
    const plainTitle = heading ? heading[1] : lines[0];
    const plainBody = [heading?.[2] ?? "", ...lines.slice(1)].filter((x) => x).join("\n");
    return {
      id: n.id,
      companyId: n.company.id,
      companyName: n.company.name,
      title: a ? a.title : plainTitle,
      body: a ? a.body : plainBody,
      attachments: a ? a.attachments.map((x) => noteAttachmentView(x)) : [],
      edited: Boolean(a?.editedAt),
      createdAt: n.createdAt.toISOString(),
      read: Boolean(n.readAt),
    };
  });
}

export async function countUnreadStaffNotices(staffUserId: string) {
  return prisma.staffNotice.count({ where: { staffUserId, readAt: null } });
}

// 「すべて既読にする」（会社で絞り込んでいるときはその会社の分だけ）
export async function markAllStaffNoticesRead(staffUserId: string, companyId?: string | null) {
  return prisma.staffNotice.updateMany({
    where: { staffUserId, readAt: null, ...(companyId ? { companyId } : {}) },
    data: { readAt: new Date() },
  });
}

export async function markStaffNoticeRead(id: string, staffUserId: string) {
  return prisma.staffNotice.updateMany({
    where: { id, staffUserId },
    data: { readAt: new Date() },
  });
}
