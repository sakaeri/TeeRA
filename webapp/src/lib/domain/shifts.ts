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

// findConflictingShiftsの重複警告用 — 現場移動時間を見込み、確定シフトの
// 前後にこの分数だけ余白を持たせてから重複判定する（あくまで警告の閾値
// であり、timeRangesOverlap自体の「隣接は重複ではない」という定義は
// 変えない）。
const CONFLICT_WARNING_BUFFER_MINUTES = 60;

function timeRangesOverlapWithBuffer(
  a: { startTime: string | null; endTime: string | null; isAllDay: boolean; isUndecided: boolean },
  b: { startTime: string | null; endTime: string | null; isAllDay: boolean; isUndecided: boolean },
  bufferMinutes: number,
) {
  if (a.isAllDay || a.isUndecided || b.isAllDay || b.isUndecided) return true;
  if (!a.startTime || !a.endTime || !b.startTime || !b.endTime) return true;

  const aStart = timeToMinutes(a.startTime) - bufferMinutes;
  const aEnd = timeToMinutes(a.endTime) + bufferMinutes;
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

// 依頼主の取り消しで「調整中」になっているシフトは、同じ日に別のシフトへ
// 入れた（＝振り替えた）時点で役目を終えるので、取り消し扱いにする。
// キャンセル料の記録（ShiftCancellation）は残るので請求には影響しない。
export async function releaseHeldShiftsOnReassign(client: Tx | typeof prisma, staffUserId: string, date: Date) {
  await client.shift.updateMany({ where: { staffUserId, date, status: "ON_HOLD" }, data: { status: "CANCELLED" } });
}

export async function findConflictingShifts(
  client: Tx | typeof prisma,
  params: {
    staffUserId: string;
    date: Date;
    startTime: string | null;
    endTime: string | null;
    isAllDay: boolean;
    isUndecided: boolean;
    excludeShiftId?: string;
  },
) {
  const sameDayShifts = await client.shift.findMany({
    where: {
      staffUserId: params.staffUserId,
      date: params.date,
      status: "CONFIRMED",
      id: params.excludeShiftId ? { not: params.excludeShiftId } : undefined,
    },
  });

  // 警告であって強制ブロックではない（管理者は確認のうえ続行できる）ため、
  // 現場移動時間を見込んで前後1時間の余白を持たせて判定する — ぴったり
  // 隣接するシフトも「確認してください」の対象にする。
  return sameDayShifts.filter((s) => timeRangesOverlapWithBuffer(params, s, CONFLICT_WARNING_BUFFER_MINUTES));
}

// 休み希望を出している日にアサインしようとした時、会社側に一度確認を
// 挟むための判定。findConflictingShifts(シフトの重複)とは別の軸のチェック
// — 休み希望自体は会社の承認を必要としない記録だが、それでもアサイン
// しようとした場合だけ「本当にいいですか」と聞く。
export async function findPendingOffRequest(client: Tx | typeof prisma, staffUserId: string, date: Date) {
  return client.shiftRequest.findFirst({
    where: { staffUserId, desire: "OFF", status: "PENDING", dates: { has: date } },
  });
}

// 出勤希望を出している日にシフトが作られた/アサインされた時、その希望を
// 自動的に「対応済み」(MATCHED)にする — 以前あった「マッチさせる」で
// 時間だけ選んで確定する独立操作は廃止し、実際のシフト作成/アサイン
// そのものを確定操作として扱う(どの依頼主のどの業務にマッチするのかが
// わかった状態でしか確定できないようにするため)。
// 1件のShiftRequestが複数日をまとめて持てるため(dates: DateTime[])、その
// うちの1日だけが確定した場合は対象の日だけを切り出して別行にする —
// status/matchedShiftIdは行単位なので、そのまま更新すると未確定のまま
// 残っているはずの他の日まで一緒にMATCHED扱いになってしまう。
export async function autoResolveMatchingWorkRequest(
  tx: Tx,
  params: { staffUserId: string; companyId: string; date: Date; shiftId: string },
) {
  const request = await tx.shiftRequest.findFirst({
    where: {
      staffUserId: params.staffUserId,
      companyId: params.companyId,
      desire: "WORK",
      status: "PENDING",
      dates: { has: params.date },
    },
  });
  if (!request) return;

  const remainingDates = request.dates.filter((d) => d.getTime() !== params.date.getTime());

  if (remainingDates.length === 0) {
    await tx.shiftRequest.update({
      where: { id: request.id },
      data: { status: "MATCHED", matchedShiftId: params.shiftId },
    });
  } else {
    await tx.shiftRequest.update({
      where: { id: request.id },
      data: { dates: remainingDates },
    });
    await tx.shiftRequest.create({
      data: {
        staffUserId: request.staffUserId,
        companyId: request.companyId,
        teamId: request.teamId,
        desire: "WORK",
        dates: [params.date],
        note: request.note,
        status: "MATCHED",
        matchedShiftId: params.shiftId,
      },
    });
  }
}

// シフトを作成 (company-initiated assign). Runs the overlap conflict check —
// this check is intentionally NOT applied to staff self-apply flows
// (applyToRecruitment), which is a known, deliberately-unresolved gap
// carried over from the design (chat27/31).
// companyRelationshipIdが指定された場合（＝依頼主へのアサイン）、配属記録
// (StaffPlacement)も一緒に登録する — 派遣会社が能動的にアサインする操作
// （このシフト作成とオーダーへのアサイン）は配属になる、というルール。
// 公開募集への自己応募(applyToRecruitment)はこの対象外（フリーのまま）。
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
  confirmedDespiteOffRequest?: boolean; // set when the caller has already confirmed assigning despite a pending 休み希望
  companyRelationshipId?: string; // set for 取引先オーダー (source becomes CLIENT, billable on that client's invoice)
  taskName?: string; // 業務内容 — 単価は保持しない。給与/請求計算時にその都度参照される
}) {
  return prisma.$transaction(async (tx) => {
    // 同じスタッフ×日付への重複チェック(findConflictingShifts)とアサイン
    // 作成の間に別のリクエストが割り込むと、両方とも「重複なし」を見た
    // まま2件とも作成されてしまう(TOCTOU)。この組み合わせのアドバイザリ
    // ロックで直列化し、後勝ちの呼び出しはロック取得後に再度チェックして
    // 初めて見える重複を正しく検出できるようにする(startStaffContractと
    // 同じ考え方)。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.staffUserId} || ':' || ${params.date.toISOString()}))`;

    if (!params.confirmedDespiteOffRequest) {
      const offRequest = await findPendingOffRequest(tx, params.staffUserId, params.date);
      if (offRequest) {
        return { status: "off_request" as const, offRequest };
      }
    }

    const conflicts = await findConflictingShifts(tx, {
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
    await releaseHeldShiftsOnReassign(tx, params.staffUserId, params.date);

    if (params.companyRelationshipId) {
      await tx.staffPlacement.upsert({
        where: {
          staffUserId_companyRelationshipId: {
            staffUserId: params.staffUserId,
            companyRelationshipId: params.companyRelationshipId,
          },
        },
        create: { staffUserId: params.staffUserId, companyRelationshipId: params.companyRelationshipId },
        // 配属解除(active=false)されていても、能動的なアサインで再配属される
        update: { active: true, endedAt: null },
      });
    }

    for (const overriddenId of params.overrideShiftIds ?? []) {
      await supersedeShift(tx, {
        shiftId: overriddenId,
        newShiftId: created.id,
        confirmedByUserId: params.confirmedByUserId,
      });
    }

    await autoResolveMatchingWorkRequest(tx, {
      staffUserId: params.staffUserId,
      companyId: params.companyId,
      date: params.date,
      shiftId: created.id,
    });

    return { status: "created" as const, shift: created };
  });
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

  const own: Prisma.ShiftWhereInput = {
    companyId: params.companyId,
    teamId: params.teamId ?? (params.restrictToTeamIds ? { in: params.restrictToTeamIds } : undefined),
  };
  // 派遣会社が自社（依頼主）の現場に入れたシフト（派遣会社名義）。シフトは
  // 派遣会社・スタッフ・依頼主の三者で共有するため、依頼主のカレンダーにも出す。
  // チームでの絞り込みは依頼主側のチームとは関係がないので、全体表示の時だけ。
  let clientSite: Prisma.ShiftWhereInput | null =
    params.teamId || params.restrictToTeamIds
      ? null
      : {
          source: "CLIENT",
          companyId: { not: params.companyId },
          companyRelationship: { clientCompanyId: params.companyId },
        };

  if (params.companyRelationshipId) {
    const rel = await prisma.companyRelationship.findUniqueOrThrow({ where: { id: params.companyRelationshipId } });
    if (rel.agencyCompanyId === params.companyId) {
      own.companyRelationshipId = params.companyRelationshipId;
      clientSite = null;
    } else if (rel.clientCompanyId === params.companyId) {
      const placements = await prisma.staffPlacement.findMany({
        where: { companyRelationshipId: params.companyRelationshipId },
        select: { staffUserId: true },
      });
      own.staffUserId = { in: placements.map((p) => p.staffUserId) };
      own.source = "INHOUSE";
      if (clientSite) clientSite.companyRelationshipId = params.companyRelationshipId;
    }
  }

  const where: Prisma.ShiftWhereInput = {
    date: { gte: start, lt: end },
    status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    OR: clientSite ? [own, clientSite] : [own],
  };

  return prisma.shift.findMany({
    where,
    include: {
      staff: true,
      workReport: true,
      companyRelationship: { include: { clientCompany: true, agencyCompany: true } },
      cancellation: true,
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
      // 調整中（依頼主の取り消し後、振り替えるか未定）も、取り消された
      // 事実が分かるよう履歴に出す
      status: { in: ["SUPERSEDED", "CANCELLED", "ON_HOLD"] },
    },
    include: {
      staff: true,
      // 移動元の会社／募集名を「変更履歴」に出すため辿る（移動先は既に
      // その枠のカードに正式に表示されるので不要 — 出すのは変更前の情報のみ）。
      publicRecruitment: { include: { company: true } },
      // 勤務先（依頼主名）と、取り消しの理由・キャンセル料
      companyRelationship: { include: { clientCompany: true } },
      cancellation: true,
    },
    orderBy: [{ date: "asc" }, { updatedAt: "asc" }],
  });
}

// スタッフのカレンダーは「今アクティブな会社」ではなく、所属する全社分を
// まとめて1つに表示する（スタッフ画面はその人個人の所有物で、会社側の
// ように会社ごとに視点を切り替えるものではないため）。companyIdsは
// listMyMembershipsで取得した、そのスタッフが所属する全社のID一覧。
export async function listStaffShiftsForMonth(params: {
  staffUserId: string;
  companyIds: string[];
  year: number;
  month: number;
}) {
  const start = new Date(Date.UTC(params.year, params.month - 1, 1));
  const end = new Date(Date.UTC(params.year, params.month, 1));

  return prisma.shift.findMany({
    where: {
      staffUserId: params.staffUserId,
      companyId: { in: params.companyIds },
      date: { gte: start, lt: end },
      status: { notIn: ["SUPERSEDED", "CANCELLED"] },
    },
    include: {
      company: true,
      workReport: true,
      companyRelationship: { include: { clientCompany: true } },
      publicRecruitment: { include: { announcements: { orderBy: { createdAt: "asc" } } } },
    },
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

// 提出済みのシフト希望が会社側でどう反映されるか（マッチ/見送り）待ちの間、
// スタッフ本人のカレンダーにも「回答待ち」として見えるようにする。マッチ
// 済みになった時点で実際のShiftが作られそちらに表示が移るため対象外。
// DISMISSED（会社が見送った）は、本人に何も知らせず消してしまうと「消えた
// 理由が分からない」ため、軽い「今回は見送られました」表示のためにここでも
// 取得する。
export async function listOwnPendingShiftRequests(params: { staffUserId: string; companyIds: string[] }) {
  return prisma.shiftRequest.findMany({
    where: {
      staffUserId: params.staffUserId,
      companyId: { in: params.companyIds },
      status: { in: ["PENDING", "DISMISSED"] },
    },
    include: { company: true },
    orderBy: { createdAt: "desc" },
  });
}

// 会社側の「見送る」操作 — 複数日をまとめて持つ1行のうち、この日付分だけを
// DISMISSEDへ切り出す（autoResolveMatchingWorkRequestと同じ、1行=複数日
// なので特定の日だけ確定/見送りする時は行を分割する必要があるパターン）。
export async function dismissShiftRequest(params: { requestId: string; companyId: string; date: Date }) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.shiftRequest.findFirst({
      where: {
        id: params.requestId,
        companyId: params.companyId,
        desire: "WORK",
        status: "PENDING",
        dates: { has: params.date },
      },
    });
    if (!request) throw new Error("shift_request_not_found");

    const remainingDates = request.dates.filter((d) => d.getTime() !== params.date.getTime());

    if (remainingDates.length === 0) {
      await tx.shiftRequest.update({ where: { id: request.id }, data: { status: "DISMISSED" } });
    } else {
      await tx.shiftRequest.update({ where: { id: request.id }, data: { dates: remainingDates } });
      await tx.shiftRequest.create({
        data: {
          staffUserId: request.staffUserId,
          companyId: request.companyId,
          teamId: request.teamId,
          desire: "WORK",
          dates: [params.date],
          note: request.note,
          status: "DISMISSED",
        },
      });
    }
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
export async function cancelShift(params: {
  shiftId: string;
  actorCompanyId: string;
  actorUserId?: string;
  // 依頼主都合（電話等で受けた取り消し）として記録する場合のキャンセル料。
  // 未指定なら自社都合の解除で、キャンセル料の記録は作らない。
  clientCancellationFee?: number;
  // trueなら休みにせず「調整中」にして、振り替えるかどうかを後で決める
  holdForReassignment?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.findUniqueOrThrow({ where: { id: params.shiftId } });

    if (shift.companyId !== params.actorCompanyId) {
      throw new Error("forbidden");
    }
    if (shift.status !== "CONFIRMED" && shift.status !== "ON_HOLD") {
      throw new Error("shift_not_active");
    }
    if (isPastDate(shift.date)) {
      throw new Error("shift_in_past");
    }

    // 調整中のシフトを「休みにする」— 依頼主の取り消し時点で枠の解放やキャンセル
    // 料の記録は済んでいるので、状態を変えるだけ。
    if (shift.status === "ON_HOLD") {
      return tx.shift.update({ where: { id: shift.id }, data: { status: "CANCELLED" } });
    }

    if (params.clientCancellationFee !== undefined && shift.source !== "CLIENT") {
      throw new Error("not_client_shift");
    }
    // 自社都合の解除も（キャンセル料0で）記録し、変更履歴に理由を出せるようにする
    await tx.shiftCancellation.create({
      data: {
        shiftId: shift.id,
        cancelledByCompanyId: params.actorCompanyId,
        cancelledByUserId: params.actorUserId,
        source: params.clientCancellationFee !== undefined ? "CLIENT_REPORTED" : "AGENCY_OWN",
        feeAmount: Math.max(0, Math.round(params.clientCancellationFee ?? 0)),
      },
    });

    const updated = await tx.shift.update({
      where: { id: shift.id },
      data: { status: params.holdForReassignment ? "ON_HOLD" : "CANCELLED" },
    });

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

    return updated;
  });
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// 派遣会社（別会社）が、companyIdの会社（依頼主）の現場に入れたシフトかどうか。
// 依頼主のカレンダーにも出し、依頼主が出勤時間を入力・変更できる対象。
export function isClientSiteShiftOf(
  shift: { companyId: string; source: string; companyRelationship: { clientCompanyId: string | null } | null },
  companyId: string,
) {
  return shift.companyId !== companyId && shift.source === "CLIENT" && shift.companyRelationship?.clientCompanyId === companyId;
}

// 作成済みシフトの出勤時間を入力・変更する（「時間未定」で作ったシフトに、
// 前日などに決まったスタート時間を入れる用途が主）。重複は作成時と同じく
// 警告扱いで、確認のうえ続行できる（作成時と違い、重なる側のシフトは
// 置き換えずにそのまま残す）。業務報告が出た後・日付が過ぎた後は変えない
// （実績側で直す）。
export async function updateShiftTime(params: {
  shiftId: string;
  actorCompanyId: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isUndecided: boolean;
  confirmedDespiteConflict?: boolean;
}) {
  const timed = !params.isAllDay && !params.isUndecided;
  if (params.isAllDay && params.isUndecided) throw new Error("invalid_time");
  if (timed && !(params.startTime && TIME_PATTERN.test(params.startTime) && params.endTime && TIME_PATTERN.test(params.endTime))) {
    throw new Error("invalid_time");
  }
  const startTime = timed ? params.startTime : null;
  const endTime = timed ? params.endTime : null;

  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.findUniqueOrThrow({
      where: { id: params.shiftId },
      include: { workReport: true, companyRelationship: true },
    });
    // 自社名義のシフトか、派遣会社が自社（依頼主）の現場に入れたシフトなら変えられる
    // （スタート時間を決めるのは現場の依頼主側のことが多いため）
    const editedByClient = isClientSiteShiftOf(shift, params.actorCompanyId);
    if (shift.companyId !== params.actorCompanyId && !editedByClient) throw new Error("forbidden");
    if (shift.status !== "CONFIRMED") throw new Error("shift_not_active");
    if (isPastDate(shift.date)) throw new Error("shift_in_past");
    if (shift.workReport?.submittedAt) throw new Error("report_submitted");

    if (
      shift.startTime === startTime &&
      shift.endTime === endTime &&
      shift.isAllDay === params.isAllDay &&
      shift.isUndecided === params.isUndecided
    ) {
      return { status: "unchanged" as const, shift, editedByClient };
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shift.staffUserId} || ':' || ${shift.date.toISOString()}))`;
    if (!params.confirmedDespiteConflict) {
      const conflicts = await findConflictingShifts(tx, {
        staffUserId: shift.staffUserId,
        date: shift.date,
        startTime,
        endTime,
        isAllDay: params.isAllDay,
        isUndecided: params.isUndecided,
        excludeShiftId: shift.id,
      });
      if (conflicts.length > 0) return { status: "conflict" as const, conflicts };
    }

    const updated = await tx.shift.update({
      where: { id: shift.id },
      data: {
        startTime,
        endTime,
        isAllDay: params.isAllDay,
        isUndecided: params.isUndecided,
        // 時間が決まったら、その時間に合わせて開始前のリマインドを送り直せるようにする
        // （未定・終日に戻した場合は、変更の通知で知らせるので朝のリマインドは送り直さない）
        ...(timed ? { reminderSentAt: null } : {}),
      },
    });
    return { status: "updated" as const, shift: updated, previous: shift, editedByClient };
  });
}
