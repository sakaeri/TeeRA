import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listOpenRecruitmentsForStaff } from "@/lib/domain/recruitment";
import { RecruitmentListView } from "@/components/staff/RecruitmentListView";

export default async function StaffRecruitmentsPage() {
  const { userId } = await requireCompanyStaffRole();
  const recruitments = await listOpenRecruitmentsForStaff();

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">募集一覧</h1>
      <RecruitmentListView
        recruitments={recruitments.map((r) => ({
          id: r.id,
          title: r.title,
          companyName: r.company.name,
          date: r.date.toISOString().slice(0, 10),
          startTime: r.startTime,
          endTime: r.endTime,
          hourlyWage: r.hourlyWage,
          maxEntries: r.maxEntries,
          filled: r.entries.filter((e) => e.status !== "REJECTED").length,
          alreadyApplied: r.entries.some((e) => e.staffUserId === userId && e.status !== "REJECTED"),
        }))}
      />
    </main>
  );
}
