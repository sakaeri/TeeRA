import { requireCompanyStaffRole } from "@/lib/auth/session";
import { StaffHowTo } from "@/components/staff/StaffHowTo";

export default async function StaffHowToPage() {
  await requireCompanyStaffRole();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 print:max-w-none print:p-0">
      <StaffHowTo />
    </main>
  );
}
