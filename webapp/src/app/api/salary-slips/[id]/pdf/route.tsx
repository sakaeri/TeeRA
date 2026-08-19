import { renderToBuffer } from "@react-pdf/renderer";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getTotals } from "@/lib/domain/payroll";
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

  const isOwnStaff = membership.role === "STAFF" && slip.staffUserId === userId;
  const isCompanyMember = membership.companyId === slip.companyId && membership.role !== "STAFF";
  if (!isOwnStaff && !isCompanyMember) return new Response("forbidden", { status: 403 });

  let data: SalarySlipPdfData;
  if (issueId) {
    const issue = await prisma.salarySlipIssue.findUnique({ where: { id: issueId } });
    if (!issue || issue.salarySlipId !== slip.id) return new Response("not found", { status: 404 });
    const snap = issue.snapshot as unknown as Record<string, unknown>;
    data = {
      companyName: slip.company.name,
      staffName: snap.staffName as string,
      targetMonth: snap.targetMonth as string,
      issuedAt: (snap.issuedAt as string).slice(0, 10),
      lines: snap.lines as SalarySlipPdfData["lines"],
      deductions: snap.deductions as SalarySlipPdfData["deductions"],
      paidLeaveDaysUsed: snap.paidLeaveDaysUsed as number,
      paidLeaveDailyRate: snap.paidLeaveDailyRate as number,
      grossFromShifts: snap.grossFromShifts as number,
      paidLeaveAmount: snap.paidLeaveAmount as number,
      gross: snap.gross as number,
      totalDeductions: snap.totalDeductions as number,
      net: snap.net as number,
      watermarked: false,
    };
  } else {
    const totals = getTotals(slip);
    data = {
      companyName: slip.company.name,
      staffName: slip.staff.name,
      targetMonth: slip.targetMonth,
      issuedAt: new Date().toISOString().slice(0, 10),
      lines: slip.lines,
      deductions: slip.deductions as SalarySlipPdfData["deductions"],
      paidLeaveDaysUsed: slip.paidLeaveDaysUsed,
      paidLeaveDailyRate: slip.paidLeaveDailyRate,
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
