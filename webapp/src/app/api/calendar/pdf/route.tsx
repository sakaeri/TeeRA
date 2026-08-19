import { renderToBuffer } from "@react-pdf/renderer";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listShiftsForMonth } from "@/lib/domain/shifts";
import { prisma } from "@/lib/prisma";
import { CalendarPdfDocument, type CalendarPdfData } from "@/lib/pdf/calendar";

export async function GET(request: Request) {
  const { membership } = await requireCompanyAdminOrEditor();

  const url = new URL(request.url);
  const now = new Date();
  const year = Number(url.searchParams.get("y")) || now.getUTCFullYear();
  const month = Number(url.searchParams.get("m")) || now.getUTCMonth() + 1;

  const [shifts, company] = await Promise.all([
    listShiftsForMonth({ companyId: membership.companyId, year, month }),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const data: CalendarPdfData = {
    companyName: company.name,
    year,
    month,
    issuedAt: new Date().toISOString().slice(0, 10),
    shifts: shifts.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      staffName: s.staff.name,
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      isUndecided: s.isUndecided,
      clientName: s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? null,
    })),
  };

  const buffer = await renderToBuffer(<CalendarPdfDocument data={data} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="shift-calendar-${year}-${String(month).padStart(2, "0")}.pdf"`,
    },
  });
}
