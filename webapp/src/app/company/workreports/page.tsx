import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listPendingReportsForCompany } from "@/lib/domain/workReports";
import { prisma } from "@/lib/prisma";
import { WorkReportsQueue } from "@/components/company/WorkReportsQueue";

const OUTCOME_LABEL: Record<string, string> = {
  WORKED: "出勤した",
  ABSENT: "欠勤",
  CANCELLED_BY_EMPLOYER: "勤務先からのキャンセル",
};

export default async function WorkReportsPage() {
  const { membership } = await requireCompanyAdminOrEditor();
  const reports = await listPendingReportsForCompany(membership.companyId);

  const shifts = await prisma.shift.findMany({
    where: { id: { in: reports.map((r) => r.shiftId) } },
  });
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  return (
    <main className="mx-auto w-full max-w-4xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">業務報告</h1>
      <WorkReportsQueue
        reports={reports.map((r) => {
          const shift = shiftById.get(r.shiftId);
          return {
            id: r.id,
            staffName: r.staff.name,
            outcome: OUTCOME_LABEL[r.outcome] ?? r.outcome,
            date: shift?.date.toISOString().slice(0, 10) ?? "",
            computedHours: (r.computedMinutes / 60).toFixed(1),
            comment: r.comment,
          };
        })}
      />
    </main>
  );
}
