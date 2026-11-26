import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { closingDayLabel } from "@/lib/closingPeriod";
import { canManageAny, isCompanyScopeAdmin, isLeaderOnly } from "@/lib/auth/permissions";
import { listStaff } from "@/lib/domain/roster";
import { payrollPeriod, getOrCreateSalarySlip, listExcludedSalaryShifts, getTotals, listSalarySlipsForCompany, resolveWorkplaceNamesByShiftId, workLineLabel } from "@/lib/domain/payroll";
import { pdfQuotaRemaining } from "@/lib/domain/plans";
import { prisma } from "@/lib/prisma";
import { SalarySlipEditor } from "@/components/company/SalarySlipEditor";
import { FinanceTabs } from "@/components/company/FinanceTabs";
import { MonthNavBar } from "@/components/company/MonthNavBar";
import { CreateRecordButton } from "@/components/company/CreateRecordButton";
import { todayJstParts, earliestAllowedMonth, cutoffMonthString } from "@/lib/date";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PdfLink } from "@/components/PdfLink";
import { IssueHistory } from "@/components/company/IssueHistory";
import { approvedStaffInvoiceStaffIds, checkStaffInvoiceRates, hasContractorStaff, listReceivedStaffInvoices, staffInvoiceOpenCost, sanitizeExpenses } from "@/lib/domain/staffInvoices";
import type { ComputedWorkLine } from "@/lib/domain/payroll";
import { ReceivedStaffInvoiceList, ReceivedStaffInvoiceView, type ReceivedInvoiceDetail } from "@/components/company/ReceivedStaffInvoices";

