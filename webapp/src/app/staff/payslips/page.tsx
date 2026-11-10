import { requireCompanyStaffRole } from "@/lib/auth/session";
import { listMyPayslips } from "@/lib/domain/staffPayslips";
import { StaffPayslipsView } from "@/components/staff/StaffPayslipsView";

export default async function StaffPayslipsPage() {
  const { userId } = await requireCompanyStaffRole();
  const companies = await listMyPayslips(userId);
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="mb-4 font-serif-jp text-xl font-bold text-primary">給料明細</h1>
      <StaffPayslipsView companies={companies} />
    </main>
  );
}
