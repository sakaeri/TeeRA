import "server-only";
import { prisma } from "@/lib/prisma";
import { postLedgerEntry } from "@/lib/domain/wallet";
import { resolveRateVersion, firstPricedEffectiveFrom } from "@/lib/domain/contracts";
import { isWeekendOrHoliday } from "@/lib/holidays";
import { hasRemainingPdfQuota } from "@/lib/domain/plans";
import { workRecordRowsForShiftIds } from "@/lib/domain/workRecord";
import { closingPeriod } from "@/lib/closingPeriod";
import type { QuantityUnit } from "@/lib/quantityUnit";
import { invoiceRecipientName } from "@/lib/invoiceRecipient";

// 依頼主ごとの締め日（invoiceClosingDay）で「◯月分」の対象期間を決める（末日締めならその月の1日〜末日）
export async function invoicePeriod(companyRelationshipId: string, periodLabel: string) {
  const rel = await prisma.companyRelationship.findUnique({
    where: { id: companyRelationshipId },
    select: { invoiceClosingDay: true },
  });
  return closingPeriod(periodLabel, rel?.invoiceClosingDay);
}

async function alreadyInvoicedShiftIds(companyRelationshipId: string, excludeInvoiceId?: string) {
  const issued = await prisma.invoice.findMany({
    where: {
      companyRelationshipId,
      status: "ISSUED",
      id: excludeInvoiceId ? { not: excludeInvoiceId } : undefined,
    },
    select: { invoicedShiftIds: true },
  });
  const ids = new Set<string>();
  for (const inv of issued) {
    for (const id of (inv.invoicedShiftIds as string[]) ?? []) ids.add(id);
  }
  return ids;
}

// 依頼主自身の募集(公開募集)に設定された単価は、それに直接応募した個人に
// 支払うためのものであり、派遣元↔依頼主間の請求単価とは無関係（依頼主詳細
// のCompanyPlacementRateとは別の話）。請求単価はあくまで依頼主詳細に業務
// 内容ごとに登録された単価を参照する。単価が未登録の業務内容のシフトは
// 明細行を作らず、未計上として警告表示する（他の業務の単価を誤って
// 流用しない）。

// rateId：その業務内容の依頼主の単価（無ければnull）。rateStartsFrom：単価はあるが、勤務日より後から始まっている時のその開始日
export type UnresolvedInvoiceShift = {
  shiftId: string;
  date: string;
  staffName: string;
  taskName: string | null;
  rateId: string | null;
  rateStartsFrom: string | null;
};

// 請求書の対象シフト: this agency's own shifts performed AT that client
// (source=CLIENT), with approved WORKED hours, not already locked into a
// previously ISSUED invoice for the same 依頼主 (invoicedShiftIds only locks
// at actual issuance, never at 確定 — chat29/30 bugfix).
// ほかの請求書に「前の月以前の分」として入れたシフト（その月の請求書からは外す — 二重に載せないため）
async function movedToOtherInvoiceShiftIds(companyRelationshipId: string, invoiceId: string) {
  const rows = await prisma.invoice.findMany({
    where: { companyRelationshipId, id: { not: invoiceId } },
    select: { includedEarlierShiftIds: true },
  });
  const ids = new Set<string>();
  for (const r of rows) for (const id of (r.includedEarlierShiftIds as string[]) ?? []) ids.add(id);
  return ids;
}

const EARLIER_LOOKBACK_DAYS = 400;

// 請求書に載る（＝承認済みの出勤、またはキャンセル料がかかった取り消し）シフトかどうか
function isBillableShift(s: {
  status: string;
  cancellation: { feeAmount: number } | null;
  workReport: { outcome: string | null; approvalStatus: string; computedMinutes: number } | null;
}) {
  if (s.cancellation || s.status === "CANCELLED" || s.status === "ON_HOLD") return (s.cancellation?.feeAmount ?? 0) > 0;
  const r = s.workReport;
  return Boolean(r && r.outcome === "WORKED" && r.approvalStatus === "APPROVED" && r.computedMinutes > 0);
}

