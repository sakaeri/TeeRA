import "server-only";
import { prisma } from "@/lib/prisma";

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
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
  overrideShiftId?: string; // set when the caller has already confirmed the override with staff
  companyRelationshipId?: string; // set for 取引先オーダー (source becomes CLIENT, billable on that client's invoice)
}) {
  const conflicts = await findConflictingShifts({
    staffUserId: params.staffUserId,
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    isAllDay: params.isAllDay,
    isUndecided: params.isUndecided,
  });

  if (conflicts.length > 0 && !params.overrideShiftId) {
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
        date: params.date,
        startTime: params.startTime,
        endTime: params.endTime,
        isAllDay: params.isAllDay,
        isUndecided: params.isUndecided,
        note: params.note,
        createdVia: "ASSIGN",
      },
    });

    if (params.overrideShiftId) {
      await tx.shift.update({
        where: { id: params.overrideShiftId },
        data: { status: "SUPERSEDED" },
      });
      await tx.conflictOverride.create({
        data: {
          newShiftId: created.id,
          overriddenShiftId: params.overrideShiftId,
          confirmedByUserId: params.confirmedByUserId,
        },
      });
    }

    return created;
  });

  return { status: "created" as const, shift };
}

export async function listShiftsForMonth(params: {
  companyId: string;
  year: number;
  month: number; // 1-12
  teamId?: string;
}) {
  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  return prisma.shift.findMany({
    where: {
      companyId: params.companyId,
      teamId: params.teamId,
      date: { gte: start, lt: end },
      status: { not: "SUPERSEDED" },
    },
    include: {
      staff: true,
      workReport: true,
      companyRelationship: { include: { clientCompany: true } },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
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
      status: { not: "SUPERSEDED" },
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
