"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManage, canManageCompanySettings } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import {
  inviteStaff,
  createProxyStaff,
  inviteProxyUpgrade,
  getStaffMonthDetail,
  updateStaffNote,
} from "@/lib/domain/roster";
import {
  activateAgencyModuleWithProxyClient,
  activateDispatchModuleWithProxyAgency,
  addRealClient,
  addRealAgency,
  inviteRelationshipUpgrade,
  inviteNewClient,
  inviteNewAgency,
  getClientMonthDetail,
  updateClientNote,
} from "@/lib/domain/relationships";
import { createTeam, setTeamMemberRole, setCompanyMemberRole } from "@/lib/domain/teams";

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

  const invite = await inviteNewClient({ companyId: membership.companyId, createdByUserId: userId });
  revalidatePath("/company/roster");
  return absoluteInviteUrl(invite.token);
}

export async function inviteNewAgencyAction() {
  const { userId, membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");

  const invite = await inviteNewAgency({ companyId: membership.companyId, createdByUserId: userId });
  revalidatePath("/company/roster");
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

export async function updateStaffNoteAction(membershipId: string, note: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await updateStaffNote({ membershipId, note });
  revalidatePath("/company/roster");
}

export async function getClientMonthDetailAction(companyRelationshipId: string, year: number, month: number) {
  const { membership } = await requireCompanyAdminOrEditor();
  return getClientMonthDetail({ companyId: membership.companyId, companyRelationshipId, year, month });
}

export async function updateClientNoteAction(companyRelationshipId: string, note: string) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (!canManageCompanySettings(membership)) throw new Error("forbidden");
  await updateClientNote({ companyRelationshipId, note });
  revalidatePath("/company/roster");
}
