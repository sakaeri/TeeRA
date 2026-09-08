import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny, isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { listStaff } from "@/lib/domain/roster";
import { getOrCreateSalarySlip, getTotals, listIssuedSalarySlipsForCompany } from "@/lib/domain/payroll";
import { prisma } from "@/lib/prisma";
import { SalarySlipEditor } from "@/components/company/SalarySlipEditor";
import { FinanceTabs } from "@/components/company/FinanceTabs";
import { todayJstParts, earliestAllowedMonth, cutoffMonthString } from "@/lib/date";
import { redirect } from "next/navigation";
import Link from "next/link";

function currentMonth() {
  const today = todayJstParts();
  return `${today.year}-${String(today.month).padStart(2, "0")}`;
}

function monthLabel(targetMonth: string) {
  const [year, month] = targetMonth.split("-");
  return `${year}年${Number(month)}月`;
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

  // 発行履歴一覧 — 発行済み（課金済み）のものだけを月ごとにまとめる。
  // チームマネージャー/リーダーは自チームのスタッフ分だけに絞る。
  const accessibleStaffIds = new Set(staff.map((s) => s.userId));
  const allIssuedSlips = await listIssuedSalarySlipsForCompany(membership.companyId, minMonth ?? undefined);
  const issuedSlips = allIssuedSlips.filter((s) => accessibleStaffIds.has(s.staffUserId));
  const issuedByMonth = new Map<string, typeof issuedSlips>();
  for (const slip of issuedSlips) {
    const list = issuedByMonth.get(slip.targetMonth) ?? [];
    list.push(slip);
    issuedByMonth.set(slip.targetMonth, list);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">給与計算</h1>
      <FinanceTabs active="payroll" invoicesEnabled={company.agencyEnabled} />

      {minMonth ? (
        <p className="mb-4 rounded-lg bg-accent/10 px-3 py-2 text-xs text-primary">
          無料プランでは過去データの閲覧は直近3ヶ月までです。それ以前を見るにはプランのアップグレードが必要です。
        </p>
      ) : null}

      <form method="get" className="mb-6 flex items-end gap-3 rounded-xl border border-border bg-white/60 p-4">
        <label className="flex flex-col gap-1 text-xs">
          対象月
          <input
            type="month"
            name="month"
            defaultValue={targetMonth}
            min={minMonth ?? undefined}
            className="rounded-lg border border-border px-2 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          スタッフ
          <select name="staff" defaultValue={staffUserId} className="rounded-lg border border-border px-2 py-2 text-sm">
            <option value="">選択してください</option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          開く
        </button>
      </form>

      {slipData ? (
        <SalarySlipEditor slip={slipData} />
      ) : (
        <p className="text-sm text-muted">対象月とスタッフを選択してください。</p>
      )}

      {slipData?.issues.length ? (
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

      <section className="mt-10">
        <h2 className="mb-3 font-serif-jp text-lg font-bold text-primary">発行履歴</h2>
        {issuedByMonth.size === 0 ? (
          <p className="text-sm text-muted">まだ発行された給与明細はありません。</p>
        ) : (
          <div className="flex flex-col gap-6">
            {[...issuedByMonth.entries()].map(([month, slips]) => (
              <div key={month}>
                <h3 className="mb-2 text-sm font-semibold text-muted">{monthLabel(month)}</h3>
                <ul className="flex flex-col gap-1">
                  {slips.map((slip) => (
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
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
