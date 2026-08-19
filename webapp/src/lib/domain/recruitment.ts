import "server-only";
import { prisma } from "@/lib/prisma";
import { postLedgerEntry } from "@/lib/domain/wallet";

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

export async function listOpenRecruitmentsForStaff() {
  return prisma.publicRecruitment.findMany({
    where: { status: "PUBLISHED" },
    include: { entries: true, company: true },
    orderBy: { date: "asc" },
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
