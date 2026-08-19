import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listWalletHistory } from "@/lib/domain/teeWallet";
import { teeYenPerUnit } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { WalletView } from "@/components/company/WalletView";

const LEDGER_LABEL: Record<string, string> = {
  CHARGE_CARD: "クレジットカード購入",
  CHARGE_BANK_CONFIRMED: "銀行振込入金",
  LOCK_RECRUITMENT: "公開募集ロック",
  UNLOCK_REFUND_RECRUITMENT: "公開募集ロック解除",
  CONSUME_SALARY_ISSUE: "給与明細書発行",
  CONSUME_INVOICE_ISSUE: "請求書発行",
  ADJUSTMENT: "調整",
};

export default async function WalletPage() {
  const { membership } = await requireCompanyAdminOrEditor();
  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });
  const { ledgerEntries, bankTransfers } = await listWalletHistory(membership.companyId);

  return (
    <main className="mx-auto w-full max-w-3xl px-8 py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">Tee残高</h1>
      <WalletView
        teeBalance={company.teeBalance}
        yenPerUnit={teeYenPerUnit()}
        stripeConfigured={Boolean(process.env.STRIPE_SECRET_KEY)}
        ledgerEntries={ledgerEntries.map((e) => ({
          id: e.id,
          label: LEDGER_LABEL[e.type] ?? e.type,
          amount: e.amount,
          balanceAfter: e.balanceAfter,
          createdAt: e.createdAt.toISOString(),
        }))}
        bankTransfers={bankTransfers.map((b) => ({
          id: b.id,
          teeAmount: b.teeAmount,
          yenAmount: b.yenAmount,
          status: b.status,
          createdAt: b.createdAt.toISOString(),
        }))}
      />
    </main>
  );
}
