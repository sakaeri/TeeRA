import "server-only";
import { prisma } from "@/lib/prisma";

// 手当（帯同手当・チップなど）。名前は会社が自由に作り、勤務（シフト）ごとに付ける。
// ・給料明細・スタッフの請求書：付けた手当がそのまま行になる（スタッフに払う金額）
// ・依頼主への請求書：「請求する」にした手当だけが行になる（依頼主に請求する金額）
// 付けた時点の金額を勤務ごとに持つので、あとで手当の金額を変えても付けた分は変わらない。

export type AllowanceInput = {
  name: string;
  amountType: "FIXED" | "VARIABLE";
  staffAmount: number | null;
  billToClient: boolean;
  clientAmount: number | null;
  staffCanReport: boolean;
};

export type AllowanceView = {
  id: string;
  name: string;
  amountType: "FIXED" | "VARIABLE";
  staffAmount: number | null;
  billToClient: boolean;
  clientAmount: number | null;
  staffCanReport: boolean;
  archived: boolean;
};

export class AllowanceError extends Error {}

function toView(a: {
  id: string;
  name: string;
  amountType: string;
  staffAmount: number | null;
  billToClient: boolean;
  clientAmount: number | null;
  staffCanReport: boolean;
  archivedAt: Date | null;
}): AllowanceView {
  return {
    id: a.id,
    name: a.name,
    amountType: a.amountType === "VARIABLE" ? "VARIABLE" : "FIXED",
    staffAmount: a.staffAmount,
    billToClient: a.billToClient,
    clientAmount: a.clientAmount,
    staffCanReport: a.staffCanReport,
    archived: a.archivedAt !== null,
  };
}

