import { renderToBuffer } from "@react-pdf/renderer";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listApprovedShiftsForTaggedAgencyStaff } from "@/lib/domain/relationships";
import { todayJst, todayJstParts } from "@/lib/date";
import { CalendarPdfDocument, type CalendarPdfData } from "@/lib/pdf/calendar";

// TeeRAを使っていない（実体のない）派遣会社にタグ付けされている自社
// スタッフの、承認済み実績だけを載せた月次PDF。派遣会社への実績共有用
// （送信はせず、ダウンロードしてLINE/FAX等好きな方法で渡してもらう）。
export async function GET(request: Request, { params }: RouteContext<"/api/agency-relationships/[id]/performance-pdf">) {
  const { id } = await params;
  const { membership } = await requireCompanyAdminOrEditor();

  const rel = await prisma.companyRelationship.findUnique({ where: { id } });
  if (!rel || rel.clientCompanyId !== membership.companyId) return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const today = todayJstParts();
  const year = Number(url.searchParams.get("y")) || today.year;
  const month = Number(url.searchParams.get("m")) || today.month;

  const [shifts, company] = await Promise.all([
    listApprovedShiftsForTaggedAgencyStaff({ companyId: membership.companyId, viaAgencyRelationshipId: id, year, month }),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const data: CalendarPdfData = {
    companyName: company.name,
    year,
    month,
    issuedAt: todayJst(),
    filterLabel: `派遣会社：${rel.proxyName ?? ""}（承認済みのみ）`,
    shifts: shifts.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      staffName: s.staff.name,
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      isUndecided: s.isUndecided,
      clientName: null,
    })),
  };

  const buffer = await renderToBuffer(<CalendarPdfDocument data={data} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="agency-performance-${year}-${String(month).padStart(2, "0")}.pdf"`,
    },
  });
}
