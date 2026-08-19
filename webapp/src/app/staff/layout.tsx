import { requireCompanyStaffRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getStaffPointsBalance } from "@/lib/domain/promo";
import { StaffShell } from "@/components/staff/StaffShell";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, membership } = await requireCompanyStaffRole();
  const [user, pointsBalance] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    getStaffPointsBalance(userId),
  ]);

  return (
    <StaffShell
      companyName={membership.companyName}
      userName={user.name}
      userEmail={user.email}
      pointsBalance={pointsBalance}
    >
      {children}
    </StaffShell>
  );
}