// 前の月以前に請求していなかったシフト（発行済みの請求書にも、ほかの請求書の「前の月以前の分」にも入っていないもの）。
// 勝手には入れず、請求書の画面で「この請求書に入れる」を押した時だけ入れる。
export async function unbilledEarlierShifts(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.status !== "DRAFT") return [];
  const { start } = await invoicePeriod(invoice.companyRelationshipId, invoice.periodLabel);
  const [issued, moved] = await Promise.all([
    alreadyInvoicedShiftIds(invoice.companyRelationshipId, invoice.id),
    movedToOtherInvoiceShiftIds(invoice.companyRelationshipId, invoice.id),
  ]);
  const included = new Set((invoice.includedEarlierShiftIds as string[]) ?? []);
  const manuallyExcluded = new Set((invoice.excludedShiftIds as string[]) ?? []);
  const shifts = await prisma.shift.findMany({
    where: {
      companyId: invoice.issuingCompanyId,
      companyRelationshipId: invoice.companyRelationshipId,
      source: "CLIENT",
      date: { gte: new Date(start.getTime() - EARLIER_LOOKBACK_DAYS * 24 * 3600e3), lt: start },
      status: { not: "SUPERSEDED" },
    },
    include: { workReport: true, cancellation: true, staff: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  return shifts
    // 前の月以前の分として入れた後に×で消したもの（以前の作りでは「入れた」と「消した」の両方に残っていた）は、未請求に戻して出す
    .filter((s) => {
      if (issued.has(s.id) || moved.has(s.id) || s.clientBilledManuallyAt || !isBillableShift(s)) return false;
      if (included.has(s.id)) return manuallyExcluded.has(s.id);
      return !manuallyExcluded.has(s.id);
    })
    .map((s) => ({
      shiftId: s.id,
      date: s.date.toISOString().slice(0, 10),
      staffName: s.staff.name,
      label: s.cancellation || s.status === "CANCELLED" || s.status === "ON_HOLD" ? "キャンセル料" : (s.workReport?.taskName ?? s.taskName ?? "勤務"),
    }));
}

// 前の月以前に請求していなかったシフトを、この請求書に入れる（選んだものだけ。✅を外したものは未請求のまま）
export async function includeEarlierShifts(invoiceId: string, shiftIds?: string[]) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.status !== "DRAFT") throw new Error("not_draft");
  const chosen = shiftIds ? new Set(shiftIds) : null;
  const earlier = (await unbilledEarlierShifts(invoiceId)).filter((e) => !chosen || chosen.has(e.shiftId));
  if (earlier.length === 0) return 0;
  const current = (invoice.includedEarlierShiftIds as string[]) ?? [];
  const ids = new Set(earlier.map((e) => e.shiftId));
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      includedEarlierShiftIds: [...new Set([...current, ...ids])],
      // 前に×で消していたものを入れ直す時は、「消した」の記録を外す
      excludedShiftIds: ((invoice.excludedShiftIds as string[]) ?? []).filter((id) => !ids.has(id)),
    },
  });
  await regenerateLines(invoiceId);
  return earlier.length;
}

// 前の月以前の未請求分を「請求済み」にする（紙で請求した等、TeeRAの請求書には入れない）
export async function markEarlierShiftsBilled(invoiceId: string, shiftIds: string[]) {
  const ids = new Set(shiftIds);
  const targets = (await unbilledEarlierShifts(invoiceId)).filter((e) => ids.has(e.shiftId)).map((e) => e.shiftId);
  if (targets.length === 0) return 0;
  await prisma.shift.updateMany({ where: { id: { in: targets } }, data: { clientBilledManuallyAt: new Date() } });
  return targets.length;
}

// 「請求済み」にした前の月以前の分（間違えた時に未請求に戻せるよう一覧に出す）
export async function manuallyBilledEarlierShifts(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.status !== "DRAFT") return [];
  const { start } = await invoicePeriod(invoice.companyRelationshipId, invoice.periodLabel);
  const shifts = await prisma.shift.findMany({
    where: {
      companyId: invoice.issuingCompanyId,
      companyRelationshipId: invoice.companyRelationshipId,
      clientBilledManuallyAt: { not: null },
      date: { gte: new Date(start.getTime() - EARLIER_LOOKBACK_DAYS * 24 * 3600e3), lt: start },
    },
    include: { workReport: true, cancellation: true, staff: { select: { name: true } } },
    orderBy: { date: "asc" },
  });
  return shifts.map((s) => ({
    shiftId: s.id,
    date: s.date.toISOString().slice(0, 10),
    staffName: s.staff.name,
    label: s.cancellation || s.status === "CANCELLED" || s.status === "ON_HOLD" ? "キャンセル料" : (s.workReport?.taskName ?? s.taskName ?? "勤務"),
  }));
}

