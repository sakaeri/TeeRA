import "server-only";
import { prisma } from "@/lib/prisma";
import { todayJst } from "@/lib/date";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

// 上書き(override)で既存シフトをSUPERSEDEDにする際は、そのシフトの発生元
// (公開募集の確定枠 / マッチ済みのシフト希望)も一緒に解放する。ここを怠ると
// 元のシフトは一覧から消えるのに募集側のfilledカウントだけ残ってしまい、
// 「1/1なのに確定スタッフが誰もいない」という不整合になる（cancelShiftと
// 同じ考え方 — 発生元を必ず巻き戻す）。
export async function supersedeShift(
  tx: Tx,
  params: { shiftId: string; newShiftId: string; confirmedByUserId: string },
) {
  await tx.shift.update({ where: { id: params.shiftId }, data: { status: "SUPERSEDED" } });
  await tx.conflictOverride.create({
    data: {
      newShiftId: params.newShiftId,
      overriddenShiftId: params.shiftId,
      confirmedByUserId: params.confirmedByUserId,
    },
  });

  const entry = await tx.recruitmentEntry.findFirst({ where: { resultingShiftId: params.shiftId } });
  if (entry) {
    await tx.recruitmentEntry.update({ where: { id: entry.id }, data: { status: "REJECTED" } });
  }

  const matchedRequest = await tx.shiftRequest.findFirst({ where: { matchedShiftId: params.shiftId } });
  if (matchedRequest) {
    await tx.shiftRequest.update({
      where: { id: matchedRequest.id },
      data: { status: "PENDING", matchedShiftId: null },
    });
  }
}

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// 過去のエントリーや募集情報は一切変更なし — once a date has passed, the shift/
// recruitment/entry record is locked: no cancel, no edit, no fill. "Today" is
// still mutable. Dates are stored as @db.Date (UTC midnight), so compare
// against today's own UTC midnight.
export function isPastDate(date: Date) {
  const today = new Date(`${todayJst()}T00:00:00.000Z`);
  return date.getTime() < today.getTime();
}

