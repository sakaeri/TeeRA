import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { isCompanyScopeAdmin } from "@/lib/auth/permissions";
import { listStaff } from "@/lib/domain/roster";
import { listSalarySlipsForCompany, getPaymentTerms, buildSalarySlipPdfLines, resolveWorkplaceNamesByShiftId } from "@/lib/domain/payroll";
import { prisma } from "@/lib/prisma";
import { SalarySlipDocument, type SalarySlipPdfData } from "@/lib/pdf/salarySlip";

export async function GET(request: Request) {
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);
  if (!membership || membership.role === "STAFF") return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  if (!month) return new Response("month required", { status: 400 });

  const allStaff = await listStaff(membership.companyId);
  const payableStaff = allStaff.filter((s) => !s.viaAgencyRelationshipName);
  const staff = isCompanyScopeAdmin(membership)
    ? payableStaff
    : payableStaff.filter((s) => s.teams.some((t) => membership.teamMemberships.some((tm) => tm.teamId === t.teamId)));
  const accessibleStaffIds = new Set(staff.map((s) => s.userId));

  const slipsThisMonth = (await listSalarySlipsForCompany(membership.companyId, month)).filter(
    (s) => s.status === "ISSUED" && accessibleStaffIds.has(s.staffUserId),
  );
  if (slipsThisMonth.length === 0) return new Response("no issued salary slips", { status: 404 });

  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });

  const mergedPdf = await PDFDocument.create();
  for (const slip of slipsThisMonth) {
    const latestIssue = slip.issues.reduce((latest, i) => (i.issuedAt > latest.issuedAt ? i : latest));
    const snap = latestIssue.snapshot as unknown as Record<string, unknown>;
    const { paymentDay } = await getPaymentTerms(slip.companyId, slip.staffUserId, snap.targetMonth as string);
    const snapLines = snap.lines as { kind?: string; shiftId?: string | null; description: string; hours: number; rate: number; amount: number }[];
    const snapWorkplaceMap = await resolveWorkplaceNamesByShiftId(
      snapLines.map((l) => l.shiftId).filter((id): id is string => Boolean(id)),
    );
    const data: SalarySlipPdfData = {
      companyName: company.name,
      companyAddress: company.address,
      companyPhoneNumber: company.phoneNumber,
      staffName: snap.staffName as string,
      targetMonth: snap.targetMonth as string,
      issuedAt: (snap.issuedAt as string).slice(0, 10),
      paymentDay,
      lines: buildSalarySlipPdfLines(snapLines, snapWorkplaceMap),
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
    const buffer = await renderToBuffer(<SalarySlipDocument data={data} />);
    const sourcePdf = await PDFDocument.load(buffer);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    for (const page of copiedPages) mergedPdf.addPage(page);
  }

  const mergedBytes = await mergedPdf.save();

  return new Response(new Uint8Array(mergedBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="salary-slips-${month}.pdf"`,
    },
  });
}
