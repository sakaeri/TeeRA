import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { CompanyRole } from "@/generated/prisma/enums";
import { hasAnyTeamManagementRole } from "@/lib/auth/permissions";

// 「今どの会社として動いているか」を覚えておくCookie。署名や暗号化は
// していない — 実際の認可は毎回DBで「このuserIdがこのcompanyIdに本当に
// 所属しているか」を検証するので、値を書き換えられても実害はない
// （単なるUI上の好みの記憶でしかない）。
export const ACTIVE_COMPANY_COOKIE = "active_company_id";

export const verifySession = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return { userId: session.user.id };
});

export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({ where: { id: session.user.id } });
});

export type ActiveMembership = {
  companyId: string;
  companyName: string;
  role: CompanyRole;
  canWorkShifts: boolean;
  teamMemberships: { teamId: string; teamName: string; role: string }[];
};

// 複数社に所属できるようになった（元は1ユーザー1社固定だったが、ダブル
// ワーク・兼務に対応するため解禁 — permission-plan参照）。「今どの会社として
// 動いているか」はactive_company_idクッキーで覚えておき、有効なら最優先で
// 使う。クッキーが無い/無効（未所属の会社を指している等）なら、これまで
// 通り最後に所属した会社にフォールバックする — 所属が1件しか無い既存の
// ユーザーには一切挙動の変化が無い。
export const getActiveMembership = cache(
  async (userId: string): Promise<ActiveMembership | null> => {
    const store = await cookies();
    const preferredCompanyId = store.get(ACTIVE_COMPANY_COOKIE)?.value;

    const membership =
      (preferredCompanyId
        ? await prisma.companyMembership.findFirst({
            where: { userId, companyId: preferredCompanyId },
            include: { company: true },
          })
        : null) ??
      (await prisma.companyMembership.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { company: true },
      }));
    if (!membership) return null;

    const teamMemberships = await prisma.teamMembership.findMany({
      where: { userId, team: { companyId: membership.companyId } },
      include: { team: true },
    });

    return {
      companyId: membership.companyId,
      companyName: membership.company.name,
      role: membership.role,
      canWorkShifts: membership.canWorkShifts,
      teamMemberships: teamMemberships.map((tm) => ({
        teamId: tm.teamId,
        teamName: tm.team.name,
        role: tm.role,
      })),
    };
  },
);

// 所属している全ての会社一覧（会社切替UI・/homeの選択画面用）。
export async function listMyMemberships(userId: string) {
  const memberships = await prisma.companyMembership.findMany({
    where: { userId },
    include: { company: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    companyId: m.companyId,
    companyName: m.company.name,
    role: m.role,
  }));
}

export async function requireActiveMembership() {
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  if (!membership) {
    redirect("/register/company");
  }
  return { userId, membership };
}

// role=STAFFの人はもちろん、role=STAFFではない管理者/編集者でも
// canWorkShifts=trueなら通す（同じ会社内での兼務 — 自分もシフトに入って
// 稼働するケース。タイムカード・業務報告はシフトの所有者チェックだけで
// 動いており、role自体は見ていないのでこれだけで安全に機能する）。
export async function requireCompanyStaffRole() {
  const { userId, membership } = await requireActiveMembership();
  if (membership.role !== "STAFF" && !membership.canWorkShifts) {
    redirect("/company");
  }
  return { userId, membership };
}

// 会社側の管理画面（/company/*）に入れるかどうかの入口ゲート。会社スコープの
// 管理者/編集者に加えて、チームマネージャー/リーダー（会社スコープ上は
// role=STAFFのまま、TeamMembership側の役職として持つ）も通す。関数名は元の
// 「本部管理者/編集者のみ」時代のまま残しているが、実際にどの操作ができる
// かは各画面・各アクション側のcanManage/canManageShifts/canManageCompanySettings
// が個別に判定する（会社スコープ限定の操作はそちらで引き続き弾かれる）。
export async function requireCompanyAdminOrEditor() {
  const { userId, membership } = await requireActiveMembership();
  if (membership.role === "STAFF" && !hasAnyTeamManagementRole(membership)) {
    redirect("/staff");
  }
  return { userId, membership };
}
