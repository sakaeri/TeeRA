import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { hasAnyTeamManagementRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getStaffPointsBalance } from "@/lib/domain/promo";
import { listOpenRecruitmentsForStaff } from "@/lib/domain/recruitment";
import { StaffShell } from "@/components/staff/StaffShell";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, membership } = await requireCompanyStaffRole();
  const [user, pointsBalance, myMemberships, openRecruitments, pendingContractCount, unreadNoticeCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    getStaffPointsBalance(userId),
    listMyMemberships(userId),
    listOpenRecruitmentsForStaff({ companyId: membership.companyId, staffUserId: userId }),
    prisma.staffContract.count({
      where: { staffUserId: userId, status: "PENDING_CONSENT", template: { companyId: membership.companyId } },
    }),
    prisma.staffNotice.count({
      where: { staffUserId: userId, companyId: membership.companyId, readAt: null },
    }),
  ]);
  // ナビの「募集一覧」バッジ用 — まだ応募しておらず、まだ枠が埋まって
  // いない募集だけを数える（応募済み/満員は「新着」として知らせる
  // 意味が無いため）。
  const openRecruitmentCount = openRecruitments.filter((r) => {
    const filled = r.entries.filter((e) => e.status !== "REJECTED").length;
    const alreadyApplied = r.entries.some((e) => e.staffUserId === userId && e.status !== "REJECTED");
    return !alreadyApplied && filled < r.maxEntries;
  }).length;
  // ナビの「設定」バッジ用 — 契約書未確認（同意待ち）＋単価変更などの未読
  // お知らせの合算。設定を開かないと新着に気づけない問題への対応。
  const contractSettingsBadgeCount = pendingContractCount + unreadNoticeCount;

  return (
    <StaffShell
      userName={user.name}
      userEmail={user.email}
      pointsBalance={pointsBalance}
      hasMultipleCompanies={myMemberships.length > 1}
      showCompanyScreenLink={membership.role !== "STAFF" || hasAnyTeamManagementRole(membership)}
      openRecruitmentCount={openRecruitmentCount}
      contractSettingsBadgeCount={contractSettingsBadgeCount}
    >
      {children}
    </StaffShell>
  );
}
