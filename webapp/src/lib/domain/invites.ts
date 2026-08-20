import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { InviteKind, CompanyRole } from "@/generated/prisma/enums";

const INVITE_TTL_DAYS = 14;

export function generateInviteTokenString() {
  return randomBytes(24).toString("base64url");
}

export async function createInvite(params: {
  kind: InviteKind;
  companyId: string;
  createdByUserId: string;
  teamId?: string;
  companyRelationshipId?: string;
  contractTemplateId?: string;
  contractStartDate?: Date;
  targetRole?: CompanyRole;
}) {
  const token = generateInviteTokenString();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  return prisma.inviteToken.create({
    data: {
      token,
      kind: params.kind,
      companyId: params.companyId,
      teamId: params.teamId,
      companyRelationshipId: params.companyRelationshipId,
      contractTemplateId: params.contractTemplateId,
      contractStartDate: params.contractStartDate,
      targetRole: params.targetRole,
      createdByUserId: params.createdByUserId,
      expiresAt,
    },
  });
}

export type InviteLookup = Awaited<ReturnType<typeof lookupInvite>>;

export async function lookupInvite(token: string) {
  const invite = await prisma.inviteToken.findUnique({
    where: { token },
    include: { company: true, team: true, companyRelationship: true },
  });
  if (!invite) return { status: "not_found" as const };
  if (invite.usedAt) return { status: "used" as const, invite };
  if (invite.expiresAt < new Date()) return { status: "expired" as const, invite };
  return { status: "valid" as const, invite };
}

// Fixes the prototype's known gap (開発指示書 §4): opening a staff/team invite
// link now auto-joins the inviting company/team instead of always routing to
// "本部を作成する". Company-relationship invites (CLIENT_UPGRADE/AGENCY_UPGRADE)
// still require the redeeming user to have or create their own company, since
// the invite links two companies together, not a person to one.
export async function redeemInvite(token: string, userId: string) {
  const redeemedInvite = await prisma.$transaction(async (tx) => {
    const invite = await tx.inviteToken.findUnique({ where: { token } });
    if (!invite) throw new Error("invite_not_found");
    if (invite.usedAt) throw new Error("invite_already_used");
    if (invite.expiresAt < new Date()) throw new Error("invite_expired");

    const existing = await tx.companyMembership.findFirst({ where: { userId } });
    if (existing) throw new Error("user_already_has_company");

    if (invite.kind === "STAFF" || invite.kind === "COMPANY_ADMIN_TRANSFER") {
      if (invite.upgradeProxyUserId) {
        // 本アカウントと連携する: move the proxy's memberships onto the real
        // account, then remove the now-unused placeholder user.
        const proxyUserId = invite.upgradeProxyUserId;
        await tx.companyMembership.updateMany({
          where: { userId: proxyUserId, companyId: invite.companyId },
          data: { userId },
        });
        await tx.teamMembership.updateMany({
          where: { userId: proxyUserId, team: { companyId: invite.companyId } },
          data: { userId },
        });
        await tx.user.delete({ where: { id: proxyUserId } });
      } else {
        const role = invite.targetRole ?? "STAFF";
        await tx.companyMembership.create({
          data: { userId, companyId: invite.companyId, role },
        });
        if (invite.teamId) {
          await tx.teamMembership.create({
            data: { userId, teamId: invite.teamId, role: "TEAM_MEMBER" },
          });
        }
        if (invite.contractTemplateId) {
          const template = await tx.contractTemplate.findUniqueOrThrow({ where: { id: invite.contractTemplateId } });
          await tx.staffContract.create({
            data: {
              templateId: template.id,
              staffUserId: userId,
              wageAmountSnapshot: template.wageAmount,
              contractStartDate: invite.contractStartDate ?? template.contractStartDate,
              contractEndDate: template.contractEndDate,
              status: "ACTIVE",
              consentedAt: new Date(),
            },
          });
        }
      }
    } else {
      // CLIENT_UPGRADE / AGENCY_UPGRADE: caller must create/select their own
      // company first (see redeemCompanyRelationshipInvite below).
      throw new Error("requires_company_relationship_redemption");
    }

    await tx.inviteToken.update({
      where: { id: invite.id },
      data: { usedAt: new Date(), usedByUserId: userId },
    });

    return invite;
  });

  if (redeemedInvite.contractTemplateId) {
    const { recomputeTemplateLock } = await import("@/lib/domain/contracts");
    await recomputeTemplateLock(redeemedInvite.contractTemplateId);
  }

  return redeemedInvite;
}

// Links the redeeming user's own company into the CompanyRelationship the
// invite points at. Used for CLIENT_UPGRADE (redeemer becomes clientCompany)
// and AGENCY_UPGRADE (redeemer becomes agencyCompany) invites.
export async function redeemCompanyRelationshipInvite(
  token: string,
  redeemingCompanyId: string,
) {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.inviteToken.findUnique({ where: { token } });
    if (!invite) throw new Error("invite_not_found");
    if (invite.usedAt) throw new Error("invite_already_used");
    if (invite.expiresAt < new Date()) throw new Error("invite_expired");
    if (invite.kind !== "CLIENT_UPGRADE" && invite.kind !== "AGENCY_UPGRADE") {
      throw new Error("wrong_invite_kind");
    }
    if (!invite.companyRelationshipId) throw new Error("missing_relationship");

    const data =
      invite.kind === "CLIENT_UPGRADE"
        ? { clientCompanyId: redeemingCompanyId }
        : { agencyCompanyId: redeemingCompanyId };

    await tx.companyRelationship.update({
      where: { id: invite.companyRelationshipId },
      data,
    });

    await tx.inviteToken.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });

    return invite;
  });
}