// 「請求済み」を取り消して未請求に戻す
export async function unmarkShiftBilled(invoiceId: string, shiftId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  await prisma.shift.updateMany({
    where: { id: shiftId, companyRelationshipId: invoice.companyRelationshipId, companyId: invoice.issuingCompanyId },
    data: { clientBilledManuallyAt: null },
  });
}

async function regenerateLines(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.status !== "DRAFT") return { invoice, unresolved: [] as UnresolvedInvoiceShift[] };

  const { start, end } = await invoicePeriod(invoice.companyRelationshipId, invoice.periodLabel);
  const excluded = await alreadyInvoicedShiftIds(invoice.companyRelationshipId, invoice.id);
  // ほかの月の請求書に「前の月以前の分」として入れたシフトは、この請求書には載せない
  for (const id of await movedToOtherInvoiceShiftIds(invoice.companyRelationshipId, invoice.id)) excluded.add(id);
  const includedEarlier = (invoice.includedEarlierShiftIds as string[]) ?? [];
  // TeeRAの請求書以外で請求済みにしたシフトは載せない
  for (const r of await prisma.shift.findMany({
    where: { companyRelationshipId: invoice.companyRelationshipId, clientBilledManuallyAt: { not: null } },
    select: { id: true },
  })) {
    excluded.add(r.id);
  }

  const [shifts, relationshipRates] = await Promise.all([
    prisma.shift.findMany({
      where: {
        companyId: invoice.issuingCompanyId,
        companyRelationshipId: invoice.companyRelationshipId,
        source: "CLIENT",
        // 対象期間のシフトと、前の月以前の分として入れたシフト
        OR: [{ date: { gte: start, lt: end } }, ...(includedEarlier.length > 0 ? [{ id: { in: includedEarlier } }] : [])],
        // 取り消されたシフトも、依頼主の取り消しでキャンセル料がかかった分は明細に載せる
        status: { not: "SUPERSEDED" },
      },
      include: { staff: true, workReport: true, cancellation: true },
    }),
    prisma.companyPlacementRate.findMany({
      where: { companyId: invoice.issuingCompanyId, companyRelationshipId: invoice.companyRelationshipId },
      include: { versions: true },
    }),
  ]);
  const ratesByTask = new Map(relationshipRates.map((r) => [r.taskName, r.versions]));
  const rateIdByTask = new Map(relationshipRates.map((r) => [r.taskName, r.id]));

  const unresolved: UnresolvedInvoiceShift[] = [];
  const manuallyExcludedShiftIds = new Set((invoice.excludedShiftIds as string[]) ?? []);

  await prisma.$transaction(async (tx) => {
    // 管理者が時間/単価を手で直した行（isManuallyEdited）や、削除した行の
    // shiftId（excludedShiftIds）は上書き・再生成しない — 以前は毎回全削除
    // してから作り直していたため、ページを開き直すたびに手動編集・削除が
    // 元の自動計算値に戻ってしまっていた（SalarySlipLineと同じ問題・同じ
    // 考え方の修正 — payroll.tsのregenerateShiftLines参照）。
    const existingLines = await tx.invoiceLine.findMany({
      where: { invoiceId: invoice.id, shiftId: { not: null } },
      select: { shiftId: true, isManuallyEdited: true },
    });
    const manuallyEditedShiftIds = new Set(existingLines.filter((l) => l.isManuallyEdited).map((l) => l.shiftId));
    const autoShiftIds = new Set(existingLines.filter((l) => !l.isManuallyEdited).map((l) => l.shiftId));
    const validShiftIds = new Set<string>();

    for (const s of shifts) {
      if (excluded.has(s.id) || manuallyExcludedShiftIds.has(s.id)) continue;

      // 依頼主に取り消されたシフト（取り消し済み・調整中とも）は、キャンセル料
      // がかかった分だけ明細にする。勤務の明細にはならない。
      if (s.cancellation || s.status === "CANCELLED" || s.status === "ON_HOLD") {
        const fee = s.cancellation?.feeAmount ?? 0;
        if (fee <= 0) continue;
        validShiftIds.add(s.id);
        if (manuallyEditedShiftIds.has(s.id)) continue;
        if (autoShiftIds.has(s.id)) {
          await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id, shiftId: s.id } });
        }
        await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            shiftId: s.id,
            staffName: s.staff.name,
            description: `${s.date.toISOString().slice(0, 10)} キャンセル料${s.taskName ? `（${s.taskName}）` : ""}`,
            hours: 1,
            unit: "COUNT",
            rate: fee,
            amount: fee,
            taxRatePercent: 10,
          },
        });
        continue;
      }

      const report = s.workReport;
      if (!report || report.outcome !== "WORKED" || report.approvalStatus !== "APPROVED") continue;
      const workedHours = Math.round((report.computedMinutes / 60) * 100) / 100;
      if (workedHours <= 0) continue;

      // 業務報告の時点で業務内容が選び直されていればそちらを優先し（提出時点
      // で確定）、無ければシフト作成時の予定（shift.taskName）を使う。
      const effectiveTaskName = report.taskName ?? s.taskName;
      // その業務内容の、シフトの日付時点で有効だった単価バージョンを使う
      // （単価は上書きせず履歴で積まれるため、後日単価を直しても過去の
      // 確定済みシフトの計算結果は変わらない）。
      const versions = effectiveTaskName ? ratesByTask.get(effectiveTaskName) : undefined;
      // 土曜・日曜・祝日の勤務は、土日祝の単価が設定されていればそちらを使う
      const taskRate = versions
        ? resolveRateVersion(versions, s.date, { weekendOrHoliday: isWeekendOrHoliday(s.date.toISOString().slice(0, 10)) })
        : null;
      if (!taskRate || taskRate.wageType === "MONTHLY") {
        const firstFrom = versions ? firstPricedEffectiveFrom(versions) : null;
        unresolved.push({
          shiftId: s.id,
          date: s.date.toISOString().slice(0, 10),
          staffName: s.staff.name,
          taskName: effectiveTaskName,
          rateId: effectiveTaskName ? (rateIdByTask.get(effectiveTaskName) ?? null) : null,
          rateStartsFrom: firstFrom && firstFrom > s.date ? firstFrom.toISOString().slice(0, 10) : null,
        });
        continue;
      }
      const isHourly = taskRate.wageType === "HOURLY";
      const lineHours = isHourly ? workedHours : 1;
      const rate = taskRate.amount;
      const taskLabel = `${effectiveTaskName ? `（${effectiveTaskName}）` : ""}${taskRate.isHolidayRate ? "（土日祝）" : ""}`;

      validShiftIds.add(s.id);
      if (manuallyEditedShiftIds.has(s.id)) continue;
      if (autoShiftIds.has(s.id)) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id, shiftId: s.id } });
      }
      // 「請求なし」（0円。研修など）の業務内容は請求書に載せない（単価未設定の注意にも出さない）
      if (rate === 0) continue;

      await tx.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          shiftId: s.id,
          staffName: s.staff.name,
          description: `${s.date.toISOString().slice(0, 10)} 勤務${taskLabel}`,
          hours: lineHours,
          unit: isHourly ? "HOUR" : "DAY",
          rate,
          amount: Math.round(lineHours * rate),
          taxRatePercent: 10,
        },
      });
    }

    // 対象月の承認済み実績と対応しなくなった自動生成行（業務報告の承認が
    // 取り消された等）だけを削除する。手動編集済みの行はここでは触らない。
    await tx.invoiceLine.deleteMany({
      where: {
        invoiceId: invoice.id,
        shiftId: { not: null, notIn: Array.from(validShiftIds) },
        isManuallyEdited: false,
      },
    });
  });

  return { invoice, unresolved };
}

