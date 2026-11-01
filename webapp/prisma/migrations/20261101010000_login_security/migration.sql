-- AlterEnum
ALTER TYPE "AccountActionTokenKind" ADD VALUE 'LOGIN_PASSWORD_STEP';
ALTER TYPE "AccountActionTokenKind" ADD VALUE 'PASSWORD_RESET_CANCEL';

-- AlterTable
ALTER TABLE "AccountActionToken" ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failedPasswordAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "passwordLockedUntil" TIMESTAMP(3),
ADD COLUMN "pendingPasswordHash" TEXT,
ADD COLUMN "pendingPasswordEffectiveAt" TIMESTAMP(3);
