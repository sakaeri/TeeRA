/*
  Warnings:

  - You are about to drop the column `note` on the `CompanyMembership` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CompanyMembership" DROP COLUMN "note";

-- CreateTable
CREATE TABLE "StaffNote" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffNote_membershipId_idx" ON "StaffNote"("membershipId");

-- AddForeignKey
ALTER TABLE "StaffNote" ADD CONSTRAINT "StaffNote_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffNote" ADD CONSTRAINT "StaffNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