function previousPeriodLabel(periodLabel: string) {
  const [year, month] = periodLabel.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 前月に手入力したカスタム項目（shiftId無しの行）を、数量0で新しい月に
// コピーしておく。毎月同じ項目を入れ直す手間を省くための引き継ぎで、
// 不要なら翌月側で消せばよい（前月の行自体は変更しない）。
async function carryOverCustomLines(params: {
  invoiceId: string;
  issuingCompanyId: string;
  companyRelationshipId: string;
  periodLabel: string;
}) {
  const prevInvoice = await prisma.invoice.findFirst({
    where: {
      issuingCompanyId: params.issuingCompanyId,
      companyRelationshipId: params.companyRelationshipId,
      periodLabel: previousPeriodLabel(params.periodLabel),
    },
    include: { lines: { where: { shiftId: null }, orderBy: { sortOrder: "asc" } } },
  });
  if (!prevInvoice || prevInvoice.lines.length === 0) return;

  await prisma.invoiceLine.createMany({
    data: prevInvoice.lines.map((l) => ({
      invoiceId: params.invoiceId,
      staffName: l.staffName,
      description: l.description,
      hours: 0,
      rate: l.rate,
      amount: 0,
      taxRatePercent: l.taxRatePercent,
    })),
  });
}

export async function getOrCreateInvoice(params: {
  issuingCompanyId: string;
  companyRelationshipId: string;
  periodLabel: string;
}) {
  // One invoice row per issuing company × client × period, regardless of
  // status — issuing doesn't create a new row, it flips status on this one
  // (mirrors the SalarySlip unique-per-month model). Editing after issuance
  // goes through reopenInvoiceForEdit, which flips status back to DRAFT on
  // this same row instead of orphaning it behind a fresh one.
  let invoice = await prisma.invoice.findFirst({
    where: {
      issuingCompanyId: params.issuingCompanyId,
      companyRelationshipId: params.companyRelationshipId,
      periodLabel: params.periodLabel,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!invoice) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: params.issuingCompanyId } });
    // 同じ依頼主の前の月（いちばん近い過去の月）の請求書があれば、備考・振込先・
    // PDFの載せ方はそこから引き継ぐ。
    const previous = await prisma.invoice.findFirst({
      where: {
        issuingCompanyId: params.issuingCompanyId,
        companyRelationshipId: params.companyRelationshipId,
        periodLabel: { lt: params.periodLabel },
      },
      orderBy: { periodLabel: "desc" },
    });
    // 前の月が無い依頼主は、最初に登録した振込先を初期値にする
    const defaultAccount = previous
      ? null
      : await prisma.companyBankAccount.findFirst({
          where: { companyId: params.issuingCompanyId },
          orderBy: { createdAt: "asc" },
        });
    invoice = await prisma.invoice.create({
      data: {
        issuingCompanyId: params.issuingCompanyId,
        companyRelationshipId: params.companyRelationshipId,
        periodLabel: params.periodLabel,
        invoiceRegistrationNumberSnapshot: company.invoiceRegistrationNumber,
        // 振込先は依頼主ごとに異なりうるため、前の月（または登録済みの振込先）の
        // 値は新規作成時の初期値としてコピーするだけ。以降はこの請求書で選び直す。
        ...(previous
          ? {
              note: previous.note,
              bankName: previous.bankName,
              branchName: previous.branchName,
              accountType: previous.accountType,
              accountNumber: previous.accountNumber,
              accountHolderName: previous.accountHolderName,
              groupLinesByTask: previous.groupLinesByTask,
              attachWorkRecord: previous.attachWorkRecord,
            }
          : defaultAccount
            ? {
                bankName: defaultAccount.bankName,
                branchName: defaultAccount.branchName,
                accountType: defaultAccount.accountType,
                accountNumber: defaultAccount.accountNumber,
                accountHolderName: defaultAccount.accountHolderName,
              }
            : {}),
      },
    });
    await carryOverCustomLines({
      invoiceId: invoice.id,
      issuingCompanyId: params.issuingCompanyId,
      companyRelationshipId: params.companyRelationshipId,
      periodLabel: params.periodLabel,
    });
  }

  const { unresolved } = await regenerateLines(invoice.id);
  const full = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  return { ...full, unresolved };
}

