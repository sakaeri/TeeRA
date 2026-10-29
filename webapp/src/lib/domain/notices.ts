import "server-only";
import { prisma } from "@/lib/prisma";

// スタッフ向けの一方向のお知らせ（例：個別単価の変更・終了）。同意は求めず、
// 既読管理のみ。給与計算はこれとは無関係に、シフト日付時点で有効な単価で
// 常に進む — お知らせは「伝えた」という記録を残すためのもの。
export async function createStaffNotice(params: { companyId: string; staffUserId: string; message: string }) {
  return prisma.staffNotice.create({ data: params });
}

// 所属会社からのお知らせは、その会社を開いている時だけ出す。所属していない
// 会社からのお知らせ（派遣先の依頼主が出した募集のお知らせなど）は、どの
// 会社を開いていても出す（そうしないと見る場所がないため）。
export async function listStaffNotices(staffUserId: string, activeCompanyId: string, memberCompanyIds: string[]) {
  return prisma.staffNotice.findMany({
    where: {
      staffUserId,
      OR: [{ companyId: activeCompanyId }, { companyId: { notIn: memberCompanyIds } }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

export async function markStaffNoticeRead(id: string, staffUserId: string) {
  return prisma.staffNotice.updateMany({
    where: { id, staffUserId },
    data: { readAt: new Date() },
  });
}