export async function listAllowances(companyId: string, opts: { includeArchived?: boolean } = {}) {
  const rows = await prisma.allowance.findMany({
    where: { companyId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toView);
}

function validate(input: AllowanceInput) {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new AllowanceError("手当の名前を入れてください");
  const amountType = input.amountType === "VARIABLE" ? "VARIABLE" : "FIXED";
  const staffAmount = amountType === "FIXED" ? Math.round(Number(input.staffAmount)) : null;
  if (amountType === "FIXED" && (!Number.isFinite(staffAmount) || staffAmount! <= 0)) {
    throw new AllowanceError("金額を入れてください");
  }
  const clientAmount =
    amountType === "FIXED" && input.billToClient && input.clientAmount != null && Number(input.clientAmount) > 0
      ? Math.round(Number(input.clientAmount))
      : null;
  return {
    name,
    amountType,
    staffAmount,
    billToClient: Boolean(input.billToClient),
    clientAmount,
    staffCanReport: Boolean(input.staffCanReport),
  };
}

export async function createAllowance(companyId: string, input: AllowanceInput) {
  const data = validate(input);
  const dup = await prisma.allowance.findFirst({ where: { companyId, name: data.name, archivedAt: null }, select: { id: true } });
  if (dup) throw new AllowanceError("同じ名前の手当があります");
  return toView(await prisma.allowance.create({ data: { companyId, ...data } }));
}

// 内容を変える（もう付けた勤務の金額は変わらない）
export async function updateAllowance(companyId: string, allowanceId: string, input: AllowanceInput) {
  const data = validate(input);
  const dup = await prisma.allowance.findFirst({
    where: { companyId, name: data.name, archivedAt: null, id: { not: allowanceId } },
    select: { id: true },
  });
  if (dup) throw new AllowanceError("同じ名前の手当があります");
  const existing = await prisma.allowance.findFirstOrThrow({ where: { id: allowanceId, companyId } });
  return toView(await prisma.allowance.update({ where: { id: existing.id }, data }));
}

// しまう（選ぶ候補に出さない）・戻す
export async function setAllowanceArchived(companyId: string, allowanceId: string, archived: boolean) {
  const existing = await prisma.allowance.findFirstOrThrow({ where: { id: allowanceId, companyId } });
  await prisma.allowance.update({ where: { id: existing.id }, data: { archivedAt: archived ? new Date() : null } });
}

// 勤務に付ける手当の選び方（固定の手当はIDだけ、毎回入れる手当は金額も）
export type ShiftAllowanceInput = { allowanceId: string; amount?: number | null };

export type ShiftAllowanceView = {
  allowanceId: string;
  name: string;
  amount: number;
  clientAmount: number | null;
};

export async function listShiftAllowances(shiftIds: string[]) {
  const map = new Map<string, ShiftAllowanceView[]>();
  if (shiftIds.length === 0) return map;
  const rows = await prisma.shiftAllowance.findMany({
    where: { shiftId: { in: shiftIds } },
    include: { allowance: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const r of rows) {
    map.set(r.shiftId, [
      ...(map.get(r.shiftId) ?? []),
      { allowanceId: r.allowanceId, name: r.allowance.name, amount: r.amount, clientAmount: r.clientAmount },
    ]);
  }
  return map;
}

// 勤務に付ける手当を、選んだものにそろえる（選ばなかった手当は外す）。
// byStaff：スタッフが業務報告で選んだ時。スタッフが選べない手当は、会社が付けたものをそのまま残す
export async function setShiftAllowances(params: {
  shiftId: string;
  items: ShiftAllowanceInput[];
  actorUserId: string;
  byStaff?: boolean;
}) {
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: params.shiftId }, select: { id: true, companyId: true } });
  const allowances = await prisma.allowance.findMany({ where: { companyId: shift.companyId } });
  const byId = new Map(allowances.map((a) => [a.id, a]));
  const existing = await prisma.shiftAllowance.findMany({ where: { shiftId: shift.id } });
  const existingById = new Map(existing.map((e) => [e.allowanceId, e]));
  // スタッフが触れない手当（会社だけが付ける）は、今の状態を残す
  const editable = (allowanceId: string) => !params.byStaff || Boolean(byId.get(allowanceId)?.staffCanReport);

  const wanted = new Map<string, { amount: number; clientAmount: number | null }>();
  for (const item of params.items) {
    const a = byId.get(String(item.allowanceId));
    if (!a || !editable(a.id)) continue;
    const prev = existingById.get(a.id);
    // しまった手当は、もう付いている時だけ残せる（新しくは付けられない）
    if (a.archivedAt && !prev) continue;
    let amount: number;
    if (a.amountType === "VARIABLE") {
      amount = Math.round(Number(item.amount));
      if (!Number.isFinite(amount) || amount <= 0) throw new AllowanceError(`「${a.name}」の金額を入れてください`);
    } else {
      // 決まった金額の手当は、もう付いていれば付けた時の金額のまま
      amount = prev?.amount ?? a.staffAmount ?? 0;
      if (amount <= 0) continue;
    }
    const clientAmount = a.billToClient
      ? a.amountType === "VARIABLE"
        ? amount
        : prev
          ? prev.clientAmount
          : (a.clientAmount ?? amount)
      : null;
    wanted.set(a.id, { amount, clientAmount });
  }

  await prisma.$transaction(async (tx) => {
    for (const e of existing) {
      if (!editable(e.allowanceId)) continue;
      if (!wanted.has(e.allowanceId)) await tx.shiftAllowance.delete({ where: { id: e.id } });
    }
    for (const [allowanceId, v] of wanted) {
      const prev = existingById.get(allowanceId);
      if (prev) {
        if (prev.amount !== v.amount || prev.clientAmount !== v.clientAmount) {
          await tx.shiftAllowance.update({ where: { id: prev.id }, data: { amount: v.amount, clientAmount: v.clientAmount } });
        }
      } else {
        await tx.shiftAllowance.create({
          data: { shiftId: shift.id, allowanceId, amount: v.amount, clientAmount: v.clientAmount, createdByUserId: params.actorUserId },
        });
      }
    }
  });
}

// 業務内容をまとめる時に、まとめた勤務へ手当を付ける（もう付いている勤務はそのまま）
export async function addAllowanceToShifts(params: { companyId: string; shiftIds: string[]; allowanceId: string; actorUserId: string }) {
  const a = await prisma.allowance.findFirstOrThrow({ where: { id: params.allowanceId, companyId: params.companyId } });
  if (a.amountType !== "FIXED" || !a.staffAmount) throw new AllowanceError("決まった金額の手当を選んでください");
  const existing = new Set(
    (await prisma.shiftAllowance.findMany({ where: { shiftId: { in: params.shiftIds }, allowanceId: a.id }, select: { shiftId: true } })).map(
      (r) => r.shiftId,
    ),
  );
  const targets = params.shiftIds.filter((id) => !existing.has(id));
  if (targets.length === 0) return 0;
  await prisma.shiftAllowance.createMany({
    data: targets.map((shiftId) => ({
      shiftId,
      allowanceId: a.id,
      amount: a.staffAmount!,
      clientAmount: a.billToClient ? (a.clientAmount ?? a.staffAmount!) : null,
      createdByUserId: params.actorUserId,
    })),
  });
  return targets.length;
}

// スタッフの業務報告の画面用：会社ごとのスタッフが選べる手当と、勤務ごとに付いている手当
export async function staffAllowanceContext(companyIds: string[], shiftIds: string[]) {
  const [options, byShift] = await Promise.all([
    prisma.allowance.findMany({
      where: { companyId: { in: companyIds }, archivedAt: null, staffCanReport: true },
      orderBy: { createdAt: "asc" },
    }),
    listShiftAllowances(shiftIds),
  ]);
  const optionsByCompany = new Map<string, { id: string; name: string; amountType: "FIXED" | "VARIABLE"; staffAmount: number | null }[]>();
  for (const o of options) {
    optionsByCompany.set(o.companyId, [
      ...(optionsByCompany.get(o.companyId) ?? []),
      { id: o.id, name: o.name, amountType: o.amountType === "VARIABLE" ? "VARIABLE" : "FIXED", staffAmount: o.staffAmount },
    ]);
  }
  return { optionsByCompany, byShift };
}
