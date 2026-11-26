-- 手当（帯同手当・チップなど）
ALTER TYPE "SalarySlipLineKind" ADD VALUE IF NOT EXISTS 'ALLOWANCE';

CREATE TABLE IF NOT EXISTS "Allowance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amountType" TEXT NOT NULL DEFAULT 'FIXED',
    "staffAmount" INTEGER,
    "billToClient" BOOLEAN NOT NULL DEFAULT false,
    "clientAmount" INTEGER,
    "staffCanReport" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Allowance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Allowance_companyId_idx" ON "Allowance"("companyId");

CREATE TABLE IF NOT EXISTS "ShiftAllowance" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "allowanceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "clientAmount" INTEGER,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftAllowance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftAllowance_shiftId_allowanceId_key" ON "ShiftAllowance"("shiftId", "allowanceId");

DO $$ BEGIN
  ALTER TABLE "Allowance" ADD CONSTRAINT "Allowance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ShiftAllowance" ADD CONSTRAINT "ShiftAllowance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ShiftAllowance" ADD CONSTRAINT "ShiftAllowance_allowanceId_fkey" FOREIGN KEY ("allowanceId") REFERENCES "Allowance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
