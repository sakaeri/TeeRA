import "server-only";
import type { ActiveMembership } from "@/lib/auth/session";

// 決定事項（permission-rules-memo.md, reconfirmed chat21/chat29）:
// - 会社スコープ 管理者/編集者: 全社に対してフル権限。
// - チームスコープ マネージャー: 自チーム内では会社管理者/編集者と同等の権限
//   （請求書発行・給与計算を含む — 当初案の「全社スコープのみ」から明示的に拡張された）。
// - チームスコープ リーダー: 契約書・請求関連は閲覧のみ、発行・作成は不可。
// - スタッフ: 管理権限なし。

function isTeamManagerOf(membership: ActiveMembership, teamId: string) {
  return membership.teamMemberships.some(
    (tm) => tm.teamId === teamId && tm.role === "TEAM_MANAGER",
  );
}

function isTeamLeaderOf(membership: ActiveMembership, teamId: string) {
  return membership.teamMemberships.some(
    (tm) => tm.teamId === teamId && tm.role === "TEAM_LEADER",
  );
}

export function isCompanyScopeAdmin(membership: ActiveMembership) {
  return membership.role === "COMPANY_ADMIN" || membership.role === "COMPANY_EDITOR";
}

// Can create/edit/issue: roster, shifts, teams, contracts, payroll, invoices —
// within the given team if teamId is provided, or company-wide if omitted.
export function canManage(membership: ActiveMembership, teamId?: string | null) {
  if (isCompanyScopeAdmin(membership)) return true;
  if (teamId && isTeamManagerOf(membership, teamId)) return true;
  return false;
}

// Can view (but not create/edit/issue) contracts and billing documents.
export function canView(membership: ActiveMembership, teamId?: string | null) {
  if (canManage(membership, teamId)) return true;
  if (teamId && isTeamLeaderOf(membership, teamId)) return true;
  return false;
}

// スタッフ・取引先は複数チームに同時所属できるため、対象（給与計算の対象
// スタッフ、請求書の対象取引先など）の所属チームIDの配列に対して「いずれか
// のチームで権限があるか」を判定する版。
export function canManageAny(membership: ActiveMembership, teamIds: string[]) {
  if (isCompanyScopeAdmin(membership)) return true;
  return teamIds.some((teamId) => canManage(membership, teamId));
}

export function canViewAny(membership: ActiveMembership, teamIds: string[]) {
  if (isCompanyScopeAdmin(membership)) return true;
  return teamIds.some((teamId) => canView(membership, teamId));
}

// 会社スコープの管理者/編集者ではないが、いずれかのチームでマネージャー/
// リーダーを務めている（＝会社側の管理画面に入る資格がある）かどうか。
// 画面の入口ガード（requireCompanyAdminOrEditor）で使う — 個別の操作の
// 可否は各アクション側でcanManage/canView/canManageCompanySettingsが判定する。
export function hasAnyTeamManagementRole(membership: ActiveMembership) {
  return membership.teamMemberships.some((tm) => tm.role === "TEAM_MANAGER" || tm.role === "TEAM_LEADER");
}

// 自分がマネージャー/リーダーを務めるチームID一覧（会社スコープの管理者/
// 編集者は全社見えるので使わない — カレンダーのシフト表示絞り込み専用）。
export function myManagedOrLedTeamIds(membership: ActiveMembership) {
  return membership.teamMemberships
    .filter((tm) => tm.role === "TEAM_MANAGER" || tm.role === "TEAM_LEADER")
    .map((tm) => tm.teamId);
}

// Only company-scope admins/editors manage company-wide settings: modules
// (agency/dispatch toggles), team creation, company-scope member roles.
export function canManageCompanySettings(membership: ActiveMembership) {
  return isCompanyScopeAdmin(membership);
}

export function isStaff(membership: ActiveMembership) {
  return membership.role === "STAFF";
}
