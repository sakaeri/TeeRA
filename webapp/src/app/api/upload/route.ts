import { put } from "@vercel/blob";
import { requireActiveMembership } from "@/lib/auth/session";

// Shared upload endpoint for anything a company member needs to attach a
// file to — promo item images (company admin), staff ID documents (staff
// themselves or a company admin uploading on their behalf). Any active
// membership role may use it; files are stored under a per-company prefix
// so one company can never guess/access another's blob path.
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const { membership } = await requireActiveMembership();

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "file too large (max 8MB)" }, { status: 400 });
  }

  const blob = await put(`${membership.companyId}/${Date.now()}-${file.name}`, file, {
    access: "public",
    addRandomSuffix: true,
  });

  return Response.json({ url: blob.url });
}
