-- AlterTable
ALTER TABLE "InviteToken" ADD COLUMN     "upgradeProxyUserId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isProxy" BOOLEAN NOT NULL DEFAULT false;
