import "server-only";
import { prisma } from "@/lib/prisma";
import { postLedgerEntry } from "@/lib/domain/wallet";
import { findConflictingShifts, isPastDate } from "@/lib/domain/shifts";
import type { WageType } from "@/generated/prisma/enums";

const PER_ENTRY_TEE_COST = 10;

// 公開募集(visibility=PUBLIC)化した時点で capacity × perEntryTeeCost が
// company残高からロックされる — NOT charged per entry (that model was
// superseded mid-design; 開発指示書 §2.1 and the final prototype code are
// authoritative here, not CLAUDE.md's stale "実装済み" note). オーダー
// (visibility=ORDER) の間は無課金 — 掲載も人数変更も停止/削除もTeeを動かさない。
export async function affordableMaxEntries(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  return Math.floor(company.teeBalance / PER_ENTRY_TEE_COST);
}

// 常にオーダー(visibility=ORDER)として作成する — 時給等の公開募集専用項目は
// 一切受け取らない。自社スタッフ・配属済み派遣スタッフの賃金は既存の契約/
// 賃金テーブル側で決まるため、募集側では持たない。
export async function createPublicRecruitment(params: {
  companyId: string;
  teamId?: string;
  title: string;
  jobDescription?: string;
  date: Date;
  startTime?: string;
  endTime?: string;
  maxEntries: number;
  createdByUserId: string;
  publish: boolean;
}) {
  return prisma.publicRecruitment.create({
    data: {
      companyId: params.companyId,
      teamId: params.teamId,
      title: params.title,
      jobDescription: params.jobDescription,
      date: params.date,
      startTime: params.startTime,
      endTime: params.endTime,
      maxEntries: params.maxEntries,
      perEntryTeeCost: PER_ENTRY_TEE_COST,
      lockedTee: 0,
      status: params.publish ? "PUBLISHED" : "DRAFT",
      visibility: "ORDER",
      publishedAt: params.publish ? new Date() : undefined,
    },
  });
}

// オーダーのままでは応募が足りない場合の、片道の切り替え操作。この時点で
// 初めて時給/日給・応募条件・持ち物・集合場所を確定し、残り枠(上限−確定済み
// 人数)分のTeeをロックする（開発指示書 §2.1 と同じ考え方）。
export async function openRecruitmentToPublic(params: {
  recruitmentId: string;
  hourlyWage: number;
  wageType: WageType;
  applicationConditions?: string;
  attire?: string;
  belongings?: string;
  meetingPlace?: string;
  updatedByUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.findUniqueOrThrow({ where: { id: params.recruitmentId } });
    if (recruitment.visibility === "PUBLIC") {
      throw new Error("already_public");
    }
    if (recruitment.status !== "PUBLISHED") {
      throw new Error("recruitment_not_open");
    }
    if (isPastDate(recruitment.date)) {
      throw new Error("recruitment_in_past");
    }

    const filledCount = await tx.recruitmentEntry.count({
      where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
    });
    const lockedTee = Math.max(recruitment.maxEntries - filledCount, 0) * recruitment.perEntryTeeCost;

    if (lockedTee > 0) {
      await postLedgerEntry(tx, {
        companyId: recruitment.companyId,
        type: "LOCK_RECRUITMENT",
        amount: -lockedTee,
        publicRecruitmentId: recruitment.id,
        createdByUserId: params.updatedByUserId,
      });
    }

    return tx.publicRecruitment.update({
      where: { id: recruitment.id },
      data: {
        visibility: "PUBLIC",
        publicOpenedAt: new Date(),
        hourlyWage: params.hourlyWage,
        wageType: params.wageType,
        applicationConditions: params.applicationConditions,
        attire: params.attire,
        belongings: params.belongings,
        meetingPlace: params.meetingPlace,
        lockedTee: recruitment.lockedTee + lockedTee,
      },
    });
  });
}

