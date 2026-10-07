import { renderToBuffer } from "@react-pdf/renderer";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listShiftsForMonth } from "@/lib/domain/shifts";
import { prisma } from "@/lib/prisma";
import { todayJst, todayJstParts } from "@/lib/date";
import { CalendarPdfDocument, type CalendarPdfData } from "@/lib/pdf/calendar";

export async function GET(request: Request) {
  const { membership } = await requireCompanyAdminOrEditor();

  const url = new URL(request.url);
  const today = todayJstParts();
  const year = Number(url.searchParams.get("y")) || today.year;
  const month = Number(url.searchParams.get("m")) || today.month;
  const teamId = url.searchParams.get("team") || undefined;
  const companyRelationshipId = url.searchParams.get("rel") || undefined;

  const [shifts, company, team, relationship] = await Promise.all([
    listShiftsForMonth({ companyId: membership.companyId, year, month, teamId, companyRelationshipId }),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
    teamId ? prisma.team.findUnique({ where: { id: teamId } }) : null,
    companyRelationshipId
      ? prisma.companyRelationship.findUnique({
          where: { id: companyRelationshipId },
          include: { clientCompany: true, agencyCompany: true },
        })
      : null,
  ]);

  // 依頼主/派遣会社どちらの絞り込みかは関係の向きで判定する
  // (listShiftsForMonthの絞り込みロジックと同じ考え方)。
  const relationshipTypeLabel = relationship
    ? (relationship.agencyCompanyId === membership.companyId ? "依頼主" : "派遣会社")
    : undefined;
  const relationshipName = relationship
    ? (relationship.agencyCompanyId === membership.companyId
        ? (relationship.clientCompany?.name ?? relationship.proxyName ?? "")
        : (relationship.agencyCompany?.name ?? relationship.proxyName ?? ""))
    : undefined;
  const filterLabel =
    [team?.name, relationshipTypeLabel && relationshipName ? `${relationshipTypeLabel}：${relationshipName}` : null]
      .filter(Boolean)
      .join("・") || undefined;

  const data: CalendarPdfData = {
    companyName: company.name,
    year,
    month,
    issuedAt: todayJst(),
    filterLabel,
    // 依頼主/派遣会社で絞り込んでいる時は全行が同じ勤務先になり冗長なため、
    // その時だけ業務内容を代わりに出す（絞り込みなし/チーム絞り込みのみの
    // 時は、複数の勤務先が混在し得るので勤務先のまま）。
    thirdColumn: companyRelationshipId ? "task" : "workplace",
    shifts: shifts.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      staffName: s.staff.name,
      startTime: s.startTime,
      endTime: s.endTime,
      isAllDay: s.isAllDay,
      isUndecided: s.isUndecided,
      clientName: s.companyRelationship?.clientCompany?.name ?? s.companyRelationship?.proxyName ?? null,
      taskName: s.taskName,
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
