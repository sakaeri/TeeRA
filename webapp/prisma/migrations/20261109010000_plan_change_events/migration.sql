-- プラン変更の履歴と、申し込んだ人
ALTER TABLE "StripeSubscription" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;

CREATE TABLE IF NOT EXISTS "PlanChangeEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromTier" "PlanTier" NOT NULL,
    "toTier" "PlanTier" NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanChangeEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PlanChangeEvent_companyId_createdAt_idx" ON "PlanChangeEvent"("companyId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "PlanChangeEvent" ADD CONSTRAINT "PlanChangeEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 以前は前の契約からの連絡でプランが書き戻されていた。一番新しい有効な契約のプランに直す
-- （直したことを履歴にも残す）
INSERT INTO "PlanChangeEvent" ("id", "companyId", "fromTier", "toTier", "reason", "createdAt")
SELECT 'repair_' || c.id, c.id, c."planTier", s."planTier", 'REPAIRED', CURRENT_TIMESTAMP
FROM "Company" c
JOIN (
  SELECT DISTINCT ON ("companyId") "companyId", "planTier"
  FROM "StripeSubscription" WHERE status = 'ACTIVE'
  ORDER BY "companyId", "createdAt" DESC
) s ON s."companyId" = c.id
WHERE c."planTier" <> s."planTier"
ON CONFLICT ("id") DO NOTHING;

UPDATE "Company" c SET "planTier" = s."planTier"
FROM (
  SELECT DISTINCT ON ("companyId") "companyId", "planTier"
  FROM "StripeSubscription" WHERE status = 'ACTIVE'
  ORDER BY "companyId", "createdAt" DESC
) s
WHERE s."companyId" = c.id AND c."planTier" <> s."planTier";
