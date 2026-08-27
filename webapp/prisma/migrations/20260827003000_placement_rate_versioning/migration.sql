-- CreateTable
CREATE TABLE "CompanyPlacementRateVersion" (
    "id" TEXT NOT NULL,
    "placementRateId" TEXT NOT NULL,
    "wageType" "WageType",
    "amount" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyPlacementRateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTaskRateVersion" (
    "id" TEXT NOT NULL,
    "staffTaskRateId" TEXT NOT NULL,
    "wageType" "WageType",
    "amount" INTEGER,
    "effectiveFrom" DATE NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTaskRateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyPlacementRateVersion_placementRateId_effectiveFrom_idx" ON "CompanyPlacementRateVersion"("placementRateId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "StaffTaskRateVersion_staffTaskRateId_effectiveFrom_idx" ON "StaffTaskRateVersion"("staffTaskRateId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "CompanyPlacementRateVersion" ADD CONSTRAINT "CompanyPlacementRateVersion_placementRateId_fkey" FOREIGN KEY ("placementRateId") REFERENCES "CompanyPlacementRate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPlacementRateVersion" ADD CONSTRAINT "CompanyPlacementRateVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTaskRateVersion" ADD CONSTRAINT "StaffTaskRateVersion_staffTaskRateId_fkey" FOREIGN KEY ("staffTaskRateId") REFERENCES "StaffTaskRate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTaskRateVersion" ADD CONSTRAINT "StaffTaskRateVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: turn each existing single-row rate into its first dated version,
-- using the row's own createdAt as the best-available effective date (we
-- have no earlier record of when that price actually started applying).
INSERT INTO "CompanyPlacementRateVersion" ("id", "placementRateId", "wageType", "amount", "effectiveFrom", "createdAt")
SELECT gen_random_uuid()::text, "id", "wageType", "amount", "createdAt"::date, "createdAt"
FROM "CompanyPlacementRate"
WHERE "wageType" IS NOT NULL AND "amount" IS NOT NULL;

INSERT INTO "StaffTaskRateVersion" ("id", "staffTaskRateId", "wageType", "amount", "effectiveFrom", "createdAt")
SELECT gen_random_uuid()::text, "id", "wageType", "amount", "createdAt"::date, "createdAt"
FROM "StaffTaskRate";

-- AlterTable
ALTER TABLE "CompanyPlacementRate" DROP COLUMN "amount",
DROP COLUMN "updatedAt",
DROP COLUMN "wageType";

-- AlterTable
ALTER TABLE "StaffTaskRate" DROP COLUMN "amount",
DROP COLUMN "updatedAt",
DROP COLUMN "wageType";

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPlacementRate_companyId_companyRelationshipId_taskNa_key" ON "CompanyPlacementRate"("companyId", "companyRelationshipId", "taskName");
