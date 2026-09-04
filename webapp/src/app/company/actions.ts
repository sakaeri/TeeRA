"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage, canManageCompanySettings } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  inviteStaff,
  inviteTeamManager,
  createProxyStaff,
  deleteStaff,
  inviteProxyUpgrade,
  getStaffMonthDetail,
  addStaffNote,
  deleteStaffNote,
  updateMembershipIdDocument,
  updateMembershipBankInfo,
} from "@/lib/domain/roster";
import {
  activateAgencyModuleWithProxyClient,
  activateDispatchModuleWithProxyAgency,
  addRealClient,
  addRealAgency,
  inviteRelationshipUpgrade,
  getClientMonthDetail,
  addRelationshipNote,
  deleteRelationshipNote,
  deleteCompanyRelationship,
  assertRelationshipParty,
  unplaceStaff,
} from "@/lib/domain/relationships";
import {
  createTeam,
  setTeamMemberRole,
  removeTeamMember,
  setCompanyMemberRole,
  addTeamClient,
  removeTeamClient,
  setStaffPlainTeamMemberships,
  setClientTeams,
} from "@/lib/domain/teams";

function absoluteInviteUrl(token: string) {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}/invite/${token}`;
}

export async function inviteStaffAction(
  teamId?: string,
  contractTemplateId?: string,
  contractStartDate?: string,
) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership, teamId)) throw new Error("forbidden");

  const invite = await inviteStaff({
    companyId: membership.companyId,
    createdByUserId: userId,
    teamId,
    contractTemplateId,
    contractStartDate: contractStartDate ? new Date(`${contractStartDate}T00:00:00.000Z`) : undefined,
  });
  revalidatePath("/company/roster");
  return absoluteInviteUrl(invite.token);
}

export async function createProxyStaffAction(name: string, teamId?: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership, teamId)) throw new Error("forbidden");

  await createProxyStaff({
    companyId: membership.companyId,
    createdByUserId: userId,
    name,
    teamId,
  });
  revalidatePath("/company/roster");
}

// 仮アカウントの二重作成など、間違って作ってしまったスタッフ情報の削除。
// 本アカウント・稼働実績のある仮アカウントはdeleteStaff側で弾かれる。
export async function deleteStaffAction(staffUserId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  try {
    await deleteStaff({ companyId: membership.companyId, staffUserId });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unknown" };
  }
  revalidatePath("/company/roster");
  return { error: null };
}

export async function inviteProxyUpgradeAction(proxyUserId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManage(membership)) throw new Error("forbidden");

  const invite = await inviteProxyUpgrade({
    proxyUserId,
    companyId: membership.companyId,
    createdByUserId: userId,
  });
  return absoluteInviteUrl(invite.token);
}

export async function addClientAction(proxyName: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: membership.companyId },
  });
  if (!company.agencyEnabled) {
    await activateAgencyModuleWithProxyClient({
      companyId: membership.companyId,
      proxyName,
    });
  } else {
    await addRealClient({ companyId: membership.companyId, proxyName });
  }
  revalidatePath("/company/roster");
}

export async function addAgencyAction(proxyName: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: membership.companyId },
  });
  if (!company.dispatchEnabled) {
    await activateDispatchModuleWithProxyAgency({
      companyId: membership.companyId,
      proxyName,
    });
  } else {
    await addRealAgency({ companyId: membership.companyId, proxyName });
  }
  revalidatePath("/company/roster");
}

export async function inviteClientUpgradeAction(companyRelationshipId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const invite = await inviteRelationshipUpgrade({
    companyRelationshipId,
    companyId: membership.companyId,
    createdByUserId: userId,
    kind: "CLIENT_UPGRADE",
  });
  return absoluteInviteUrl(invite.token);
}

export async function inviteAgencyUpgradeAction(companyRelationshipId: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const invite = await inviteRelationshipUpgrade({
    companyRelationshipId,
    companyId: membership.companyId,
    createdByUserId: userId,
    kind: "AGENCY_UPGRADE",
  });
  return absoluteInviteUrl(invite.token);
}

export async function inviteNewClientAction() {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const invite = await inviteRelationshipUpgrade({
    companyId: membership.companyId,
    createdByUserId: userId,
    kind: "CLIENT_UPGRADE",
  });
  return absoluteInviteUrl(invite.token);
}

export async function inviteNewAgencyAction() {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const invite = await inviteRelationshipUpgrade({
    companyId: membership.companyId,
    createdByUserId: userId,
    kind: "AGENCY_UPGRADE",
  });
  return absoluteInviteUrl(invite.token);
}

export async function createTeamAction(name: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await createTeam({ companyId: membership.companyId, name });
  revalidatePath("/company/settings");
}

export async function setTeamMemberRoleAction(
  teamId: string,
  userId: string,
  role: "TEAM_MANAGER" | "TEAM_LEADER" | "TEAM_MEMBER",
) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await setTeamMemberRole({ teamId, userId, role });
  revalidatePath("/company/settings");
}

export async function removeTeamMemberAction(teamId: string, userId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await removeTeamMember({ teamId, userId });
  revalidatePath("/company/settings");
}

// 設定＞チーム管理の「＋招待」（新しく招待する）専用 — 参加した瞬間から
// 指定した役職（マネージャー/リーダー）を持つ招待URLを発行する。
export async function inviteTeamManagerAction(teamId: string, teamRole: "TEAM_MANAGER" | "TEAM_LEADER") {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const invite = await inviteTeamManager({
    companyId: membership.companyId,
    createdByUserId: userId,
    teamId,
    teamRole,
  });
  return absoluteInviteUrl(invite.token);
}

// 設定＞チーム管理の「＋招待」（既存スタッフから選ぶ）専用 — 招待URLを
// 発行し直さず、既に名簿にいるスタッフへその場で役職を付与する。
// 中身はsetTeamMemberRoleActionと同じだが、役職をマネージャー/リーダーに
// 限定する（設定画面からの「メンバーに戻す」操作と混同しないよう分ける）。
export async function promoteExistingStaffToTeamRoleAction(
  teamId: string,
  targetUserId: string,
  teamRole: "TEAM_MANAGER" | "TEAM_LEADER",
) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await setTeamMemberRole({ teamId, userId: targetUserId, role: teamRole });
  revalidatePath("/company/settings");
}

// スタッフ詳細＞編集パネル専用 — 一般所属（TEAM_MEMBER）としてのチーム
// 所属だけを一括で入れ替える。マネージャー/リーダーの役職には触れない
// （setStaffPlainTeamMembershipsのコメント参照）。
export async function setStaffTeamsAction(staffUserId: string, teamIds: string[]) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await setStaffPlainTeamMemberships({ companyId: membership.companyId, staffUserId, teamIds });
  revalidatePath("/company/roster");
}

// 依頼主/派遣会社詳細＞編集パネル専用 — その取引先が紐づくチームを一括で
// 入れ替える。
export async function setClientTeamsAction(companyRelationshipId: string, teamIds: string[]) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertRelationshipOwnedByCompany(companyRelationshipId, membership.companyId);

  await setClientTeams({ companyId: membership.companyId, companyRelationshipId, teamIds });
  revalidatePath("/company/roster");
  revalidatePath("/company/settings");
  revalidatePath("/company/calendar");
}

// 取引先/派遣会社情報の削除 — 間違えて仮アカウントを二重作成してしまった
// 場合の取り消し用（deleteStaffActionと同じ考え方）。本アカウント連携済み・
// 稼働実績のある関係はdeleteCompanyRelationship側で弾かれる。
export async function deleteCompanyRelationshipAction(companyRelationshipId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  try {
    await deleteCompanyRelationship({ companyId: membership.companyId, companyRelationshipId });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "unknown" };
  }
  revalidatePath("/company/roster");
  return { error: null };
}

// 配属解除（出禁）— 関係のオーナーでなくても、本アカウント連携済みの相手
// 側（依頼主自身）からも操作できる。単価設定やチーム紐付け・関係の削除は
// 引き続きオーナー限定（assertRelationshipOwnedByCompany）のまま。
export async function unplaceStaffAction(companyRelationshipId: string, staffUserId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertRelationshipParty(companyRelationshipId, membership.companyId);

  await unplaceStaff({ companyRelationshipId, staffUserId });
  revalidatePath("/company/roster");
}

export async function addTeamClientAction(teamId: string, companyRelationshipId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertRelationshipOwnedByCompany(companyRelationshipId, membership.companyId);

  await addTeamClient({ teamId, companyRelationshipId });
  revalidatePath("/company/settings");
  revalidatePath("/company/calendar");
}

export async function removeTeamClientAction(teamId: string, companyRelationshipId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertRelationshipOwnedByCompany(companyRelationshipId, membership.companyId);

  await removeTeamClient({ teamId, companyRelationshipId });
  revalidatePath("/company/settings");
  revalidatePath("/company/calendar");
}

export async function updateCompanyNameAction(name: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  if (!name.trim()) throw new Error("invalid_name");

  await prisma.company.update({
    where: { id: membership.companyId },
    data: { name: name.trim() },
  });
  revalidatePath("/company/settings");
  revalidatePath("/company");
}

export async function updateCompanyInvoiceRegistrationNumberAction(number: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await prisma.company.update({
    where: { id: membership.companyId },
    data: { invoiceRegistrationNumber: number.trim() || null },
  });
  revalidatePath("/company/settings");
}

export async function updateCompanyAddressAction(address: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await prisma.company.update({
    where: { id: membership.companyId },
    data: { address: address.trim() || null },
  });
  revalidatePath("/company/settings");
}

export async function updateCompanyPhoneNumberAction(phoneNumber: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await prisma.company.update({
    where: { id: membership.companyId },
    data: { phoneNumber: phoneNumber.trim() || null },
  });
  revalidatePath("/company/settings");
}

export async function setCompanyMemberRoleAction(
  targetUserId: string,
  role: "COMPANY_ADMIN" | "COMPANY_EDITOR",
) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  await setCompanyMemberRole({
    companyId: membership.companyId,
    userId: targetUserId,
    role,
  });
  revalidatePath("/company/settings");
}

export async function inviteCompanyAdminAction(role: "COMPANY_ADMIN" | "COMPANY_EDITOR") {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const { createInvite } = await import("@/lib/domain/invites");
  const invite = await createInvite({
    kind: "COMPANY_ADMIN_TRANSFER",
    companyId: membership.companyId,
    createdByUserId: userId,
    targetRole: role,
  });
  return absoluteInviteUrl(invite.token);
}

export async function getStaffMonthDetailAction(userId: string, year: number, month: number) {
  const { membership } = await requireCompanyAdminOrEditor();
  return getStaffMonthDetail({ companyId: membership.companyId, userId, year, month });
}

async function assertMembershipOwnedByCompany(membershipId: string, companyId: string) {
  const target = await prisma.companyMembership.findFirstOrThrow({ where: { id: membershipId, companyId } });
  return target;
}

export async function addStaffNoteAction(membershipId: string, content: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertMembershipOwnedByCompany(membershipId, membership.companyId);
  await addStaffNote({ membershipId, authorUserId: userId, content });
  revalidatePath("/company/roster");
}

export async function deleteStaffNoteAction(noteId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  const note = await prisma.staffNote.findFirstOrThrow({
    where: { id: noteId },
    include: { membership: true },
  });
  if (note.membership.companyId !== membership.companyId) throw new Error("forbidden");
  await deleteStaffNote(noteId);
  revalidatePath("/company/roster");
}

export async function updateStaffIdDocumentAction(membershipId: string, side: "front" | "back", url: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertMembershipOwnedByCompany(membershipId, membership.companyId);
  await updateMembershipIdDocument({ membershipId, side, url });
  revalidatePath("/company/roster");
}

export async function updateStaffBankInfoAction(
  membershipId: string,
  input: { bankName: string; branchName: string; accountType: string; accountNumber: string; accountHolderName: string },
) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertMembershipOwnedByCompany(membershipId, membership.companyId);
  await updateMembershipBankInfo({ membershipId, ...input });
  revalidatePath("/company/roster");
}

export async function getClientMonthDetailAction(companyRelationshipId: string, year: number, month: number) {
  const { membership } = await requireCompanyAdminOrEditor();
  return getClientMonthDetail({ companyId: membership.companyId, companyRelationshipId, year, month });
}

async function assertRelationshipOwnedByCompany(companyRelationshipId: string, companyId: string) {
  const target = await prisma.companyRelationship.findFirstOrThrow({
    where: { id: companyRelationshipId, ownerCompanyId: companyId },
  });
  return target;
}

export async function addRelationshipNoteAction(companyRelationshipId: string, content: string) {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await assertRelationshipOwnedByCompany(companyRelationshipId, membership.companyId);
  await addRelationshipNote({ companyRelationshipId, authorUserId: userId, content });
  revalidatePath("/company/roster");
}

export async function deleteRelationshipNoteAction(noteId: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  const note = await prisma.relationshipNote.findFirstOrThrow({
    where: { id: noteId },
    include: { companyRelationship: true },
  });
  if (note.companyRelationship.ownerCompanyId !== membership.companyId) throw new Error("forbidden");
  await deleteRelationshipNote(noteId);
  revalidatePath("/company/roster");
}
