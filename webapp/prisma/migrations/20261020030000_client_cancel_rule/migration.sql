-- AlterTable
ALTER TABLE "CompanyPlacementRate" ADD COLUMN     "cancelRuleOverride" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ClientCancelRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "companyRelationshipId" TEXT NOT NULL,
    "cancelPolicy" "CancelPolicy" NOT NULL DEFAULT 'FREE',
    "cancelDeadlineDaysBefore" INTEGER,
    "cancelDeadlineTime" TEXT,
    "cancelFeeAmount" INTEGER,
    "cancelStaffHandling" "CancelStaffHandling" NOT NULL DEFAULT 'HOLD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCancelRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientCancelRule_companyRelationshipId_idx" ON "ClientCancelRule"("companyRelationshipId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCancelRule_companyId_companyRelationshipId_key" ON "ClientCancelRule"("companyId", "companyRelationshipId");

-- AddForeignKey
ALTER TABLE "ClientCancelRule" ADD CONSTRAINT "ClientCancelRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCancelRule" ADD CONSTRAINT "ClientCancelRule_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 既存の「依頼主×業務内容ごと」の規定を「依頼主共通＋業務内容ごとの例外」に移す。
-- 依頼主ごとに、規定を設定済み（既定値のままでない）業務内容のうち最初に登録された
-- ものを共通の規定にし、それと違う規定の業務内容だけを例外として残す。
INSERT INTO "ClientCancelRule" ("id", "companyId", "companyRelationshipId", "cancelPolicy", "cancelDeadlineDaysBefore", "cancelDeadlineTime", "cancelFeeAmount", "cancelStaffHandling", "updatedAt")
SELECT DISTINCT ON (r."companyId", r."companyRelationshipId")
  'ccr_' || r."id", r."companyId", r."companyRelationshipId", r."cancelPolicy", r."cancelDeadlineDaysBefore", r."cancelDeadlineTime", r."cancelFeeAmount", r."cancelStaffHandling", CURRENT_TIMESTAMP
FROM "CompanyPlacementRate" r
WHERE r."companyRelationshipId" IS NOT NULL
  AND NOT (r."cancelPolicy" = 'FREE' AND r."cancelDeadlineDaysBefore" IS NULL AND r."cancelFeeAmount" IS NULL AND r."cancelStaffHandling" = 'HOLD')
ORDER BY r."companyId", r."companyRelationshipId", r."createdAt";

UPDATE "CompanyPlacementRate" r
SET "cancelRuleOverride" = true
FROM "ClientCancelRule" c
WHERE c."companyId" = r."companyId"
  AND c."companyRelationshipId" = r."companyRelationshipId"
  AND NOT (r."cancelPolicy" = 'FREE' AND r."cancelDeadlineDaysBefore" IS NULL AND r."cancelFeeAmount" IS NULL AND r."cancelStaffHandling" = 'HOLD')
  AND (r."cancelPolicy", r."cancelDeadlineDaysBefore", r."cancelDeadlineTime", r."cancelFeeAmount", r."cancelStaffHandling")
      IS DISTINCT FROM (c."cancelPolicy", c."cancelDeadlineDaysBefore", c."cancelDeadlineTime", c."cancelFeeAmount", c."cancelStaffHandling");
