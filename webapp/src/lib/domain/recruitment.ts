import "server-only";
import { prisma } from "@/lib/prisma";
import { postLedgerEntry } from "@/lib/domain/wallet";
import { findConflictingShifts } from "@/lib/domain/shifts";

const PER_ENTRY_TEE_COST = 10;

// 公開募集 billing: capacity × perEntryTeeCost is locked from the company's
// balance at the moment maxEntries is set — NOT charged per entry (that
// model was superseded mid-design; 開発指示書 §2.1 and the final prototype
// code are authoritative here, not CLAUDE.md's stale "実装済み" note).
export async function affordableMaxEntries(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  return Math.floor(company.teeBalance / PER_ENTRY_TEE_COST);
}

export async function createPublicRecruitment(params: {
  companyId: string;
  teamId?: string;
  title: string;
  jobDescription?: string;
  date: Date;
  startTime?: string;
  endTime?: string;
  hourlyWage?: number;
  maxEntries: number;
  createdByUserId: string;
  publish: boolean;
}) {
  const lockedTee = params.maxEntries * PER_ENTRY_TEE_COST;

  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.create({
      data: {
        companyId: params.companyId,
        teamId: params.teamId,
        title: params.title,
        jobDescription: params.jobDescription,
        date: params.date,
        startTime: params.startTime,
        endTime: params.endTime,
        hourlyWage: params.hourlyWage,
        maxEntries: params.maxEntries,
        perEntryTeeCost: PER_ENTRY_TEE_COST,
        lockedTee,
        status: params.publish ? "PUBLISHED" : "DRAFT",
        publishedAt: params.publish ? new Date() : undefined,
      },
    });

    await postLedgerEntry(tx, {
      companyId: params.companyId,
      type: "LOCK_RECRUITMENT",
      amount: -lockedTee,
      publicRecruitmentId: recruitment.id,
      createdByUserId: params.createdByUserId,
    });

    return recruitment;
  });
}

export async function publishRecruitment(recruitmentId: string) {
  return prisma.publicRecruitment.update({
    where: { id: recruitmentId },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });
}

// Changing 人数上限 on an existing listing: lock the increment, or refund the
// unused portion of a decrement. Editing existing content otherwise never
// re-charges (開発指示書 §2.1).
export async function updateMaxEntries(params: {
  recruitmentId: string;
  newMaxEntries: number;
  updatedByUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.findUniqueOrThrow({
      where: { id: params.recruitmentId },
    });

    const filledCount = await tx.recruitmentEntry.count({
      where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
    });

    const newMaxEntries = Math.max(params.newMaxEntries, filledCount);
    const newLockedTee = newMaxEntries * recruitment.perEntryTeeCost;
    const delta = newLockedTee - recruitment.lockedTee; // positive = need to lock more

    if (delta > 0) {
      await postLedgerEntry(tx, {
        companyId: recruitment.companyId,
        type: "LOCK_RECRUITMENT",
        amount: -delta,
        publicRecruitmentId: recruitment.id,
        createdByUserId: params.updatedByUserId,
      });
    } else if (delta < 0) {
      await postLedgerEntry(tx, {
        companyId: recruitment.companyId,
        type: "UNLOCK_REFUND_RECRUITMENT",
        amount: -delta, // delta negative -> amount positive (refund)
        publicRecruitmentId: recruitment.id,
        createdByUserId: params.updatedByUserId,
      });
    }

    return tx.publicRecruitment.update({
      where: { id: recruitment.id },
      data: { maxEntries: newMaxEntries, lockedTee: newLockedTee },
    });
  });
}

