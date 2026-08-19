import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CompanyShell } from "@/components/company/CompanyShell";

const ROLE_LABEL: Record<string, string> = {
  COMPANY_ADMIN: "本部：管理者として表示",
  COMPANY_EDITOR: "本部：編集者として表示",
};

export default async function CompanyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  const [company, user] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
  ]);

  return (
    <CompanyShell
      companyName={company.name}
      userName={user.name}
      userEmail={user.email}
      roleLabel={ROLE_LABEL[membership.role] ?? membership.role}
      teeBalance={company.teeBalance}
    >
      {children}
    </CompanyShell>
  );
}
