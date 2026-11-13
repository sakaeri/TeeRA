import { renderToBuffer } from "@react-pdf/renderer";
import { isMonthHiddenByFreePlan, freePlanHiddenResponse } from "@/lib/domain/plans";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getTotals, getEmploymentType, payrollPeriod, buildSalarySlipPdfLines, resolveWorkplaceNamesByShiftId } from "@/lib/domain/payroll";
import { todayJst } from "@/lib/date";
import { SalarySlipDocument, type SalarySlipPdfData } from "@/lib/pdf/salarySlip";

export async function GET(request: Request, { params }: RouteContext<"/api/salary-slips/[id]/pdf">) {
  const { id } = await params;
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  if (!membership) return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const issueId = url.searchParams.get("issueId");

  const slip = await prisma.salarySlip.findUnique({
    where: { id },
    include: { lines: { orderBy: { sortOrder: "asc" } }, staff: true, company: true },
  });
  if (!slip) return new Response("not found", { status: 404 });

  const isCompanyMember = membership.companyId === slip.companyId && membership.role !== "STAFF";
  // 会社側は無料プランなら直近3か月まで（スタッフ本人の明細は制限しない）
  if (isCompanyMember && (await isMonthHiddenByFreePlan(slip.companyId, slip.targetMonth))) return freePlanHiddenResponse();
  // スタッフ本人は、電子交付に同意していれば、発行済みの内容（最新の発行）だけ見られる（下書きは見せない）
  let effectiveIssueId = issueId;
  if (!isCompanyMember) {
    if (slip.staffUserId !== userId) return new Response("forbidden", { status: 403 });
    const own = await prisma.companyMembership.findFirst({
      where: { userId, companyId: slip.companyId },
      select: { payslipEConsentAt: true },
    });
    if (!own?.payslipEConsentAt) return new Response("forbidden", { status: 403 });
    const latest = await prisma.salarySlipIssue.findFirst({ where: { salarySlipId: slip.id }, orderBy: { issuedAt: "desc" } });
    if (!latest) return new Response("not found", { status: 404 });
    if (!effectiveIssueId) effectiveIssueId = latest.id;
  }

  let data: SalarySlipPdfData;
  if (effectiveIssueId) {
    const issue = await prisma.salarySlipIssue.findUnique({ where: { id: effectiveIssueId } });
    if (!issue || issue.salarySlipId !== slip.id) return new Response("not found", { status: 404 });
    const snap = issue.snapshot as unknown as Record<string, unknown>;
    const employmentType = await getEmploymentType(slip.companyId, slip.staffUserId, snap.targetMonth as string);
    const snapLines = snap.lines as { kind?: string; shiftId?: string | null; description: string; hours: number; rate: number; amount: number }[];
    const snapWorkplaceMap = await resolveWorkplaceNamesByShiftId(
      snapLines.map((l) => l.shiftId).filter((id): id is string => Boolean(id)),
    );
    data = {
      companyName: slip.company.name,
      companyAddress: slip.company.address,
      companyPhoneNumber: slip.company.phoneNumber,
      staffName: snap.staffName as string,
      targetMonth: snap.targetMonth as string,
      periodRangeLabel: (snap.periodRangeLabel as string | null | undefined) ?? null,
      issuedAt: (snap.issuedAt as string).slice(0, 10),
      paymentDay: (snap.paymentDay as string | null) ?? null,
      note: (snap.note as string | null) ?? null,
      isContractor: employmentType === "CONTRACTOR",
      lines: buildSalarySlipPdfLines(snapLines, snapWorkplaceMap, { groupShiftLines: (snap.groupShiftLines as boolean | undefined) ?? true }),
      deductions: snap.deductions as SalarySlipPdfData["deductions"],
      paidLeaveDaysUsed: snap.paidLeaveDaysUsed as number,
      paidLeaveDailyRate: snap.paidLeaveDailyRate as number,
      paidLeaveConfigured: Boolean(snap.paidLeaveConfigured),
      grossFromShifts: snap.grossFromShifts as number,
      paidLeaveAmount: snap.paidLeaveAmount as number,
      gross: snap.gross as number,
      totalDeductions: snap.totalDeductions as number,
      net: snap.net as number,
      watermarked: false,
    };
  } else {
    const totals = getTotals(slip);
    const employmentType = await getEmploymentType(slip.companyId, slip.staffUserId, slip.targetMonth);
    const membership = await prisma.companyMembership.findFirst({
      where: { companyId: slip.companyId, userId: slip.staffUserId },
      select: { nextPaidLeaveGrantDate: true },
    });
    const liveWorkplaceMap = await resolveWorkplaceNamesByShiftId(
      slip.lines.map((l) => l.shiftId).filter((id): id is string => Boolean(id)),
    );
    data = {
      companyName: slip.company.name,
      companyAddress: slip.company.address,
      companyPhoneNumber: slip.company.phoneNumber,
      staffName: slip.staff.name,
      targetMonth: slip.targetMonth,
      periodRangeLabel: (await payrollPeriod(slip.companyId, slip.targetMonth)).rangeLabel,
      issuedAt: todayJst(),
      paymentDay: slip.paymentDay,
      note: slip.note,
      isContractor: employmentType === "CONTRACTOR",
      lines: buildSalarySlipPdfLines(slip.lines, liveWorkplaceMap, { groupShiftLines: slip.groupShiftLines }),
      deductions: slip.deductions as SalarySlipPdfData["deductions"],
      paidLeaveDaysUsed: slip.paidLeaveDaysUsed,
      paidLeaveDailyRate: slip.paidLeaveDailyRate,
      paidLeaveConfigured: membership?.nextPaidLeaveGrantDate != null,
      ...totals,
      watermarked: true,
    };
  }

  const buffer = await renderToBuffer(<SalarySlipDocument data={data} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="salary-slip-${slip.targetMonth}.pdf"`,
    },
  });
}
