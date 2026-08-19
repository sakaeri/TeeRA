import { redirect } from "next/navigation";
import { verifySession, getActiveMembership } from "@/lib/auth/session";

export default async function HomeGatePage() {
  const { userId } = await verifySession();
  const membership = await getActiveMembership(userId);

  if (!membership) {
    redirect("/register/company");
  }

  redirect(membership.role === "STAFF" ? "/staff" : "/company");
}
