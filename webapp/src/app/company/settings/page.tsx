import Link from "next/link";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listTeams } from "@/lib/domain/teams";
import { listStaff } from "@/lib/domain/roster";
import { SettingsView } from "@/components/company/SettingsView";

export default async function SettingsPage() {
  const { membership } = await requireCompanyAdminOrEditor();

  const [company, admins, teams, staff] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
    prisma.companyMembership.findMany({
      where: {
        companyId: membership.companyId,
        role: { in: ["COMPANY_ADMIN", "COMPANY_EDITOR"] },
      },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    listTeams(membership.companyId),
    listStaff(membership.companyId),
  ]);

  const menu = [
    { href: "/company/workreports", label: "業務報告" },
    { href: "/company/contracts", label: "雇用契約書管理" },
    { href: "/company/payroll", label: "給与計算" },
    ...(company.agencyEnabled ? [{ href: "/company/invoices", label: "請求書" }] : []),
    { href: "/company/wallet", label: "Tee残高" },
    { href: "/company/promo", label: "販促品" },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">設定</h1>

      <section className="mb-10 rounded-2xl border border-border bg-white/60 p-6">
        <h2 className="mb-4 font-serif-jp text-lg font-bold text-primary">管理メニュー</h2>
        <div className="grid grid-cols-3 gap-3">
          {menu.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl border border-border bg-background px-4 py-3 text-sm hover:border-primary hover:text-primary"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      <SettingsView
        companyName={company.name}
        invoiceRegistrationNumber={company.invoiceRegistrationNumber ?? ""}
        address={company.address ?? ""}
        phoneNumber={company.phoneNumber ?? ""}
        admins={admins.map((a) => ({
          userId: a.userId,
          name: a.user.name,
          email: a.user.email,
          role: a.role as "COMPANY_ADMIN" | "COMPANY_EDITOR",
        }))}
        teams={teams.map((t) => ({
          id: t.id,
          name: t.name,
          members: t.memberships.map((m) => ({
            userId: m.userId,
            name: m.user.name,
            role: m.role,
          })),
        }))}
        staff={staff.map((s) => ({ userId: s.userId, name: s.name }))}
      />
    </main>
  );
}