export async function addCustomLine(params: {
  invoiceId: string;
  staffName: string;
  description: string;
  hours: number;
  unit?: QuantityUnit | null;
  rate: number;
  taxRatePercent: number;
}) {
  return prisma.invoiceLine.create({
    data: {
      invoiceId: params.invoiceId,
      staffName: params.staffName,
      description: params.description,
      hours: params.hours,
      unit: params.unit ?? null,
      rate: params.rate,
      amount: Math.round(params.hours * params.rate),
      taxRatePercent: params.taxRatePercent,
    },
  });
}

export async function updateLine(
  lineId: string,
  changes: { hours?: number; rate?: number; taxRatePercent?: number },
) {
  const line = await prisma.invoiceLine.findUniqueOrThrow({ where: { id: lineId } });
  const hours = changes.hours ?? line.hours;
  const rate = changes.rate ?? line.rate;
  return prisma.invoiceLine.update({
    where: { id: lineId },
    data: {
      hours,
      rate,
      amount: Math.round(hours * rate),
      taxRatePercent: changes.taxRatePercent ?? line.taxRatePercent,
      isManuallyEdited: true,
    },
  });
}

// シフト由来の行を削除した場合、そのshiftIdをexcludedShiftIdsに記録して
// おかないと、次にこの請求書を開いた時（regenerateLines）にまた自動生成
// されて復活してしまう。カスタム行（shiftId無し）の削除はそのまま。
export async function deleteLine(lineId: string) {
  const line = await prisma.invoiceLine.findUniqueOrThrow({ where: { id: lineId } });
  await prisma.$transaction(async (tx) => {
    if (line.shiftId) {
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: line.invoiceId } });
      const included = (invoice.includedEarlierShiftIds as string[]) ?? [];
      if (included.includes(line.shiftId)) {
        // 前の月以前の分として入れた行を消した時は、未請求に戻す（また「確認する」の一覧に出る）
        await tx.invoice.update({
          where: { id: line.invoiceId },
          data: { includedEarlierShiftIds: included.filter((id) => id !== line.shiftId) },
        });
      } else {
        const excludedShiftIds = new Set((invoice.excludedShiftIds as string[]) ?? []);
        excludedShiftIds.add(line.shiftId);
        await tx.invoice.update({
          where: { id: line.invoiceId },
          data: { excludedShiftIds: Array.from(excludedShiftIds) },
        });
      }
    }
    await tx.invoiceLine.delete({ where: { id: lineId } });
  });
}

