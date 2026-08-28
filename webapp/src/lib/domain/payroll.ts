import "server-only";
import { prisma } from "@/lib/prisma";
import { postLedgerEntry } from "@/lib/domain/wallet";
import { resolveRateVersion, resolveContractWageVersion, pickStaffTaskRate } from "@/lib/domain/contracts";

const FIXED_DEDUCTION_LABELS = ["社会保険料", "厚生年金", "雇用保険料", "所得税", "市県民税"];

export type DeductionItem = { id: string; label: string; amount: number };

function monthRange(targetMonth: string) {
  const [year, month] = targetMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

// シフトの日付時点で有効だった基本給バージョンを解決する必要があるため
// （改定後に過去分を再計算しても金額が変わらないように）、契約と全バージョン
// を返し、呼び出し側でシフトごとに日付解決する。
async function activeContractWithWageVersions(companyId: string, staffUserId: string) {
  const contract = await prisma.staffContract.findFirst({
    where: { staffUserId, status: "ACTIVE", template: { companyId } },
    include: { template: true, wageVersions: true },
    orderBy: { createdAt: "desc" },
  });
  if (!contract) return null;
  return contract;
}

// スタッフ×業務内容の単価テーブル。登録が無ければ雇用契約の基本単価
// （defaultWageRate）にフォールバックする。

// 稼働支給額 always recalculates fresh from that month's approved shifts —
// unfinalized months regenerate their SHIFT lines each time this runs, but
// CUSTOM lines and deductions/leave settings are left untouched.
export async function regenerateShiftLines(params: { companyId: string; staffUserId: string; targetMonth: string }) {
  const slip = await prisma.salarySlip.findUniqueOrThrow({
    where: {
      companyId_staffUserId_targetMonth: {
        companyId: params.companyId,
        staffUserId: params.staffUserId,
        targetMonth: params.targetMonth,
      },
    },
  });
  if (slip.status !== "DRAFT") return slip;

  const { start, end } = monthRange(params.targetMonth);
  const reports = await prisma.workReport.findMany({
    where: {
      staffUserId: params.staffUserId,
      outcome: "WORKED",
      approvalStatus: "APPROVED",
      shift: { companyId: params.companyId, date: { gte: start, lt: end } },
    },
    include: { shift: true },
  });

  const baseContract = await activeContractWithWageVersions(params.companyId, params.staffUserId);
  const taskRates = await prisma.staffTaskRate.findMany({
    where: { companyId: params.companyId, staffUserId: params.staffUserId },
    include: { versions: true },
  });
  const taskRateRowsByName = new Map<string, typeof taskRates>();
  for (const r of taskRates) {
    const list = taskRateRowsByName.get(r.taskName) ?? [];
    list.push(r);
    taskRateRowsByName.set(r.taskName, list);
  }

  await prisma.$transaction(async (tx) => {
    await tx.salarySlipLine.deleteMany({ where: { salarySlipId: slip.id, kind: "SHIFT" } });
    // 雇用契約が無いスタッフは自動計上できない。
    if (!baseContract) return;
    for (const r of reports) {
      const workedHours = Math.round((r.computedMinutes / 60) * 100) / 100;
      if (workedHours <= 0) continue;
      // 業務報告の時点で業務内容が選び直されていればそちらを優先し（提出時点
      // で確定）、無ければシフト作成時の予定（shift.taskName）を使う。
      const effectiveTaskName = r.taskName ?? r.shift.taskName;
      // その業務内容・その勤務先に、シフトの日付時点で有効なスタッフ個別の
      // 単価があればそれを優先し（勤務先限定＞勤務先を問わない、の順で
      // 探す）、無ければ雇用契約の基本単価（こちらもシフトの日付時点で
      // 有効だったバージョン）にフォールバックする。
      const candidateRows = effectiveTaskName ? taskRateRowsByName.get(effectiveTaskName) : undefined;
      const matchedRow = candidateRows ? pickStaffTaskRate(candidateRows, r.shift.companyRelationshipId) : null;
      const matchedWage = matchedRow ? resolveRateVersion(matchedRow.versions, r.shift.date) : null;
      const baseWageVersion = resolveContractWageVersion(baseContract.wageVersions, r.shift.date);
      if (!matchedWage && !baseWageVersion) continue;
      const wage = matchedWage ?? {
        wageType: baseContract.template.wageType,
        amount: baseWageVersion!.wageAmount,
      };
      // 月給は日々のシフト単位では自動計上しない（固定給のため、必要なら
      // 手動でカスタム行を追加する）。時給/日給のみ自動生成する。
      if (wage.wageType === "MONTHLY") continue;
      // 日給は「1シフト＝1日分」として単価をそのまま計上する（実働時間で
      // 掛け算しない）。時給*時間との整合を保つため hours*rate=amount の形は
      // 崩さず、日給の場合は hours=1 として扱う。
      const isHourly = wage.wageType === "HOURLY";
      const lineHours = isHourly ? workedHours : 1;
      const rate = wage.amount;
      const taskLabel = effectiveTaskName ? `（${effectiveTaskName}）` : "";
      await tx.salarySlipLine.create({
        data: {
          salarySlipId: slip.id,
          shiftId: r.shiftId,
          kind: "SHIFT",
          description: `${r.shift.date.toISOString().slice(0, 10)} 勤務${taskLabel}${isHourly ? "" : "（日給）"}`,
          hours: lineHours,
          rate,
          amount: Math.round(lineHours * rate),
        },
      });
    }
  });

  return slip;
}

export async function getOrCreateSalarySlip(params: {
  companyId: string;
  staffUserId: string;
  targetMonth: string;
}) {
  let slip = await prisma.salarySlip.findUnique({
    where: {
      companyId_staffUserId_targetMonth: {
        companyId: params.companyId,
        staffUserId: params.staffUserId,
        targetMonth: params.targetMonth,
      },
    },
  });

  if (!slip) {
    const deductions: DeductionItem[] = FIXED_DEDUCTION_LABELS.map((label, i) => ({
      id: `fixed-${i}`,
      label,
      amount: 0,
    }));
    slip = await prisma.salarySlip.create({
      data: {
        companyId: params.companyId,
        staffUserId: params.staffUserId,
        targetMonth: params.targetMonth,
        deductions,
      },
    });
  }

  await regenerateShiftLines(params);
  return prisma.salarySlip.findUniqueOrThrow({
    where: { id: slip.id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function addCustomLine(params: {
  salarySlipId: string;
  description: string;
  hours: number;
  rate: number;
}) {
  return prisma.salarySlipLine.create({
    data: {
      salarySlipId: params.salarySlipId,
      kind: "CUSTOM",
      description: params.description,
      hours: params.hours,
      rate: params.rate,
      amount: Math.round(params.hours * params.rate),
    },
  });
}

export async function updateLine(lineId: string, changes: { hours?: number; rate?: number }) {
  const line = await prisma.salarySlipLine.findUniqueOrThrow({ where: { id: lineId } });
  const hours = changes.hours ?? line.hours;
  const rate = changes.rate ?? line.rate;
  return prisma.salarySlipLine.update({
    where: { id: lineId },
    data: { hours, rate, amount: Math.round(hours * rate) },
  });
}

export async function deleteLine(lineId: string) {
  return prisma.salarySlipLine.delete({ where: { id: lineId } });
}

export async function updateDeductions(salarySlipId: string, deductions: DeductionItem[]) {
  return prisma.salarySlip.update({ where: { id: salarySlipId }, data: { deductions } });
}

export async function updatePaidLeave(
  salarySlipId: string,
  changes: { paidLeaveDaysUsed?: number; paidLeaveDailyRate?: number; paidLeaveGrantDays?: number },
) {
  return prisma.salarySlip.update({ where: { id: salarySlipId }, data: changes });
}

function computeTotals(slip: { lines: { amount: number }[]; deductions: unknown; paidLeaveDaysUsed: number; paidLeaveDailyRate: number }) {
  const grossFromShifts = slip.lines.reduce((sum, l) => sum + l.amount, 0);
  const paidLeaveAmount = slip.paidLeaveDaysUsed * slip.paidLeaveDailyRate;
  const gross = grossFromShifts + paidLeaveAmount;
  const deductions = (slip.deductions as DeductionItem[]) ?? [];
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const net = gross - totalDeductions;
  return { grossFromShifts, paidLeaveAmount, gross, totalDeductions, net };
}

export async function finalizeSalarySlip(salarySlipId: string) {
  return prisma.salarySlip.update({ where: { id: salarySlipId }, data: { status: "FINALIZED" } });
}

// 発行: 1 Tee per issuance, but a re-issue targeting the SAME month is free
// since the initial issue already charged for it (chat25/27/29). Every
// issuance snapshots the full computed document for the watermark-preview /
// re-download history.
export async function issueSalarySlip(params: { salarySlipId: string; issuedByUserId: string }) {
  const slip = await prisma.salarySlip.findUniqueOrThrow({
    where: { id: params.salarySlipId },
    include: { lines: true, staff: true, issues: true },
  });

  const alreadyIssuedThisMonth = slip.issues.length > 0;
  const totals = computeTotals(slip);

  return prisma.$transaction(async (tx) => {
    if (!alreadyIssuedThisMonth) {
      await postLedgerEntry(tx, {
        companyId: slip.companyId,
        type: "CONSUME_SALARY_ISSUE",
        amount: -1,
        createdByUserId: params.issuedByUserId,
      });
    }

    await tx.salarySlip.update({ where: { id: slip.id }, data: { status: "ISSUED" } });

    return tx.salarySlipIssue.create({
      data: {
        salarySlipId: slip.id,
        chargedTee: !alreadyIssuedThisMonth,
        snapshot: {
          staffName: slip.staff.name,
          targetMonth: slip.targetMonth,
          lines: slip.lines,
          deductions: slip.deductions,
          paidLeaveDaysUsed: slip.paidLeaveDaysUsed,
          paidLeaveDailyRate: slip.paidLeaveDailyRate,
          ...totals,
          issuedAt: new Date().toISOString(),
        },
      },
    });
  });
}

export function getTotals(slip: { lines: { amount: number }[]; deductions: unknown; paidLeaveDaysUsed: number; paidLeaveDailyRate: number }) {
  return computeTotals(slip);
}

export async function listSalarySlipsForCompany(companyId: string, targetMonth: string) {
  return prisma.salarySlip.findMany({
    where: { companyId, targetMonth },
    include: { staff: true, lines: true, issues: true },
    orderBy: { createdAt: "asc" },
  });
}
