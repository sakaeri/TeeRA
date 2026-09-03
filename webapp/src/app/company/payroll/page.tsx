import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { canManageAny, isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { listStaff } from "@/lib/domain/roster";
import { getOrCreateSalarySlip, getTotals } from "@/lib/domain/payroll";
import { prisma } from "@/lib/prisma";
import { SalarySlipEditor } from "@/components/company/SalarySlipEditor";
import { todayJstParts } from "@/lib/date";
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
  const targetMonth = typeof sp.month === "string" ? sp.month : currentMonth();
  const staffUserId = typeof sp.staff === "string" ? sp.staff : undefined;

  const allStaff = await listStaff(membership.companyId);
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
    paidLeaveGrantDays: number;
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
      paidLeaveGrantDays: slip.paidLeaveGrantDays,
      totals,
      issues: issues.map((i) => ({ id: i.id, issuedAt: i.issuedAt.toISOString(), chargedTee: i.chargedTee })),
      unresolved: slip.unresolved,
    };
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">給与計算</h1>

      <form method="get" className="mb-6 flex items-end gap-3 rounded-xl border border-border bg-white/60 p-4">
        <label className="flex flex-col gap-1 text-xs">
          対象月
          <input type="month" name="month" defaultValue={targetMonth} className="rounded-lg border border-border px-2 py-2 text-sm" />
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
    </main>
  );
}
