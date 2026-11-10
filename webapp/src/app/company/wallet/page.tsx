import { requireCompanyAdminOrEditor } from "@/lib/auth/session";
import { listWalletHistory } from "@/lib/domain/teeWallet";
import { teeYenPerUnit } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { WalletView } from "@/components/company/WalletView";
import { listPlanChangeEvents, getPlanCancelStatus } from "@/lib/domain/subscriptions";
import { canManageCompanySettings } from "@/lib/auth/permissions";
import { PLAN_LABEL } from "@/lib/domain/plans";

const PLAN_REASON_LABEL: Record<string, string> = {
  CHANGED: "プラン変更",
  CANCELED: "解約で無料プランへ",
  PAST_DUE: "支払いができず無料プランへ",
  RESTORED: "支払いが確認でき、プランを戻しました",
  CANCEL_SCHEDULED: "無料プランに戻す申し込み（期間の終わりに解約）",
  CANCEL_UNDONE: "無料プランに戻す申し込みを取り消し",
  REPAIRED: "プランの表示を修正",
};

const LEDGER_LABEL: Record<string, string> = {
  CHARGE_CARD: "クレジットカード購入",
  LOCK_RECRUITMENT: "公開募集ロック",
  UNLOCK_REFUND_RECRUITMENT: "公開募集ロック解除",
  CONSUME_SALARY_ISSUE: "給与明細書発行",
  CONSUME_INVOICE_ISSUE: "請求書発行",
  CONSUME_STAFF_INVOICE_OPEN: "業務委託の請求書を開く",
  CONSUME_TEAM_UNLOCK: "追加チーム作成",
  ADJUSTMENT: "調整",
};

export default async function WalletPage() {
  const { membership } = await requireCompanyAdminOrEditor();
  const company = await prisma.company.findUniqueOrThrow({ where: { id: membership.companyId } });
  const [ledgerEntries, planEvents, planCancel] = await Promise.all([
    listWalletHistory(membership.companyId),
    listPlanChangeEvents(membership.companyId),
    getPlanCancelStatus(membership.companyId),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <h1 className="mb-6 font-serif-jp text-2xl font-bold">Tee残高</h1>
      <WalletView
        teeBalance={company.teeBalance}
        yenPerUnit={teeYenPerUnit()}
        stripeConfigured={Boolean(process.env.STRIPE_SECRET_KEY) && Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)}
        planTier={company.planTier}
        planCancel={planCancel}
        canManagePlan={canManageCompanySettings(membership)}
        ledgerEntries={[
          ...ledgerEntries.map((e) => ({
            id: e.id,
            label: LEDGER_LABEL[e.type] ?? e.type,
            amount: e.amount as number | null,
            balanceAfter: e.balanceAfter as number | null,
            createdAt: e.createdAt.toISOString(),
          })),
          // プランの変更（誰が・どのプランに）も同じ一覧に出す
          ...planEvents.map((e) => ({
            id: `plan-${e.id}`,
            label:
              e.reason === "CANCEL_UNDONE"
                ? `${PLAN_REASON_LABEL[e.reason]}${e.byUserName ? `（${e.byUserName}）` : ""}`
                : `${PLAN_REASON_LABEL[e.reason] ?? "プラン変更"}：${PLAN_LABEL[e.fromTier]}→${PLAN_LABEL[e.toTier]}${e.byUserName ? `（${e.byUserName}）` : ""}`,
            amount: null,
            balanceAfter: null,
            createdAt: e.createdAt.toISOString(),
          })),
        ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
      />
    </main>
  );
}