export async function setDueDate(invoiceId: string, dueDate: Date) {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { dueDate } });
}

export async function setPdfLayout(invoiceId: string, layout: { groupLinesByTask?: boolean; attachWorkRecord?: boolean }) {
  return prisma.invoice.update({ where: { id: invoiceId }, data: layout });
}

export async function setNote(invoiceId: string, note: string) {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { note } });
}

export type BankAccountInput = {
  bankName: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  accountHolderName: string;
};

export async function listBankAccounts(companyId: string) {
  return prisma.companyBankAccount.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
}

export async function addBankAccount(companyId: string, input: BankAccountInput) {
  const bankName = input.bankName.trim();
  const accountNumber = input.accountNumber.trim();
  const accountHolderName = input.accountHolderName.trim();
  if (!bankName || !accountNumber || !accountHolderName) throw new Error("bank_account_required");
  return prisma.companyBankAccount.create({
    data: {
      companyId,
      bankName,
      branchName: input.branchName.trim() || null,
      accountType: input.accountType.trim() || null,
      accountNumber,
      accountHolderName,
    },
  });
}

// 登録を消すだけ。請求書に写した振込先はそのまま残る
export async function deleteBankAccount(companyId: string, accountId: string) {
  await prisma.companyBankAccount.deleteMany({ where: { id: accountId, companyId } });
}

// 請求書の振込先を、登録済みの振込先から選ぶ（nullなら「振込先を載せない」）
export async function selectInvoiceBankAccount(invoiceId: string, account: BankAccountInput | null) {
  return setBankInfo(
    invoiceId,
    account ?? { bankName: "", branchName: "", accountType: "", accountNumber: "", accountHolderName: "" },
  );
}

export async function setBankInfo(
  invoiceId: string,
  bankInfo: { bankName: string; branchName: string; accountType: string; accountNumber: string; accountHolderName: string },
) {
  return prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      bankName: bankInfo.bankName.trim() || null,
      branchName: bankInfo.branchName.trim() || null,
      accountType: bankInfo.accountType.trim() || null,
      accountNumber: bankInfo.accountNumber.trim() || null,
      accountHolderName: bankInfo.accountHolderName.trim() || null,
    },
  });
}

// インボイス番号はここで編集すると本部設定へ自動的に反映される（双方向同期）。
export async function setInvoiceRegistrationNumber(companyId: string, invoiceId: string, number: string) {
  await prisma.$transaction([
    prisma.company.update({ where: { id: companyId }, data: { invoiceRegistrationNumber: number || null } }),
    prisma.invoice.update({
      where: { id: invoiceId },
      data: { invoiceRegistrationNumberSnapshot: number || null },
    }),
  ]);
}

export function computeInvoiceTotals(params: {
  lines: { amount: number; taxRatePercent: number }[];
  registered: boolean;
}) {
  // 0は「消費税区分：なし」（対象外）の明細行用。
  const brackets = [10, 8, 0].map((rate) => {
    const subtotal = params.lines
      .filter((l) => l.taxRatePercent === rate)
      .reduce((sum, l) => sum + l.amount, 0);
    const tax = params.registered ? Math.floor((subtotal * rate) / 100) : 0;
    return { rate, subtotal, tax };
  });
  const subtotalAll = params.lines.reduce((sum, l) => sum + l.amount, 0);
  const taxAll = brackets.reduce((sum, b) => sum + b.tax, 0);
  return { brackets, subtotalAll, taxAll, total: subtotalAll + taxAll };
}