// 停止・削除: refund the unused locked portion (上限 - 応募済み人数) × cost.
export async function stopOrDeleteRecruitment(params: {
  recruitmentId: string;
  updatedByUserId: string;
  delete: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.findUniqueOrThrow({
      where: { id: params.recruitmentId },
    });

    const filledCount = await tx.recruitmentEntry.count({
      where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
    });
    const unusedTee = (recruitment.maxEntries - filledCount) * recruitment.perEntryTeeCost;

    if (unusedTee > 0) {
      await postLedgerEntry(tx, {
        companyId: recruitment.companyId,
        type: "UNLOCK_REFUND_RECRUITMENT",
        amount: unusedTee,
        publicRecruitmentId: recruitment.id,
        createdByUserId: params.updatedByUserId,
      });
    }

    return tx.publicRecruitment.update({
      where: { id: recruitment.id },
      data: {
        status: params.delete ? "DELETED" : "STOPPED",
        lockedTee: unusedTee > 0 ? recruitment.lockedTee - unusedTee : recruitment.lockedTee,
      },
    });
  });
}

export async function listPublicRecruitments(params: { companyId: string; teamId?: string }) {
  return prisma.publicRecruitment.findMany({
    where: {
      companyId: params.companyId,
      teamId: params.teamId,
      status: { in: ["PUBLISHED", "DRAFT"] },
    },
    include: { entries: true },
    orderBy: { date: "asc" },
  });
}

// 依頼主名簿 (companies where companyId is the agencyCompanyId) — the set of
// companies whose orders/recruitment postings this company is entitled to
// see and assign its own staff into. The reverse direction (派遣会社名簿,
// clientCompanyId = companyId) intentionally has no visibility into this
// company's own postings.
async function visibleClientCompanyIds(companyId: string) {
  const rels = await prisma.companyRelationship.findMany({
    where: { agencyCompanyId: companyId, clientCompanyId: { not: null }, status: "ACTIVE" },
    select: { clientCompanyId: true },
  });
  return rels.map((r) => r.clientCompanyId).filter((id): id is string => id !== null);
}

// 依頼主オーダー: PUBLISHED recruitment postings from companies in this
// company's 依頼主名簿 (i.e. companies this company dispatches staff to).
export async function listClientRecruitments(companyId: string) {
  const clientCompanyIds = await visibleClientCompanyIds(companyId);
  if (clientCompanyIds.length === 0) return [];

  return prisma.publicRecruitment.findMany({
    where: { companyId: { in: clientCompanyIds }, status: "PUBLISHED" },
    include: { entries: true, company: true },
    orderBy: { date: "asc" },
  });
}

// A staff member sees their own company's postings plus postings from
// companies in their employer's 依頼主名簿 (the client companies their
// employer dispatches them to) — not the entire platform.
export async function listOpenRecruitmentsForStaff(companyId: string) {
  const clientCompanyIds = await visibleClientCompanyIds(companyId);
  return prisma.publicRecruitment.findMany({
    where: { status: "PUBLISHED", companyId: { in: [companyId, ...clientCompanyIds] } },
    include: { entries: true, company: true },
    orderBy: { date: "asc" },
  });
}

