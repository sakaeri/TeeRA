-- 「無料プランに戻す」（今の期間の終わりに解約する予約）
ALTER TABLE "StripeSubscription" ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StripeSubscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "StripeSubscription" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "StripeSubscription" ADD COLUMN IF NOT EXISTS "cancelRequestedByUserId" TEXT;
