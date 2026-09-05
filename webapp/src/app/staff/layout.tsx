import { requireCompanyStaffRole, listMyMemberships } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getStaffPointsBalance } from "@/lib/domain/promo";
import { StaffShell } from "@/components/staff/StaffShell";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, membership } = await requireCompanyStaffRole();
  const [user, pointsBalance, myMemberships] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    getStaffPointsBalance(userId),
    listMyMemberships(userId),
  ]);

  return (
    <StaffShell
      companyName={membership.companyName}
      userName={user.name}
      userEmail={user.email}
      pointsBalance={pointsBalance}
      hasMultipleCompanies={myMemberships.length > 1}
      canReturnToCompany={membership.role !== "STAFF"}
    >
      {children}
    </StaffShell>
  );
}
