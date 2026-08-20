import { renderToBuffer } from "@react-pdf/renderer";
import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listRedemptionsForCompany } from "@/lib/domain/promo";
import { prisma } from "@/lib/prisma";
import { PendingShipmentPdfDocument, type PendingShipmentPdfData } from "@/lib/pdf/promoShipment";

export async function GET() {
  const { membership } = await requireCompanyAdminOrEditor();

  const [redemptions, company] = await Promise.all([
    listRedemptionsForCompany(membership.companyId),
    prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } }),
  ]);

  const data: PendingShipmentPdfData = {
    companyName: company.name,
    issuedAt: new Date().toISOString().slice(0, 10),
    rows: redemptions
      .filter((r) => r.status !== "SHIPPED")
      .map((r) => ({
        itemName: r.promoItem.name,
        staffName: r.staff.name,
        createdAt: r.createdAt.toISOString().slice(0, 10),
        shippingAddress: r.shippingAddress ?? "",
        shippingPhone: r.shippingPhone ?? "",
      })),
  };

  const buffer = await renderToBuffer(<PendingShipmentPdfDocument data={data} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="promo-pending-shipment-${data.issuedAt}.pdf"`,
    },
  });
}
