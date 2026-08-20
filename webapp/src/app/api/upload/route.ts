import { put } from "@vercel/blob";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";

// Shared upload endpoint for anything a company admin needs to attach a file
// to — promo item images today, staff ID documents later. Files are stored
// under a per-company prefix so one company can never guess/access another's
// blob path.
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const { membership } = await requireCompanyAdminOrEditor();

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
