import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { buildContractDocument, type ContractDocument } from "@/lib/contractDocument";
import { ContractPdfDocument } from "@/lib/pdf/contract";

export function formatConsentedAt(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(date);
}

// 契約書のPDF。同意済みなら同意した時点の内容（consentSnapshot）と同意の
// 記録を、同意の記録が無い契約（同意前・この機能より前の同意）は今の内容から
// 作る。アップロードのみの契約は書面そのものが正本なので対象外（null）。
export async function renderContractPdf(staffContractId: string) {
  const contract = await prisma.staffContract.findUniqueOrThrow({
    where: { id: staffContractId },
    include: { template: { include: { company: true } }, staff: true },
  });
  if (contract.template.isUploadOnly) return null;

  const document =
    (contract.consentSnapshot as ContractDocument | null) ??
    buildContractDocument({
      company: { name: contract.template.company.name, address: contract.template.company.address },
      party: {
        name: contract.partyName || contract.staff.name,
        address: contract.partyAddress,
        phoneNumber: contract.partyPhoneNumber,
      },
      template: contract.template,
      wageAmount: contract.wageAmountSnapshot,
      contractStartDate: (contract.contractStartDate ?? contract.template.contractStartDate).toISOString().slice(0, 10),
      contractEndDate: (contract.contractEndDate ?? contract.template.contractEndDate)?.toISOString().slice(0, 10) ?? null,
    });
  const consent =
    contract.consentSnapshot && contract.consentedAt
      ? {
          consentedAt: formatConsentedAt(contract.consentedAt),
          email: contract.consentEmail,
          emailVerified: contract.consentEmailVerified,
          ip: contract.consentIp,
          userAgent: contract.consentUserAgent,
          hash: contract.consentHash,
        }
      : null;
  const pdf = await renderToBuffer(<ContractPdfDocument document={document} consent={consent} />);
  return { contract, pdf };
}