// Admin-initiated assignment (as opposed to applyToRecruitment's staff
// self-service) — lets a company assign one of its own staff into a
// PUBLISHED recruitment, either its own or one posted by a company in its
// 依頼主名簿. Cross-company assignment produces a CLIENT-source shift on the
// assigning company's own calendar (billable, same as a manually assigned
// client shift); same-company assignment produces an INHOUSE shift exactly
// like a self-applied entry would. Unlike self-apply, this runs the same
// overlap conflict check as a manual シフトを作成 assign — an admin picking a
// shift FOR someone else needs the same double-booking guard, and a
// two-phase confirm (conflicts -> explicit overrideShiftId) as the caller.
export async function assignStaffToRecruitment(params: {
  recruitmentId: string;
  staffUserId: string;
  assignerCompanyId: string;
  assignedByUserId: string;
  overrideShiftId?: string;
}) {
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: params.recruitmentId } });
  if (recruitment.status !== "PUBLISHED") {
    throw new Error("recruitment_not_open");
  }

  const filledCount = await prisma.recruitmentEntry.count({
    where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
  });
  if (filledCount >= recruitment.maxEntries) {
    throw new Error("recruitment_full");
  }

  const staffMembership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId: params.staffUserId, companyId: params.assignerCompanyId } },
  });
  if (!staffMembership) {
    throw new Error("staff_not_in_company");
  }

  const isOwnCompany = params.assignerCompanyId === recruitment.companyId;
  let companyRelationshipId: string | undefined;
  if (!isOwnCompany) {
    const rel = await prisma.companyRelationship.findFirst({
      where: { agencyCompanyId: params.assignerCompanyId, clientCompanyId: recruitment.companyId, status: "ACTIVE" },
    });
    if (!rel) throw new Error("forbidden");
    companyRelationshipId = rel.id;
  }

  const conflicts = await findConflictingShifts({
    staffUserId: params.staffUserId,
    date: recruitment.date,
    startTime: recruitment.startTime,
    endTime: recruitment.endTime,
    isAllDay: !recruitment.startTime,
    isUndecided: false,
  });
  if (conflicts.length > 0 && !params.overrideShiftId) {
    return { status: "conflict" as const, conflicts };
  }

  return prisma.$transaction(async (tx) => {
    const entry = await tx.recruitmentEntry.create({
      data: {
        publicRecruitmentId: recruitment.id,
        staffUserId: params.staffUserId,
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });

    const shift = await tx.shift.create({
      data: {
        companyId: params.assignerCompanyId,
        teamId: isOwnCompany ? recruitment.teamId : null,
        staffUserId: params.staffUserId,
        source: isOwnCompany ? "INHOUSE" : "CLIENT",
        companyRelationshipId,
        date: recruitment.date,
        startTime: recruitment.startTime,
        endTime: recruitment.endTime,
        isAllDay: !recruitment.startTime,
        isUndecided: false,
        note: recruitment.title,
        createdVia: "PUBLIC_RECRUIT_ENTRY",
        publicRecruitmentId: recruitment.id,
      },
    });

    await tx.recruitmentEntry.update({
      where: { id: entry.id },
      data: { resultingShiftId: shift.id },
    });

    if (params.overrideShiftId) {
      await tx.shift.update({
        where: { id: params.overrideShiftId },
        data: { status: "SUPERSEDED" },
      });
      await tx.conflictOverride.create({
        data: {
          newShiftId: shift.id,
          overriddenShiftId: params.overrideShiftId,
          confirmedByUserId: params.assignedByUserId,
        },
      });
    }

    return { status: "created" as const, entry, shift };
  });
}

// スタッフの応募 — no billing event (capacity was already locked at listing
// time) and, per the design's known/accepted gap, no overlap conflict check
// against the staff member's other confirmed shifts (chat27/31).
export async function applyToRecruitment(params: { recruitmentId: string; staffUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.findUniqueOrThrow({
      where: { id: params.recruitmentId },
    });
    if (recruitment.status !== "PUBLISHED") {
      throw new Error("recruitment_not_open");
    }

    const filledCount = await tx.recruitmentEntry.count({
      where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
    });
    if (filledCount >= recruitment.maxEntries) {
      throw new Error("recruitment_full");
    }

    const entry = await tx.recruitmentEntry.create({
      data: {
        publicRecruitmentId: recruitment.id,
        staffUserId: params.staffUserId,
        status: "CONFIRMED",
        confirmedAt: new Date(),
      },
    });

    const shift = await tx.shift.create({
      data: {
        companyId: recruitment.companyId,
        teamId: recruitment.teamId,
        staffUserId: params.staffUserId,
        source: "INHOUSE",
        date: recruitment.date,
        startTime: recruitment.startTime,
        endTime: recruitment.endTime,
        isAllDay: !recruitment.startTime,
        isUndecided: false,
        note: recruitment.title,
        createdVia: "PUBLIC_RECRUIT_ENTRY",
        publicRecruitmentId: recruitment.id,
      },
    });

    await tx.recruitmentEntry.update({
      where: { id: entry.id },
      data: { resultingShiftId: shift.id },
    });

    return { entry, shift };
  });
}
