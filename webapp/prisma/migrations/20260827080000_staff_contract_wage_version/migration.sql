-- CreateTable
CREATE TABLE "StaffContractWageVersion" (
    "id" TEXT NOT NULL,
    "staffContractId" TEXT NOT NULL,
    "wageAmount" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffContractWageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffContractWageVersion_staffContractId_idx" ON "StaffContractWageVersion"("staffContractId");

-- AddForeignKey
ALTER TABLE "StaffContractWageVersion" ADD CONSTRAINT "StaffContractWageVersion_staffContractId_fkey" FOREIGN KEY ("staffContractId") REFERENCES "StaffContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing StaffContract its initial wage version, using
-- the consent-time snapshot as the amount and contractStartDate (falling back
-- to createdAt's date) as the effective-from date.
INSERT INTO "StaffContractWageVersion" ("id", "staffContractId", "wageAmount", "effectiveFrom", "createdAt")
SELECT gen_random_uuid()::text, "id", "wageAmountSnapshot", COALESCE("contractStartDate", "createdAt"::date), "createdAt"
FROM "StaffContract";