// 内容を修正する: reopens an ISSUED invoice for editing. 給料明細と同じく、
// 同月内（同じInvoice行）の再発行は無料 — 内容を直して発行し直すたびに
// 課金すると離脱を招くため（給料明細と同じ判断、chat参照）。
export async function reopenInvoiceForEdit(invoiceId: string) {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: "DRAFT" } });
}

// 発行: 給料明細と同じく、同月内（同じInvoice行）の初回発行だけ1Tee課金し、
// 以降の同月内の再発行（内容を修正しての再発行を含む）は無料。
// invoicedShiftIdsは編集中ではなく実際の発行時点でロックする。
export async function issueInvoice(params: { invoiceId: string; issuedByUserId: string }) {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: params.invoiceId },
    include: { lines: { orderBy: { sortOrder: "asc" } }, companyRelationship: { include: { clientCompany: true } }, issues: true },
  });
  if (!invoice.dueDate) throw new Error("due_date_required");

  const alreadyIssuedThisMonth = invoice.issues.length > 0;
  const registered = Boolean(invoice.invoiceRegistrationNumberSnapshot);
  const totals = computeInvoiceTotals({ lines: invoice.lines, registered });
  const shiftIds = invoice.lines.map((l) => l.shiftId).filter((id): id is string => Boolean(id));
  // 実績表も発行時点の内容で固定する（後で報告が直っても、送った請求書と食い違わないように）
  const workRecord = invoice.attachWorkRecord ? { rows: await workRecordRowsForShiftIds(shiftIds) } : null;

  return prisma.$transaction(async (tx) => {
    let countsAgainstQuota = false;
    const issuer = await tx.company.findUniqueOrThrow({
      where: { id: invoice.issuingCompanyId },
      select: { sealImageDataUrl: true, sealOpacity: true },
    });

    if (!alreadyIssuedThisMonth) {
      const company = await tx.company.findUniqueOrThrow({
        where: { id: invoice.issuingCompanyId },
        select: { planTier: true },
      });
      countsAgainstQuota = await hasRemainingPdfQuota(tx, invoice.issuingCompanyId, company.planTier, invoice.periodLabel);
      if (!countsAgainstQuota) {
        await postLedgerEntry(tx, {
          companyId: invoice.issuingCompanyId,
          type: "CONSUME_INVOICE_ISSUE",
          amount: -1,
          createdByUserId: params.issuedByUserId,
        });
      }
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", invoicedShiftIds: shiftIds },
    });

    return tx.invoiceIssue.create({
      data: {
        invoiceId: invoice.id,
        countsAgainstQuota,
        snapshot: {
          periodLabel: invoice.periodLabel,
          // 発行時点の宛名（後で宛名を直しても、発行済みの請求書は変わらない）
          clientName: invoiceRecipientName(invoice.companyRelationship),
          // 締め日が末日でない依頼主は、発行した時点の対象期間を残す（後で締め日を変えても過去の請求書は変わらない）
          periodRangeLabel: closingPeriod(invoice.periodLabel, invoice.companyRelationship.invoiceClosingDay).rangeLabel,
          dueDate: invoice.dueDate?.toISOString(),
          note: invoice.note,
          lines: invoice.lines,
          groupLinesByTask: invoice.groupLinesByTask,
          // 載せ方（groupLinesByTask=falseは「スタッフ×業務ごと」）
          lineLayout: invoice.groupLinesByTask ? "TASK" : "STAFF_TASK",
          workRecord,
          registered,
          invoiceRegistrationNumber: invoice.invoiceRegistrationNumberSnapshot,
          bankName: invoice.bankName,
          branchName: invoice.branchName,
          accountType: invoice.accountType,
          accountNumber: invoice.accountNumber,
          accountHolderName: invoice.accountHolderName,
          // 発行時点の電子印を固定する（後で差し替えても過去の請求書は変わらない）
          sealImageDataUrl: issuer.sealImageDataUrl,
          sealOpacity: issuer.sealOpacity,
          ...totals,
          issuedAt: new Date().toISOString(),
        },
      },
    });
  });
}

export async function listInvoicesForCompany(companyId: string, periodLabel: string) {
  return prisma.invoice.findMany({
    where: { issuingCompanyId: companyId, periodLabel },
    include: { companyRelationship: { include: { clientCompany: true } }, lines: true, issues: true },
    orderBy: { createdAt: "asc" },
  });
}