function currentMonth() {
  const today = todayJstParts();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

// 何も選んでいなければ先月を開く（月が明けてから前の月の分を作ることが多いため）
function previousMonth() {
  const today = todayJstParts();
  const d = new Date(Date.UTC(today.year, today.month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// 請求書に入っている勤務の期間（例：「11/18〜11/22」）
function workRangeLabel(workLines: unknown) {
  const dates = ((Array.isArray(workLines) ? workLines : []) as { description?: string }[])
    .map((l) => l.description?.match(/^\d{4}-\d{2}-\d{2}/)?.[0])
    .filter((d): d is string => Boolean(d))
    .sort();
  if (dates.length === 0) return "";
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return dates[0] === dates[dates.length - 1] ? md(dates[0]) : `${md(dates[0])}〜${md(dates[dates.length - 1])}`;
}

const ISSUED_ROW_CLASS = "flex items-center gap-3 rounded-lg border border-border bg-white/60 px-4 py-2.5 text-sm";
const PDF_BUTTON_CLASS = "shrink-0 rounded-md border border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/5";

export default async function PayrollPage({
  searchParams,
}: PageProps<"/company/payroll">) {
  const { membership } = await requireCompanyAdminOrEditor();
  if (isLeaderOnly(membership)) redirect("/company/calendar");
  const sp = await searchParams;
  const requestedMonth = typeof sp.month === "string" ? sp.month : previousMonth();
  const staffUserId = typeof sp.staff === "string" ? sp.staff : undefined;
  const staffInvoiceId = typeof sp.staffInvoice === "string" ? sp.staffInvoice : undefined;

  const [allStaff, company] = await Promise.all([
    listStaff(membership.companyId),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const historyCutoff = earliestAllowedMonth(company.planTier);
  const minMonth = cutoffMonthString(historyCutoff);
  if (minMonth && requestedMonth < minMonth) {
    const params = new URLSearchParams({ month: minMonth });
    if (staffUserId) params.set("staff", staffUserId);
    redirect(`/company/payroll?${params.toString()}`);
  }
  const targetMonth = requestedMonth;
  // 締め日が末日でない会社は、給料明細の対象期間を画面に出す
  const payrollPeriodInfo = await payrollPeriod(membership.companyId, targetMonth);
  const payrollPeriodRange = payrollPeriodInfo.rangeLabel;
  const payrollClosingLabel = closingDayLabel(payrollPeriodInfo.closingDay);
  // カレンダー/スタッフ詳細パネルと同様、カットオフ月そのものを見ている
  // 時だけバナーを出す（無料プランというだけで常時表示すると邪魔になる）。
  const atHistoryCutoff = minMonth !== null && targetMonth === minMonth;
  // TeeRAを使っていない（実体のない）派遣会社にタグ付けされているスタッフは
  // 実際の給与を派遣会社側が払う想定のため、ここでの給与計算対象からは
  // 除外する（誤ってここから給料明細を発行してしまわないように）。
  const payableStaff = allStaff.filter((s) => !s.viaAgencyRelationshipName);
  // チームマネージャー/リーダーは自チームのスタッフしか選べない（本部管理者/
  // 編集者は全社分）。
  const staff = isCompanyScopeAdmin(membership)
    ? payableStaff
    : payableStaff.filter((s) => s.teams.some((t) => membership.teamMemberships.some((tm) => tm.teamId === t.teamId)));

  type SlipData = {
    id: string;
    status: string;
    lines: { id: string; kind: string; description: string; hours: number; rate: number; amount: number }[];
    deductions: { id: string; label: string; amount: number }[];
    paymentDay: string | null;
    groupShiftLines: boolean;
    showWorkplace: boolean;
    note: string | null;
    paidLeaveDaysUsed: number;
    paidLeaveDailyRate: number;
    paidLeaveBalance: number;
    paidLeaveNextGrantDate: string | null;
    totals: ReturnType<typeof getTotals>;
    issues: { id: string; issuedAt: string; chargedTee: boolean; hidden: boolean }[];
    unresolved: {
      shiftId: string;
      workReportId: string;
      date: string;
      taskName: string;
      source: "workReport" | "shift";
      companyRelationshipId: string | null;
      rateId: string | null;
      rateStartsFrom: string | null;
    }[];
    invoicedShiftCount: number;
    excludedShifts: Awaited<ReturnType<typeof listExcludedSalaryShifts>>;
  };

  let slipData: SlipData | null = null;
  const targetStaffTeamIds = staffUserId
    ? (await prisma.teamMembership.findMany({ where: { userId: staffUserId }, select: { teamId: true } })).map((r) => r.teamId)
    : [];
  // タグ付きスタッフはURL直指定でも給与計算の対象にしない（ピッカーの
  // 除外だけでは、?staff=idを直接開かれた場合に素通りしてしまうため）。
  const isPayableStaff = payableStaff.some((s) => s.userId === staffUserId);
  if (staffUserId && isPayableStaff && canManageAny(membership, targetStaffTeamIds)) {
    const slip = await getOrCreateSalarySlip({
      companyId: membership.companyId,
      staffUserId,
      targetMonth,
    });
    const totals = getTotals(slip);
    const issues = await prisma.salarySlipIssue.findMany({
      where: { salarySlipId: slip.id },
      orderBy: { issuedAt: "desc" },
    });
    const staffMembership = await prisma.companyMembership.findFirstOrThrow({
      where: { companyId: membership.companyId, userId: staffUserId },
      select: { paidLeaveBalance: true, nextPaidLeaveGrantDate: true },
    });
    slipData = {
      id: slip.id,
      status: slip.status,
      lines: slip.lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        description: l.description,
        hours: l.hours,
        rate: l.rate,
        amount: l.amount,
      })),
      deductions: slip.deductions as { id: string; label: string; amount: number }[],
      paymentDay: slip.paymentDay,
      groupShiftLines: slip.groupShiftLines,
      showWorkplace: slip.showWorkplace,
      note: slip.note,
      paidLeaveDaysUsed: slip.paidLeaveDaysUsed,
      paidLeaveDailyRate: slip.paidLeaveDailyRate,
      paidLeaveBalance: staffMembership.paidLeaveBalance,
      paidLeaveNextGrantDate: staffMembership.nextPaidLeaveGrantDate
        ? staffMembership.nextPaidLeaveGrantDate.toISOString().slice(0, 10)
        : null,
      totals,
      issues: issues.map((i) => ({ id: i.id, issuedAt: i.issuedAt.toISOString(), chargedTee: i.chargedTee, hidden: i.hiddenAt !== null })),
      unresolved: slip.unresolved,
      invoicedShiftCount: slip.invoicedCount,
      excludedShifts: slip.status === "DRAFT" ? await listExcludedSalaryShifts(slip.id) : [],
    };
  }

  // 対象月の一覧 — 月とスタッフ選択は別物なので、表示中の月に存在する
  // 明細（下書き/発行済み）を「下書き中」「発行履歴」に分けて表示する。
  // チームマネージャー/リーダーは自チームのスタッフ分だけに絞る。
  const accessibleStaffIds = new Set(staff.map((s) => s.userId));
  const slipsThisMonth = (await listSalarySlipsForCompany(membership.companyId, targetMonth)).filter((s) =>
    accessibleStaffIds.has(s.staffUserId),
  );
  const pdfQuota = await pdfQuotaRemaining(membership.companyId, targetMonth);
  const draftSlips = slipsThisMonth.filter((s) => s.status !== "ISSUED");
  const issuedSlips = slipsThisMonth.filter((s) => s.status === "ISSUED");
  // ＋新しく作成の選択肢は、この月にまだ何も無いスタッフだけに絞る
  // （既にある人は下書き中/発行履歴の行から直接開けるため）。
  const staffWithRecordIds = new Set(slipsThisMonth.map((s) => s.staffUserId));
  const staffAvailableForNewSlip = staff.filter((s) => !staffWithRecordIds.has(s.userId));
  const selectedStaffName = staffUserId ? (allStaff.find((s) => s.userId === staffUserId)?.name ?? "") : "";

  // 業務委託のスタッフから届いた請求書（自分が扱えるスタッフの分だけ）
  const receivedInvoices = await listReceivedStaffInvoices(membership.companyId, targetMonth, accessibleStaffIds);
  // 承認するまで（確認待ち・差し戻し中）は「業務委託のスタッフから届いた請求書」の欄、承認したら「発行履歴」に移す
  const approvedInvoices = receivedInvoices.filter((inv) => inv.status === "APPROVED");
  const receivedRows = await Promise.all(
    receivedInvoices.filter((inv) => inv.status !== "APPROVED").map(async (inv) => ({
      id: inv.id,
      staffName: inv.staff.name,
      status: inv.status,
      opened: inv.chargeSettledAt != null,
      freeToOpen: (await staffInvoiceOpenCost(inv)) === "free",
      sequence: inv.sequence,
      periodRangeLabel: inv.periodRangeLabel,
    })),
  );
  const invoicedStaffIds = await approvedStaffInvoiceStaffIds(membership.companyId, targetMonth);
  // 業務委託のスタッフがいる会社には、まだ届いていなくても「届いた請求書」の欄を出しておく
  const showReceivedSection = receivedRows.length > 0 || (await hasContractorStaff(membership.companyId, [...accessibleStaffIds]));
  // 開いた（1件分を精算した）請求書だけ中身を見られる
  const openedInvoice = staffInvoiceId ? receivedInvoices.find((i) => i.id === staffInvoiceId && i.chargeSettledAt) : undefined;
  const openedWorkLines = openedInvoice ? (openedInvoice.workLines as ComputedWorkLine[]) : [];
  const openedWorkplaces = await resolveWorkplaceNamesByShiftId(openedWorkLines.map((l) => l.shiftId));
  // 確認待ちの請求書は、今の単価と合っているかを確かめる（単価を直した時は差し戻して出し直してもらう）
  const rateCheck = openedInvoice && openedInvoice.status === "SUBMITTED" ? await checkStaffInvoiceRates(openedInvoice) : null;
  const invoiceDetail: ReceivedInvoiceDetail | null = openedInvoice
    ? {
        id: openedInvoice.id,
        staffName: openedInvoice.staff.name,
        targetMonth: openedInvoice.targetMonth,
        status: openedInvoice.status,
        submittedAt: new Date(openedInvoice.submittedAt!.getTime() + 9 * 3600e3).toISOString().slice(0, 10),
        periodRangeLabel: openedInvoice.periodRangeLabel,
        // 「2026-11-18 〇〇ゴルフ場（キャディ）」／業務内容だけなら「2026-11-18 キャディ」（PDFと同じ書き方）
        lines: openedWorkLines.map((l) => ({
          ...l,
          label: `${l.description.slice(0, 10)} ${workLineLabel(l.description, openedWorkplaces.get(l.shiftId) ?? null, openedInvoice.showWorkplace)}`,
          isDaily: l.description.endsWith("（日給）"),
        })),
        showWorkplace: openedInvoice.showWorkplace,
        expenses: sanitizeExpenses(openedInvoice.expenses),
        note: openedInvoice.note,
        issuerName: openedInvoice.issuerName,
        issuerAddress: openedInvoice.issuerAddress,
        registrationNumber: openedInvoice.registrationNumber,
        bankLine: openedInvoice.bankName
          ? [openedInvoice.bankName, openedInvoice.branchName, openedInvoice.accountType, openedInvoice.accountNumber, openedInvoice.accountHolderName].filter(Boolean).join(" ")
          : null,
        withholding: openedInvoice.withholding,
        taxExclusive: openedInvoice.taxExclusive,
        workSubtotal: openedInvoice.workSubtotal,
        taxAmount: openedInvoice.taxAmount,
        withholdingAmount: openedInvoice.withholdingAmount,
        expensesTotal: openedInvoice.expensesTotal,
        total: openedInvoice.total,
        returnReason: openedInvoice.returnReason,
        staffUserId: openedInvoice.staffUserId,
        rateChanged: rateCheck?.changed ?? [],
        rateUnresolved: rateCheck?.unresolved ?? [],
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <FinanceTabs active="payroll" invoicesEnabled={company.agencyEnabled} />

      {atHistoryCutoff ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-primary">
          <span>無料プランでは過去データの閲覧は直近3ヶ月までです。それ以前を見るにはプランのアップグレードが必要です。</span>
          <Link href="/company/wallet" className="shrink-0 font-semibold underline whitespace-nowrap">
            プランをアップグレードする
          </Link>
        </div>
      ) : null}

      <MonthNavBar basePath="/company/payroll" targetMonth={targetMonth} minMonth={minMonth} todayMonth={currentMonth()} />

      {invoiceDetail ? (
        <>
          <Link href={`/company/payroll?month=${targetMonth}`} className="mb-4 inline-block text-sm text-primary underline">
            ← 一覧に戻る
          </Link>
          <ReceivedStaffInvoiceView invoice={invoiceDetail} />
        </>
      ) : slipData ? (
        <>
          <Link href={`/company/payroll?month=${targetMonth}`} className="mb-4 inline-block text-sm text-primary underline">
            ← 一覧に戻る
          </Link>
          {payrollPeriodRange ? (
            <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="payroll-period-range">
              対象期間：{payrollPeriodRange}（{payrollClosingLabel}）
            </p>
          ) : null}
          <SalarySlipEditor
            staffUserId={staffUserId!}
            slip={slipData}
            staffName={selectedStaffName}
            willUseFreeQuota={pdfQuota.unlimited || (pdfQuota.quota > 0 && pdfQuota.remaining > 0)}
            pdfQuota={
              pdfQuota.unlimited || pdfQuota.quota > 0
                ? { remaining: pdfQuota.remaining, quota: pdfQuota.quota, unlimited: pdfQuota.unlimited, monthLabel: `${Number(targetMonth.slice(5, 7))}月分` }
                : null
            }
          />
          {slipData.issues.length ? <IssueHistory kind="salary" docId={slipData.id} issues={slipData.issues} /> : null}
        </>
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif-jp text-lg font-bold text-primary">下書き中</h2>
              <CreateRecordButton
                basePath="/company/payroll"
                targetMonth={targetMonth}
                paramName="staff"
                label="スタッフ"
                options={staffAvailableForNewSlip.map((s) => ({ id: s.userId, name: s.name }))}
              />
            </div>
            {draftSlips.length === 0 ? (
              <p className="text-sm text-muted">下書き中の給与明細はありません。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {draftSlips.map((slip) => (
                  <li key={slip.id}>
                    <Link
                      href={`/company/payroll?month=${targetMonth}&staff=${slip.staffUserId}`}
                      className="flex items-center gap-2 rounded-lg border border-border bg-white/60 px-4 py-2.5 text-sm hover:bg-background"
                    >
                      {/* 名前と札を1行にそろえる（長い名前は…で切る） */}
                      <span className="min-w-0 flex-1 truncate font-medium">{slip.staff.name}</span>
                      {slip.issues.length > 0 ? (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-accent/20 px-2 py-0.5 text-[11px] text-accent">修正中</span>
                      ) : null}
                      {invoicedStaffIds.has(slip.staffUserId) ? (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">
                          請求書受取済み
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showReceivedSection ? (
            <ReceivedStaffInvoiceList
              rows={receivedRows}
              targetMonth={targetMonth}
              quota={{ remaining: pdfQuota.remaining, unlimited: pdfQuota.unlimited, quota: pdfQuota.quota }}
            />
          ) : null}
          <section className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif-jp text-lg font-bold text-primary">発行履歴</h2>
              {issuedSlips.length > 0 ? (
                <PdfLink
                  href={`/api/salary-slips/bulk-pdf?month=${targetMonth}`}
                  className="rounded-lg border border-primary px-3 py-1.5 text-xs text-primary hover:bg-primary/5"
                >
                  一括PDFダウンロード
                </PdfLink>
              ) : null}
            </div>
            {issuedSlips.length === 0 && approvedInvoices.length === 0 ? (
              <p className="text-sm text-muted">この月に発行された給与明細はありません。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {approvedInvoices.map((inv) => (
                  <li key={inv.id} className={ISSUED_ROW_CLASS}>
                    <Link
                      href={`/company/payroll?month=${targetMonth}&staffInvoice=${inv.id}`}
                      className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-primary underline"
                    >
                      <span className="truncate">{inv.staff.name}</span>
                      {/* 週払いなどで同じ人の請求書が何枚もある時は、どの期間の分かを添えて見分けられるようにする */}
                      {approvedInvoices.filter((x) => x.staffUserId === inv.staffUserId).length > 1 ? (
                        <span className="shrink-0 text-xs font-normal text-muted no-underline" data-testid="invoice-work-range">
                          {workRangeLabel(inv.workLines)}
                        </span>
                      ) : null}
                      <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 no-underline">請求書</span>
                    </Link>
                    <span className="shrink-0 tabular-nums text-muted">{inv.total.toLocaleString()}円</span>
                    <PdfLink href={`/api/staff-invoices/${inv.id}/pdf`} className={PDF_BUTTON_CLASS}>
                      PDF
                    </PdfLink>
                  </li>
                ))}
                {issuedSlips.map((slip) => {
                  // 一覧にはこのスタッフの最新発行分のPDFだけを出す。過去分は
                  // 詳細（編集画面）の発行履歴から辿れる。
                  const latestIssue = slip.issues.reduce((latest, i) =>
                    i.issuedAt > latest.issuedAt ? i : latest,
                  );
                  return (
                    // 名前・金額・PDFを1行にそろえる（発行日時はPDFに書いてあるので一覧には出さない）
                    <li key={slip.id} className={ISSUED_ROW_CLASS}>
                      <Link
                        href={`/company/payroll?month=${targetMonth}&staff=${slip.staffUserId}`}
                        className="min-w-0 flex-1 truncate font-medium text-primary underline"
                      >
                        {slip.staff.name}
                      </Link>
                      <span className="shrink-0 tabular-nums text-muted">{getTotals(slip).net.toLocaleString()}円</span>
                      <PdfLink href={`/api/salary-slips/${slip.id}/pdf?issueId=${latestIssue.id}`} className={PDF_BUTTON_CLASS}>
                        PDF
                      </PdfLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