// Two shifts overlap only when their time ranges actually intersect — a shift
// ending at 03:00 followed by one starting at 03:00 is adjacent, not
// overlapping (explicitly confirmed in design chat17). All-day/undecided
// shifts are treated as spanning the whole day for conflict purposes.
export function timeRangesOverlap(
  a: { startTime: string | null; endTime: string | null; isAllDay: boolean; isUndecided: boolean },
  b: { startTime: string | null; endTime: string | null; isAllDay: boolean; isUndecided: boolean },
) {
  if (a.isAllDay || a.isUndecided || b.isAllDay || b.isUndecided) return true;
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return true;

  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export async function findConflictingShifts(params: {
  staffUserId: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  excludeShiftId?: string;
}) {
  const sameDayShifts = await prisma.shift.findMany({
    where: {
      staffUserId: params.staffUserId,
      date: params.date,
      status: "CONFIRMED",
      id: params.excludeShiftId ? { not: params.excludeShiftId } : undefined,
    },
  });

  return sameDayShifts.filter((s) => timeRangesOverlap(params, s));
}

// シフトを作成 (company-initiated assign). Runs the overlap conflict check —
// this check is intentionally NOT applied to staff self-apply flows
// (applyToRecruitment / matchShiftRequestToShift), which is a known,
// deliberately-unresolved gap carried over from the design (chat27/31).
export async function createAssignedShift(params: {
  companyId: string;
  teamId?: string;
  staffUserId: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  note?: string;
  confirmedByUserId: string;
  overrideShiftIds?: string[]; // set when the caller has already confirmed the override(s) with staff — one entry per conflicting shift being superseded
  companyRelationshipId?: string; // set for 取引先オーダー (source becomes CLIENT, billable on that client's invoice)
  taskName?: string; // 業務内容 — 単価は保持しない。給与/請求計算時にその都度参照される
}) {
  const conflicts = await findConflictingShifts({
    staffUserId: params.staffUserId,
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    isAllDay: params.isAllDay,
    isUndecided: params.isUndecided,
  });

  if (conflicts.length > 0 && !params.overrideShiftIds?.length) {
    return { status: "conflict" as const, conflicts };
  }

  const shift = await prisma.$transaction(async (tx) => {
    const created = await tx.shift.create({
      data: {
        companyId: params.companyId,
        teamId: params.teamId,
        staffUserId: params.staffUserId,
        source: params.companyRelationshipId ? "CLIENT" : "INHOUSE",
        companyRelationshipId: params.companyRelationshipId,
        taskName: params.taskName,
        date: params.date,
        startTime: params.startTime,
        endTime: params.endTime,
        isAllDay: params.isAllDay,
        isUndecided: params.isUndecided,
        note: params.note,
        createdVia: "ASSIGN",
      },
    });

    for (const overriddenId of params.overrideShiftIds ?? []) {
      await supersedeShift(tx, {
        shiftId: overriddenId,
        newShiftId: created.id,
        confirmedByUserId: params.confirmedByUserId,
      });
    }

    return created;
  });

  return { status: "created" as const, shift };
}

// companyRelationshipIdが指定された場合、絞り込み方向は関係の向きで決まる
// (自社が"agencyCompanyId"側＝依頼主なら、その依頼主向けオーダーのシフトを
// companyRelationshipIdで直接絞る／自社が"clientCompanyId"側＝派遣会社なら、
// その派遣会社から配属記録のあるスタッフの自社内(INHOUSE)シフトを絞る)。
export async function listShiftsForMonth(params: {
  companyId: string;
  year: number;
  month: number; // 1-12
  teamId?: string;
  // チームマネージャー/リーダーが会社側の管理画面を見るとき、自分が
  // 所属しないチームのシフトは見えないようにする絞り込み（本部管理者/
  // 編集者はundefinedのまま渡され、無制限）。teamIdによる単一チームの
  // 絞り込みと共存できるよう別パラメータにしている。
  restrictToTeamIds?: string[];
  companyRelationshipId?: string;
}) {
  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  const where: Prisma.ShiftWhereInput = {
    companyId: params.companyId,
    teamId: params.teamId ?? (params.restrictToTeamIds ? { in: params.restrictToTeamIds } : undefined),
    date: { gte: start, lt: end },
    status: { notIn: ["SUPERSEDED", "CANCELLED"] },
  };

  if (params.companyRelationshipId) {
    const rel = await prisma.companyRelationship.findUniqueOrThrow({ where: { id: params.companyRelationshipId } });
    if (rel.agencyCompanyId === params.companyId) {
      where.companyRelationshipId = params.companyRelationshipId;
    } else if (rel.clientCompanyId === params.companyId) {
      const placements = await prisma.staffPlacement.findMany({
        where: { companyRelationshipId: params.companyRelationshipId },
        select: { staffUserId: true },
      });
      where.staffUserId = { in: placements.map((p) => p.staffUserId) };
      where.source = "INHOUSE";
    }
  }

  return prisma.shift.findMany({
    where,
    include: {
      staff: true,
      workReport: true,
      companyRelationship: { include: { clientCompany: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
}

// キャンセル・上書きで外れたシフト/募集枠の履歴。物理削除はしておらず
// status(SUPERSEDED/CANCELLED)を変えているだけなので、各カード下部に薄く
// 出す「変更履歴」表示のためだけに別途取得する（通常の一覧には出さない）。
// publicRecruitmentIdの有無は問わない — 募集経由でない手動アサインの
// キャンセルもスタッフシフトタブの履歴に含める。
export async function listShiftHistoryForMonth(params: {
  companyId: string;
  year: number;
  month: number;
  teamId?: string;
  restrictToTeamIds?: string[];
}) {
  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  return prisma.shift.findMany({
    where: {
      companyId: params.companyId,
      teamId: params.teamId ?? (params.restrictToTeamIds ? { in: params.restrictToTeamIds } : undefined),
      date: { gte: start, lt: end },
      status: { in: ["SUPERSEDED", "CANCELLED"] },
    },
    include: {
      staff: true,
      // 移動元の会社／募集名を「変更履歴」に出すため辿る（移動先は既に
      // その枠のカードに正式に表示されるので不要 — 出すのは変更前の情報のみ）。
      publicRecruitment: { include: { company: true } },
    },
    orderBy: [{ date: "asc" }, { updatedAt: "asc" }],
  });
}

export async function listStaffShiftsForMonth(params: {
  staffUserId: string;
  year: number;
  month: number;
}) {
  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  return prisma.shift.findMany({
    where: {
      staffUserId: params.staffUserId,
      date: { gte: start, lt: end },
      status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    },
    include: { company: true },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
}

// 希望を出す (staff self-submitted availability). Treated as confirmed on
// submission — the employer only decides how/whether to match it to a slot,
// not whether to approve the request itself (chat9).
export async function submitShiftRequest(params: {
  staffUserId: string;
  companyId: string;
  teamId?: string;
  desire: "WORK" | "OFF";
  dates: Date[];
  note?: string;
}) {
  return prisma.shiftRequest.create({
    data: {
      staffUserId: params.staffUserId,
      companyId: params.companyId,
      teamId: params.teamId,
      desire: params.desire,
      dates: params.dates,
      note: params.note,
    },
  });
}

export async function listShiftRequests(params: { companyId: string; status?: "PENDING" | "MATCHED" | "DISMISSED" }) {
  return prisma.shiftRequest.findMany({
    where: { companyId: params.companyId, status: params.status },
    include: { staff: true },
    orderBy: { createdAt: "asc" },
  });
}

// Company matches a (portion of a) staff request to an actual shift slot.
// No conflict check here by design (see module doc comment above) — matching
// a WORK request the staff themselves submitted is treated as pre-confirmed.
export async function matchShiftRequestToShift(params: {
  shiftRequestId: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  teamId?: string;
  note?: string;
}) {
  const request = await prisma.shiftRequest.findUniqueOrThrow({
    where: { id: params.shiftRequestId },
  });

  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.create({
      data: {
        companyId: request.companyId,
        teamId: params.teamId ?? request.teamId,
        staffUserId: request.staffUserId,
        source: "INHOUSE",
        date: params.date,
        startTime: params.startTime,
        endTime: params.endTime,
        isAllDay: params.isAllDay,
        isUndecided: params.isUndecided,
        note: params.note,
        createdVia: "STAFF_APPLICATION",
      },
    });

    await tx.shiftRequest.update({
      where: { id: request.id },
      data: { status: "MATCHED", matchedShiftId: shift.id },
    });

    return shift;
  });
}

export async function dismissShiftRequest(shiftRequestId: string) {
  return prisma.shiftRequest.update({
    where: { id: shiftRequestId },
    data: { status: "DISMISSED" },
  });
}

// 解除 — cancel any CONFIRMED shift the caller's company owns, not just
// recruitment-originated ones. A client cancelling on short notice is
// exactly the case that needs this: the admin cancels the existing shift
// and re-assigns someone else, so this reopens whatever produced the shift
// rather than leaving it stranded — a PublicRecruitment entry (filled count
// drops so the slot can be refilled) or a matched ShiftRequest (goes back to
// PENDING so it can be rematched). No Tee refund logic here; only
// stopOrDeleteRecruitment/updateMaxEntries touch locked Tee.
export async function cancelShift(params: { shiftId: string; actorCompanyId: string }) {
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.findUniqueOrThrow({ where: { id: params.shiftId } });

    if (shift.companyId !== params.actorCompanyId) {
      throw new Error("forbidden");
    }
    if (shift.status !== "CONFIRMED") {
      throw new Error("shift_not_active");
    }
    if (isPastDate(shift.date)) {
      throw new Error("shift_in_past");
    }

    await tx.shift.update({ where: { id: shift.id }, data: { status: "CANCELLED" } });

    if (shift.publicRecruitmentId) {
      const entry = await tx.recruitmentEntry.findFirst({ where: { resultingShiftId: shift.id } });
      if (entry) {
        await tx.recruitmentEntry.update({ where: { id: entry.id }, data: { status: "REJECTED" } });
      }
    }

    const matchedRequest = await tx.shiftRequest.findFirst({ where: { matchedShiftId: shift.id } });
    if (matchedRequest) {
      await tx.shiftRequest.update({
        where: { id: matchedRequest.id },
        data: { status: "PENDING", matchedShiftId: null },
      });
    }

    return shift;
  });
}
