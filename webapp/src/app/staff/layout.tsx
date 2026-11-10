import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { hasAnyTeamManagementRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { getStaffPointsBalance } from "@/lib/domain/promo";
import { listOpenRecruitmentsForStaff } from "@/lib/domain/recruitment";
import { countUnsubmittedReports } from "@/lib/domain/workReports";
import { countUnreadStaffNotices } from "@/lib/domain/notices";
import { StaffShell } from "@/components/staff/StaffShell";
import { listContractorCompanies } from "@/lib/domain/staffInvoices";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, membership } = await requireCompanyStaffRole();
  const [user, pointsBalance, myMemberships, openRecruitments, pendingContracts, unreadNoticeCount, contractorCompanies] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    getStaffPointsBalance(userId),
    listMyMemberships(userId),
    listOpenRecruitmentsForStaff({ companyId: membership.companyId, staffUserId: userId }),
    // 確認待ちの契約書（所属する全社分）。会社ごとにまとめてポップアップで知らせる
    prisma.staffContract.findMany({
      where: { staffUserId: userId, status: "PENDING_CONSENT" },
      select: { template: { select: { company: { select: { id: true, name: true } } } } },
    }),
    countUnreadStaffNotices(userId),
    listContractorCompanies(userId),
  ]);
  // ナビの「募集一覧」バッジ用 — まだ応募しておらず、まだ枠が埋まって
  // いない募集だけを数える（応募済み/満員は「新着」として知らせる
  // 意味が無いため）。
  const openRecruitmentCount = openRecruitments.filter((r) => {
    const filled = r.entries.filter((e) => e.status !== "REJECTED").length;
    const alreadyApplied = r.entries.some((e) => e.staffUserId === userId && e.status !== "REJECTED");
    return !alreadyApplied && filled < r.maxEntries;
  }).length;
  // ナビの「設定」バッジ用 — 契約書未確認（同意待ち）の件数。
  // お知らせの未読は「お知らせ」のバッジに出す（所属する全社分）。
  const pendingContractCount = pendingContracts.length;
  const contractSettingsBadgeCount = pendingContractCount;
  const pendingContractCompanies = [
    ...new Map(pendingContracts.map((c) => [c.template.company.id, c.template.company])).values(),
  ];
  // ナビの「タイムカード」バッジ用 — 業務報告が未提出の件数（所属する全社分）
  const unsubmittedReportCount = await countUnsubmittedReports(
    userId,
    myMemberships.map((m) => m.companyId),
  );

  return (
    <StaffShell
      userName={user.name}
      userEmail={user.email}
      pointsBalance={pointsBalance}
      hasMultipleCompanies={myMemberships.length > 1}
      showCompanyScreenLink={membership.role !== "STAFF" || hasAnyTeamManagementRole(membership)}
      openRecruitmentCount={openRecruitmentCount}
      unsubmittedReportCount={unsubmittedReportCount}
      contractSettingsBadgeCount={contractSettingsBadgeCount}
      unreadNoticeCount={unreadNoticeCount}
      pendingContractCompanies={pendingContractCompanies}
      isContractor={contractorCompanies.length > 0}
    >
      {children}
    </StaffShell>
  );
}
