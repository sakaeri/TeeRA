import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listOpenRecruitmentsForStaff } from "@/lib/domain/recruitment";
import { RecruitmentListView } from "@/components/staff/RecruitmentListView";

export default async function StaffRecruitmentsPage() {
  const { userId, membership } = await requireCompanyStaffRole();
  const recruitments = await listOpenRecruitmentsForStaff({ companyId: membership.companyId, staffUserId: userId });

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <RecruitmentListView
        recruitments={recruitments
          .map((r) => ({
            id: r.id,
            title: r.title,
            companyName: r.company.name,
            visibility: r.visibility,
            date: r.date.toISOString().slice(0, 10),
            startTime: r.startTime,
            endTime: r.endTime,
            hourlyWage: r.hourlyWage,
            wageType: r.wageType,
            extraItems: r.extraItems as { label: string; value: string }[],
            maxEntries: r.maxEntries,
            filled: r.entries.filter((e) => e.status !== "REJECTED").length,
            alreadyApplied: r.entries.some((e) => e.staffUserId === userId && e.status !== "REJECTED"),
            isAffiliated: r.isAffiliated,
          }))
          // 満員の募集、および自分が既に応募済みの募集は、スクロールする
          // だけの雑音になるため出さない（確定シフトと時間が重なる募集は
          // listOpenRecruitmentsForStaff側で既に除外済み）。
          .filter((r) => !r.alreadyApplied && r.filled < r.maxEntries)}
      />
    </main>
  );
}
