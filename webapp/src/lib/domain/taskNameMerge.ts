import "server-only";
import { prisma } from "@/lib/prisma";
import { resolveRateVersion } from "@/lib/domain/contracts";
import { todayJst } from "@/lib/date";

// 依頼主ごとの「業務内容をまとめる」。同じ仕事が「キャディ業務」「キャディー」のように別の名前で
// 入っていると、請求書の行が分かれてしまうため、片方の名前にそろえる。
// 対象はその依頼主の分だけ：シフト・業務報告の業務内容、依頼主の単価、スタッフの（その依頼主での）単価、
// まだ発行していない請求書の明細の文言。発行済みの請求書は出したものなので変えない。

// 「キャディ業務」「キャディー」「キャディ・業務」→「キャディ」。似た名前を見つけるためだけに使う
export function normalizeTaskName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/[\s・\-－ー―‐_/／（）()]/g, "")
    .replace(/(業務|作業|担当|係)$/g, "")
    .toLowerCase();
}

// 似た名前のまとまり（2つ以上あるものだけ）。例：[["キャディ業務", "キャディー"]]
export function findSimilarTaskNames(names: string[]) {
  const groups = new Map<string, string[]>();
  for (const name of [...new Set(names)]) {
    const key = normalizeTaskName(name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// その依頼主で使っている業務内容（単価に登録したもの＋シフト・業務報告に入っているもの）
export async function listClientTaskNames(companyId: string, companyRelationshipId: string) {
  const [rates, shifts, reports] = await Promise.all([
    prisma.companyPlacementRate.findMany({ where: { companyId, companyRelationshipId }, select: { taskName: true } }),
    prisma.shift.findMany({
      where: { companyId, companyRelationshipId, taskName: { not: null } },
      select: { taskName: true },
      distinct: ["taskName"],
    }),
    prisma.workReport.findMany({
      where: { shift: { companyId, companyRelationshipId }, taskName: { not: null } },
      select: { taskName: true },
      distinct: ["taskName"],
    }),
  ]);
  const names = [...rates.map((r) => r.taskName), ...shifts.map((s) => s.taskName!), ...reports.map((r) => r.taskName!)];
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function currentRateLabel(versions: Parameters<typeof resolveRateVersion>[0]) {
  const current = resolveRateVersion(versions, new Date(`${todayJst()}T00:00:00.000Z`));
  if (!current) return null;
  if (current.amount === 0) return "請求なし";
  const unit = current.wageType === "DAILY" ? "日給" : current.wageType === "MONTHLY" ? "月給" : "時給";
  return `${unit}${current.amount.toLocaleString()}円`;
}

// まとめる前の確認：何件変わるか・単価が違わないか
export async function taskNameMergePreview(companyId: string, companyRelationshipId: string, from: string, to: string) {
  const [shiftCount, reportCount, fromRate, toRate] = await Promise.all([
    prisma.shift.count({ where: { companyId, companyRelationshipId, taskName: from } }),
    prisma.workReport.count({ where: { shift: { companyId, companyRelationshipId }, taskName: from } }),
    prisma.companyPlacementRate.findUnique({
      where: { companyId_companyRelationshipId_taskName: { companyId, companyRelationshipId, taskName: from } },
      include: { versions: true },
    }),
    prisma.companyPlacementRate.findUnique({
      where: { companyId_companyRelationshipId_taskName: { companyId, companyRelationshipId, taskName: to } },
      include: { versions: true },
    }),
  ]);
  const fromRateLabel = fromRate ? currentRateLabel(fromRate.versions) : null;
  const toRateLabel = toRate ? currentRateLabel(toRate.versions) : null;
  return {
    shiftCount,
    reportCount,
    fromRateLabel,
    toRateLabel,
    // 両方に単価があって違う時は、残す方の単価になることを知らせる
    rateDiffers: Boolean(fromRateLabel && toRateLabel && fromRateLabel !== toRateLabel),
  };
}

export async function mergeClientTaskNames(params: { companyId: string; companyRelationshipId: string; from: string; to: string }) {
  const { companyId, companyRelationshipId } = params;
  const from = params.from.trim();
  const to = params.to.trim();
  if (!from || !to || from === to) throw new Error("invalid_task_names");

  await prisma.$transaction(async (tx) => {
    await tx.shift.updateMany({ where: { companyId, companyRelationshipId, taskName: from }, data: { taskName: to } });
    await tx.workReport.updateMany({ where: { shift: { companyId, companyRelationshipId }, taskName: from }, data: { taskName: to } });

    // 依頼主の単価：残す方があればまとめる方を消し、無ければ名前だけ変える（単価の履歴はそのまま）
    const fromRate = await tx.companyPlacementRate.findUnique({
      where: { companyId_companyRelationshipId_taskName: { companyId, companyRelationshipId, taskName: from } },
    });
    if (fromRate) {
      const toRate = await tx.companyPlacementRate.findUnique({
        where: { companyId_companyRelationshipId_taskName: { companyId, companyRelationshipId, taskName: to } },
      });
      if (toRate) await tx.companyPlacementRate.delete({ where: { id: fromRate.id } });
      else await tx.companyPlacementRate.update({ where: { id: fromRate.id }, data: { taskName: to } });
    }

    // スタッフの、この依頼主での単価も同じようにまとめる（単価の入っている方を残す）
    const fromStaffRates = await tx.staffTaskRate.findMany({ where: { companyId, companyRelationshipId, taskName: from } });
    for (const r of fromStaffRates) await mergeStaffRateInto(tx, r.id, to);

    // まだ発行していない請求書の明細の文言（手で直した行は作り直されないため、ここで直す）
    const lines = await tx.invoiceLine.findMany({
      where: { invoice: { issuingCompanyId: companyId, companyRelationshipId, status: "DRAFT" }, description: { contains: `（${from}）` } },
      select: { id: true, description: true },
    });
    for (const l of lines) {
      await tx.invoiceLine.update({ where: { id: l.id }, data: { description: l.description.split(`（${from}）`).join(`（${to}）`) } });
    }
  });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

function hasPricedVersion(versions: { wageType: string | null; amount: number | null }[]) {
  return versions.some((v) => v.wageType !== null && v.amount !== null);
}

// スタッフの単価の行の名前を to に変える。同じスタッフ・勤務先に to の行が既にあれば、単価の入っている方を残す
// （両方に単価が入っている時は、to の方を残して元の行を消す）。単価の入っていない行は計算に使われないので消しても金額は変わらない
async function mergeStaffRateInto(tx: Tx, staffTaskRateId: string, to: string) {
  const source = await tx.staffTaskRate.findUniqueOrThrow({ where: { id: staffTaskRateId }, include: { versions: true } });
  const target = await tx.staffTaskRate.findFirst({
    where: {
      companyId: source.companyId,
      staffUserId: source.staffUserId,
      companyRelationshipId: source.companyRelationshipId,
      taskName: to,
      id: { not: source.id },
    },
    include: { versions: true },
  });
  if (!target) {
    await tx.staffTaskRate.update({ where: { id: source.id }, data: { taskName: to } });
    return;
  }
  if (hasPricedVersion(source.versions) && !hasPricedVersion(target.versions)) {
    await tx.staffTaskRate.delete({ where: { id: target.id } });
    await tx.staffTaskRate.update({ where: { id: source.id }, data: { taskName: to } });
  } else {
    await tx.staffTaskRate.delete({ where: { id: source.id } });
  }
}

// スタッフの単価のうち、取引先の業務内容に無い名前の行（以前シフトから自動で作られた名前など）と、
// 取引先の業務内容のうち似た名前（そろえる先の候補）
export async function listStaffRateNameMismatches(companyId: string, companyRelationshipId: string) {
  const [clientRates, staffRates] = await Promise.all([
    prisma.companyPlacementRate.findMany({ where: { companyId, companyRelationshipId }, select: { taskName: true } }),
    prisma.staffTaskRate.findMany({
      where: { companyId, companyRelationshipId },
      include: { versions: true, staff: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const clientNames = clientRates.map((r) => r.taskName);
  return staffRates
    .filter((r) => !clientNames.includes(r.taskName))
    .map((r) => ({
      staffTaskRateId: r.id,
      staffName: r.staff.name,
      from: r.taskName,
      to: suggestClientTaskName(r.taskName, clientNames),
      priced: hasPricedVersion(r.versions),
    }))
    .filter((m): m is typeof m & { to: string } => m.to !== null);
}

// 取引先の業務内容のうち、似た名前（同じ仲間）が1つだけならそれ
export function suggestClientTaskName(name: string, clientNames: string[]) {
  const key = normalizeTaskName(name);
  const matches = clientNames.filter((n) => normalizeTaskName(n) === key);
  return matches.length === 1 ? matches[0] : null;
}

// 取引先の単価タブの「スタッフの単価の名前を取引先の名前にそろえる」（全員分まとめて）
export async function alignStaffRateNames(companyId: string, companyRelationshipId: string) {
  const mismatches = await listStaffRateNameMismatches(companyId, companyRelationshipId);
  await prisma.$transaction(async (tx) => {
    for (const m of mismatches) await mergeStaffRateInto(tx, m.staffTaskRateId, m.to);
  });
  return mismatches.length;
}

// スタッフ詳細の単価から1件ずつそろえる
export async function alignStaffRateName(companyId: string, staffTaskRateId: string, to: string) {
  const rate = await prisma.staffTaskRate.findFirstOrThrow({ where: { id: staffTaskRateId, companyId } });
  if (!rate.companyRelationshipId) throw new Error("no_workplace");
  const exists = await prisma.companyPlacementRate.findFirst({
    where: { companyId, companyRelationshipId: rate.companyRelationshipId, taskName: to },
    select: { id: true },
  });
  if (!exists) throw new Error("unknown_task_name");
  await prisma.$transaction(async (tx) => mergeStaffRateInto(tx, staffTaskRateId, to));
  return rate.staffUserId;
}
