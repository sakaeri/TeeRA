import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listAllStaffNotices } from "@/lib/domain/notices";
import { StaffNoticesList } from "@/components/staff/StaffNoticesList";

export default async function StaffNoticesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await requireCompanyStaffRole();
  const sp = await searchParams;
  const notices = await listAllStaffNotices(userId);
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4 sm:px-6 sm:py-10">
      <h1 className="mb-3 font-serif-jp text-xl font-bold text-primary">お知らせ</h1>
      <StaffNoticesList notices={notices} initialOpenId={typeof sp.open === "string" ? sp.open : null} />
    </main>
  );
}
