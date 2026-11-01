-- AlterTable
ALTER TABLE "AccountActionToken" ADD COLUMN "codeHash" TEXT,
ADD COLUMN "codeAttempts" INTEGER NOT NULL DEFAULT 0;
