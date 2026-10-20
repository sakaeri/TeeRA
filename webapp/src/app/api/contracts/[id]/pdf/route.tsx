import { verifySession, getActiveMembership } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { renderContractPdf } from "@/lib/domain/contractPdf";

// 雇用契約書のPDF。本人と、その契約の会社の本部・チーム管理側が開ける。
export async function GET(_request: Request, { params }: RouteContext<"/api/contracts/[id]/pdf">) {
  const { id } = await params;
  const { userId } = await verifySession();
  const contract = await prisma.staffContract.findUnique({ where: { id }, include: { template: true } });
  if (!contract) return new Response("not found", { status: 404 });

  const isOwnContract = contract.staffUserId === userId;
  if (!isOwnContract) {
    const membership = await getActiveMembership(userId);
    const isCompanyMember = membership?.companyId === contract.template.companyId && membership.role !== "STAFF";
    if (!isCompanyMember) return new Response("forbidden", { status: 403 });
  }

  const rendered = await renderContractPdf(contract.id);
  if (!rendered) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(rendered.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent("雇用契約書.pdf")}`,
    },
  });
}