// この請求書の期間に承認済み（またはキャンセル料がかかった）なのに、明細に入っていない勤務と、その理由。
// 理由がわからないまま請求書から漏れないよう、請求書の画面に出す（外した・請求済みにした分は戻せる）
export type MissingInvoiceShift = {
  shiftId: string;
  date: string;
  staffName: string;
  taskName: string | null;
  reason: "excluded" | "billed_manually" | "other_invoice" | "no_charge" | "cancelled_no_fee";
  otherPeriodLabel?: string | null;
};

export async function listMissingInvoiceShifts(invoiceId: string): Promise<MissingInvoiceShift[]> {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { lines: { select: { shiftId: true } } } });
  const { start, end } = await invoicePeriod(invoice.companyRelationshipId, invoice.periodLabel);
  const inLines = new Set(invoice.lines.map((l) => l.shiftId).filter(Boolean));
  const excluded = new Set((invoice.excludedShiftIds as string[]) ?? []);
  const [shifts, others, rates] = await Promise.all([
    prisma.shift.findMany({
      where: {
        companyId: invoice.issuingCompanyId,
        companyRelationshipId: invoice.companyRelationshipId,
        source: "CLIENT",
        date: { gte: start, lt: end },
        status: { not: "SUPERSEDED" },
      },
      include: { staff: { select: { name: true } }, workReport: true, cancellation: true },
      orderBy: { date: "asc" },
    }),
    prisma.invoice.findMany({
      where: { companyRelationshipId: invoice.companyRelationshipId, id: { not: invoice.id } },
      select: { periodLabel: true, status: true, invoicedShiftIds: true, includedEarlierShiftIds: true },
    }),
    prisma.companyPlacementRate.findMany({
      where: { companyId: invoice.issuingCompanyId, companyRelationshipId: invoice.companyRelationshipId },
      include: { versions: true },
    }),
  ]);
  const otherBy = new Map<string, string>();
  for (const o of others) {
    const ids = [...((o.status === "ISSUED" ? o.invoicedShiftIds : []) as string[]), ...((o.includedEarlierShiftIds as string[]) ?? [])];
    for (const id of ids) otherBy.set(id, o.periodLabel);
  }
  const ratesByTask = new Map(rates.map((r) => [r.taskName, r.versions]));

  const result: MissingInvoiceShift[] = [];
  for (const s of shifts) {
    if (inLines.has(s.id)) continue;
    const cancelledLike = Boolean(s.cancellation) || s.status === "CANCELLED" || s.status === "ON_HOLD";
    const r = s.workReport;
    const worked = Boolean(r && r.outcome === "WORKED" && r.approvalStatus === "APPROVED" && r.computedMinutes > 0);
    // 承認済みの勤務か、キャンセル料のかかった取り消しだけを見る（未承認・欠勤などはもともと載らない）
    if (!worked && !(cancelledLike && (s.cancellation?.feeAmount ?? 0) > 0)) continue;
    const taskName = r?.taskName ?? s.taskName;
    const base = { shiftId: s.id, date: s.date.toISOString().slice(0, 10), staffName: s.staff.name, taskName };
    if (excluded.has(s.id)) result.push({ ...base, reason: "excluded" });
    else if (s.clientBilledManuallyAt) result.push({ ...base, reason: "billed_manually" });
    else if (otherBy.has(s.id)) result.push({ ...base, reason: "other_invoice", otherPeriodLabel: otherBy.get(s.id) });
    else if (worked && cancelledLike) result.push({ ...base, reason: "cancelled_no_fee" });
    else if (worked) {
      const versions = taskName ? ratesByTask.get(taskName) : undefined;
      const rate = versions ? resolveRateVersion(versions, s.date, { weekendOrHoliday: isWeekendOrHoliday(base.date) }) : null;
      // 単価が無いものは「単価が決まらない勤務」の案内に出ているので、ここには出さない
      if (rate && rate.amount === 0) result.push({ ...base, reason: "no_charge" });
    }
  }
  return result;
}

// 「明細から外した」勤務を明細に戻す（次に請求書を開いた時に作り直される）
export async function restoreExcludedShift(invoiceId: string, shiftId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const excluded = ((invoice.excludedShiftIds as string[]) ?? []).filter((id) => id !== shiftId);
  await prisma.invoice.update({ where: { id: invoiceId }, data: { excludedShiftIds: excluded } });
}
