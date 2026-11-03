-- 請求書の振込先を会社で複数登録できるようにする
CREATE TABLE IF NOT EXISTS "CompanyBankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT,
    "accountType" TEXT,
    "accountNumber" TEXT NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyBankAccount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CompanyBankAccount_companyId_idx" ON "CompanyBankAccount"("companyId");
DO $$ BEGIN
  ALTER TABLE "CompanyBankAccount" ADD CONSTRAINT "CompanyBankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 会社設定に入っていた「請求書の振込先（デフォルト）」を、最初の1件として登録する
INSERT INTO "CompanyBankAccount" ("id", "companyId", "bankName", "branchName", "accountType", "accountNumber", "accountHolderName", "createdAt")
SELECT gen_random_uuid()::text, c."id", COALESCE(c."bankName", ''), c."branchName", c."accountType", COALESCE(c."accountNumber", ''), COALESCE(c."accountHolderName", ''), CURRENT_TIMESTAMP
FROM "Company" c
WHERE (NULLIF(TRIM(c."bankName"), '') IS NOT NULL OR NULLIF(TRIM(c."accountNumber"), '') IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "CompanyBankAccount" b WHERE b."companyId" = c."id");