// 公開募集の内容だけ先に用意しておく（visibility=ORDERのまま、Teeも動かさ
// ない）。まだ公開する準備ができていない段階で、時給や応募条件などを下書き
// 保存しておき、あとで実際に開始するときはopenRecruitmentToPublicを呼ぶ。
// PUBLIC化した後は編集不可（開始前に確定させる運用）なのでORDERの間しか
// 呼べない。
export async function saveRecruitmentPublicDraft(params: {
  recruitmentId: string;
  hourlyWage?: number;
  wageType?: WageType;
  applicationConditions?: string;
  attire?: string;
  belongings?: string;
  meetingPlace?: string;
}) {
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: params.recruitmentId } });
  if (recruitment.visibility === "PUBLIC") {
    throw new Error("already_public");
  }

  return prisma.publicRecruitment.update({
    where: { id: recruitment.id },
    data: {
      hourlyWage: params.hourlyWage,
      wageType: params.wageType,
      applicationConditions: params.applicationConditions,
      attire: params.attire,
      belongings: params.belongings,
      meetingPlace: params.meetingPlace,
    },
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
// re-charges (開発指示書 §2.1). オーダー(visibility=ORDER)はそもそも無課金
// なので、Teeの授受はvisibility=PUBLICのときだけ発生する。
export async function updateMaxEntries(params: {
  recruitmentId: string;
  newMaxEntries: number;
  updatedByUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.findUniqueOrThrow({
      where: { id: params.recruitmentId },
    });
    if (isPastDate(recruitment.date)) {
      throw new Error("recruitment_in_past");
    }

    const filledCount = await tx.recruitmentEntry.count({
      where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
    });
    const newMaxEntries = Math.max(params.newMaxEntries, filledCount);

    if (recruitment.visibility === "ORDER") {
      return tx.publicRecruitment.update({
        where: { id: recruitment.id },
        data: { maxEntries: newMaxEntries },
      });
    }

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

// 削除: 間違えた/重複した募集を消す操作。停止(一時中断からの再開)は使い道が
// ないため廃止 — 人数を絞りたいだけなら人数上限を減らせば足りる。
// 既にエントリー済みの人がいれば、そのRecruitmentEntryとresultingShiftも
// まとめて取り消す — 募集を消したのにシフトだけ生き残る状態を防ぐ(呼び出し
// 側で「◯名エントリーしています」の確認を必ず挟む)。確定分も含めて全員の
// 枠が無効になるので、現在ロック中のTee(recruitment.lockedTee)は全額返金
// する(「未使用分だけ」ではない — 確定していた枠も削除で無効になるため)。
// オーダーはそもそもロックが無いので返金も発生しない。
export async function deleteRecruitment(params: { recruitmentId: string; updatedByUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.findUniqueOrThrow({
      where: { id: params.recruitmentId },
    });
    if (isPastDate(recruitment.date)) {
      throw new Error("recruitment_in_past");
    }

    const activeEntries = await tx.recruitmentEntry.findMany({
      where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
    });
    for (const entry of activeEntries) {
      if (entry.resultingShiftId) {
        await tx.shift.updateMany({
          where: { id: entry.resultingShiftId, status: "CONFIRMED" },
          data: { status: "CANCELLED" },
        });
      }
      await tx.recruitmentEntry.update({ where: { id: entry.id }, data: { status: "REJECTED" } });
    }

    if (recruitment.visibility === "ORDER") {
      return tx.publicRecruitment.update({
        where: { id: recruitment.id },
        data: { status: "DELETED" },
      });
    }

    if (recruitment.lockedTee > 0) {
      await postLedgerEntry(tx, {
        companyId: recruitment.companyId,
        type: "UNLOCK_REFUND_RECRUITMENT",
        amount: recruitment.lockedTee,
        publicRecruitmentId: recruitment.id,
        createdByUserId: params.updatedByUserId,
      });
    }

    return tx.publicRecruitment.update({
      where: { id: recruitment.id },
      data: { status: "DELETED", lockedTee: 0 },
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

// 配属記録 — このスタッフが、この会社(clientCompanyId)への配属記録を
// 持っている派遣関係のclientCompanyId一覧（companyIdはそのスタッフの
// 所属会社＝派遣元）。
async function placedClientCompanyIds(companyId: string, staffUserId: string) {
  const placements = await prisma.staffPlacement.findMany({
    where: {
      staffUserId,
      companyRelationship: { agencyCompanyId: companyId, status: "ACTIVE" },
    },
    select: { companyRelationship: { select: { clientCompanyId: true } } },
  });
  return placements.map((p) => p.companyRelationship.clientCompanyId).filter((id): id is string => id !== null);
}

// スタッフに見える募集: ①自社の投稿（visibilityを問わず常に見える）、
// ②依頼主名簿にある派遣先のうち、自分が配属記録を持つ会社のオーダー、
// ③visibility=PUBLICの募集（TeeRA全体に公開されるため会社の関係を問わない）。
export async function listOpenRecruitmentsForStaff(params: { companyId: string; staffUserId: string }) {
  const clientCompanyIds = await placedClientCompanyIds(params.companyId, params.staffUserId);

  return prisma.publicRecruitment.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        { companyId: params.companyId },
        { companyId: { in: clientCompanyIds }, visibility: "ORDER" },
        { visibility: "PUBLIC" },
      ],
    },
    include: { entries: true, company: true },
    orderBy: { date: "asc" },
  });
}

// スタッフの応募/管理者アサインの対象になれるか: 自社所属、配属記録あり、
// または募集自体がvisibility=PUBLIC（誰でも応募可）のいずれか。
async function isStaffEligibleForRecruitment(params: {
  recruitmentCompanyId: string;
  recruitmentVisibility: "ORDER" | "PUBLIC";
  staffUserId: string;
}) {
  if (params.recruitmentVisibility === "PUBLIC") return true;

  const ownMembership = await prisma.companyMembership.findUnique({
    where: { userId_companyId: { userId: params.staffUserId, companyId: params.recruitmentCompanyId } },
  });
  if (ownMembership) return true;

  const placement = await prisma.staffPlacement.findFirst({
    where: {
      staffUserId: params.staffUserId,
      companyRelationship: { clientCompanyId: params.recruitmentCompanyId, status: "ACTIVE" },
    },
  });
  return !!placement;
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
// No 配属 eligibility gate here (unlike applyToRecruitment) — an admin can
// freely assign any of their own staff regardless of visibility/配属状態;
// a cross-company assign auto-registers a 配属記録 so that staff can
// self-apply to this client's future オーダー without the admin's help.
export async function assignStaffToRecruitment(params: {
  recruitmentId: string;
  staffUserId: string;
  assignerCompanyId: string;
  assignedByUserId: string;
  overrideShiftIds?: string[];
}) {
  const recruitment = await prisma.publicRecruitment.findUniqueOrThrow({ where: { id: params.recruitmentId } });
  if (recruitment.status !== "PUBLISHED") {
    throw new Error("recruitment_not_open");
  }
  if (isPastDate(recruitment.date)) {
    throw new Error("recruitment_in_past");
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
  if (conflicts.length > 0 && !params.overrideShiftIds?.length) {
    return { status: "conflict" as const, conflicts };
  }

  return prisma.$transaction(async (tx) => {
    // Row-lock the recruitment so two concurrent fills of the same slot
    // serialize instead of both reading a stale filledCount and overbooking
    // it — the second transaction blocks here until the first commits, then
    // re-reads the count fresh (booking-site "lock the slot" behavior).
    await tx.$queryRaw`SELECT id FROM "PublicRecruitment" WHERE id = ${recruitment.id} FOR UPDATE`;

    const freshFilledCount = await tx.recruitmentEntry.count({
      where: { publicRecruitmentId: recruitment.id, status: { not: "REJECTED" } },
    });
    if (freshFilledCount >= recruitment.maxEntries) {
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

    if (companyRelationshipId) {
      await tx.staffPlacement.upsert({
        where: { staffUserId_companyRelationshipId: { staffUserId: params.staffUserId, companyRelationshipId } },
        create: { staffUserId: params.staffUserId, companyRelationshipId },
        update: {},
      });
    }

    for (const overriddenId of params.overrideShiftIds ?? []) {
      await tx.shift.update({
        where: { id: overriddenId },
        data: { status: "SUPERSEDED" },
      });
      await tx.conflictOverride.create({
        data: {
          newShiftId: shift.id,
          overriddenShiftId: overriddenId,
          confirmedByUserId: params.assignedByUserId,
        },
      });
    }

    return { status: "created" as const, entry, shift };
  });
}

// スタッフの応募 — no billing event (capacity was already locked at listing
// time) and, per the design's known/accepted gap, no overlap conflict check
// against the staff member's other confirmed shifts (chat27/31). visibility
// =ORDERの募集は、自社所属か配属記録を持つスタッフのみ応募できる（listで
// 見えていても、URL直叩き等でのすり抜けをサーバー側でも防ぐ）。
export async function applyToRecruitment(params: { recruitmentId: string; staffUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const recruitment = await tx.publicRecruitment.findUniqueOrThrow({
      where: { id: params.recruitmentId },
    });
    if (recruitment.status !== "PUBLISHED") {
      throw new Error("recruitment_not_open");
    }
    if (isPastDate(recruitment.date)) {
      throw new Error("recruitment_in_past");
    }
    const eligible = await isStaffEligibleForRecruitment({
      recruitmentCompanyId: recruitment.companyId,
      recruitmentVisibility: recruitment.visibility,
      staffUserId: params.staffUserId,
    });
    if (!eligible) {
      throw new Error("not_eligible");
    }

    // Row-lock the recruitment so two staff applying at the same instant
    // serialize instead of both reading a stale filledCount and overbooking
    // the slot — see assignStaffToRecruitment for the same pattern.
    await tx.$queryRaw`SELECT id FROM "PublicRecruitment" WHERE id = ${recruitment.id} FOR UPDATE`;

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

export type StaffOrigin = { kind: "SELF" } | { kind: "PLACEMENT"; agencyCompanyName: string } | { kind: "PUBLIC" };

// source=INHOUSE のシフト（＝この会社自身のカレンダー上の勤務）に立っている
// staffUserIdが、実際には自社の名簿メンバーなのか、配属記録のある他社（派遣
// 会社）のスタッフなのか、それ以外（公開募集で見ず知らずの人が応募してきた）
// なのかを判定する。source=CLIENT（自社スタッフを他社へ派遣した側）には
// 使わない — そちらは既存のclientName表示で足りる。
export async function resolveStaffOrigins(params: {
  companyId: string;
  staffUserIds: string[];
}): Promise<Map<string, StaffOrigin>> {
  const uniqueIds = [...new Set(params.staffUserIds)];
  const result = new Map<string, StaffOrigin>();
  if (uniqueIds.length === 0) return result;

  const memberships = await prisma.companyMembership.findMany({
    where: { companyId: params.companyId, userId: { in: uniqueIds } },
    select: { userId: true },
  });
  const memberIds = new Set(memberships.map((m) => m.userId));

  const remainingIds = uniqueIds.filter((id) => !memberIds.has(id));
  const placements = remainingIds.length
    ? await prisma.staffPlacement.findMany({
        where: {
          staffUserId: { in: remainingIds },
          companyRelationship: { clientCompanyId: params.companyId, status: "ACTIVE" },
        },
        select: { staffUserId: true, companyRelationship: { select: { agencyCompany: { select: { name: true } } } } },
      })
    : [];
  const placementNames = new Map(placements.map((p) => [p.staffUserId, p.companyRelationship.agencyCompany?.name]));

  for (const id of uniqueIds) {
    if (memberIds.has(id)) {
      result.set(id, { kind: "SELF" });
    } else if (placementNames.has(id)) {
      result.set(id, { kind: "PLACEMENT", agencyCompanyName: placementNames.get(id) ?? "配属先" });
    } else {
      result.set(id, { kind: "PUBLIC" });
    }
  }
  return result;
}

