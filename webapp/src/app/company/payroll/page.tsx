import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny, isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { listStaff } from "@/lib/domain/roster";
import { getOrCreateSalarySlip, getTotals, listSalarySlipsForCompany } from "@/lib/domain/payroll";
import { pdfQuotaRemaining } from "@/lib/domain/plans";
import { prisma } from "@/lib/prisma";
import { SalarySlipEditor } from "@/components/company/SalarySlipEditor";
import { FinanceTabs } from "@/components/company/FinanceTabs";
import { MonthNavBar } from "@/components/company/MonthNavBar";
import { CreateRecordButton } from "@/components/company/CreateRecordButton";
import { todayJstParts, earliestAllowedMonth, cutoffMonthString } from "@/lib/date";
import { redirect } from "next/navigation";
import Link from "next/link";

function currentMonth() {
  const today = todayJstParts();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

export default async function PayrollPage({
  searchParams,
}: PageProps<"/company/payroll">) {
  const { membership } = await requireCompanyAdminOrEditor();
  const sp = await searchParams;
  const requestedMonth = typeof sp.month === "string" ? sp.month : currentMonth();
  const staffUserId = typeof sp.staff === "string" ? sp.staff : undefined;

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
  // カレンダー/スタッフ詳細パネルと同様、カットオフ月そのものを見ている
  // 時だけバナーを出す（無料プランというだけで常時表示すると邪魔になる）。
  const atHistoryCutoff = minMonth !== null && targetMonth === minMonth;
  // チームマネージャー/リーダーは自チームのスタッフしか選べない（本部管理者/
  // 編集者は全社分）。
  const staff = isCompanyScopeAdmin(membership)
    ? allStaff
    : allStaff.filter((s) => s.teams.some((t) => membership.teamMemberships.some((tm) => tm.teamId === t.teamId)));

  type SlipData = {
    id: string;
    status: string;
    lines: { id: string; kind: string; description: string; hours: number; rate: number; amount: number }[];
    deductions: { id: string; label: string; amount: number }[];
    paidLeaveDaysUsed: number;
    paidLeaveDailyRate: number;
    paidLeaveBalance: number;
    paidLeaveNextGrantDate: string | null;
    totals: ReturnType<typeof getTotals>;
    issues: { id: string; issuedAt: string; chargedTee: boolean }[];
    unresolved: { shiftId: string; workReportId: string; date: string; taskName: string; source: "workReport" | "shift" }[];
  };

  let slipData: SlipData | null = null;
  const targetStaffTeamIds = staffUserId
    ? (await prisma.teamMembership.findMany({ where: { userId: staffUserId }, select: { teamId: true } })).map((r) => r.teamId)
    : [];
  if (staffUserId && canManageAny(membership, targetStaffTeamIds)) {
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
      paidLeaveDaysUsed: slip.paidLeaveDaysUsed,
      paidLeaveDailyRate: slip.paidLeaveDailyRate,
      paidLeaveBalance: staffMembership.paidLeaveBalance,
      paidLeaveNextGrantDate: staffMembership.nextPaidLeaveGrantDate
        ? staffMembership.nextPaidLeaveGrantDate.toISOString().slice(0, 10)
        : null,
      totals,
      issues: issues.map((i) => ({ id: i.id, issuedAt: i.issuedAt.toISOString(), chargedTee: i.chargedTee })),
      unresolved: slip.unresolved,
    };
  }

  // 対象月の一覧 — 月とスタッフ選択は別物なので、表示中の月に存在する
  // 明細（下書き/発行済み）を「下書き中」「発行履歴」に分けて表示する。
  // チームマネージャー/リーダーは自チームのスタッフ分だけに絞る。
  const accessibleStaffIds = new Set(staff.map((s) => s.userId));
  const slipsThisMonth = (await listSalarySlipsForCompany(membership.companyId, targetMonth)).filter((s) =>
    accessibleStaffIds.has(s.staffUserId),
  );
  const pdfQuota = await pdfQuotaRemaining(membership.companyId);
  const draftSlips = slipsThisMonth.filter((s) => s.status !== "ISSUED");
  const issuedSlips = slipsThisMonth.filter((s) => s.status === "ISSUED");
  // ＋新しく作成の選択肢は、この月にまだ何も無いスタッフだけに絞る
  // （既にある人は下書き中/発行履歴の行から直接開けるため）。
  const staffWithRecordIds = new Set(slipsThisMonth.map((s) => s.staffUserId));
  const staffAvailableForNewSlip = staff.filter((s) => !staffWithRecordIds.has(s.userId));

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">給与計算</h1>
      <FinanceTabs active="payroll" invoicesEnabled={company.agencyEnabled} />

      {atHistoryCutoff ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-primary">
          <span>無料プランでは過去データの閲覧は直近3ヶ月までです。それ以前を見るにはプランのアップグレードが必要です。</span>
          <Link href="/company/wallet" className="shrink-0 font-semibold underline whitespace-nowrap">
            プランをアップグレードする
          </Link>
        </div>
      ) : null}

      {pdfQuota.quota > 0 ? (
        <p className="mb-4 text-xs text-muted">
          今月の無料発行枠（給与明細・請求書の合算）：残り{pdfQuota.remaining}/{pdfQuota.quota}件
        </p>
      ) : null}

      <MonthNavBar basePath="/company/payroll" targetMonth={targetMonth} minMonth={minMonth} todayMonth={currentMonth()} />

      {slipData ? (
        <>
          <Link href={`/company/payroll?month=${targetMonth}`} className="mb-4 inline-block text-sm text-primary underline">
            ← 一覧に戻る
          </Link>
          <SalarySlipEditor slip={slipData} willUseFreeQuota={pdfQuota.quota > 0 && pdfQuota.remaining > 0} />
          {slipData.issues.length ? (
            <div className="mt-6 text-sm">
              {slipData.issues.map((i) => (
                <Link
                  key={i.id}
                  href={`/api/salary-slips/${slipData!.id}/pdf?issueId=${i.id}`}
                  target="_blank"
                  className="mr-4 text-primary underline"
                >
                  PDF ({new Date(i.issuedAt).toLocaleString("ja-JP")})
                </Link>
              ))}
            </div>
          ) : null}
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
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/60 px-4 py-2 text-sm hover:bg-background"
                    >
                      <span className="font-medium">{slip.staff.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-10">
            <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">発行履歴</h2>
            {issuedSlips.length === 0 ? (
              <p className="text-sm text-muted">この月に発行された給与明細はありません。</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {issuedSlips.map((slip) => (
                  <li
                    key={slip.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white/60 px-4 py-2 text-sm"
                  >
                    <span className="font-medium">{slip.staff.name}</span>
                    <span className="text-muted">{getTotals(slip).net}円</span>
                    <div className="flex flex-wrap gap-3">
                      {slip.issues.map((i) => (
                        <Link
                          key={i.id}
                          href={`/api/salary-slips/${slip.id}/pdf?issueId=${i.id}`}
                          target="_blank"
                          className="text-xs text-primary underline"
                        >
                          PDF（{new Date(i.issuedAt).toLocaleString("ja-JP")}）
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
