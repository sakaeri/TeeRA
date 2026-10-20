-- AlterTable
ALTER TABLE "StaffContract" ADD COLUMN     "consentCopySentAt" TIMESTAMP(3),
ADD COLUMN     "consentEmail" TEXT,
ADD COLUMN     "consentEmailVerified" BOOLEAN,
ADD COLUMN     "consentHash" TEXT,
ADD COLUMN     "consentIp" TEXT,
ADD COLUMN     "consentSnapshot" JSONB,
ADD COLUMN     "consentUserAgent" TEXT;

