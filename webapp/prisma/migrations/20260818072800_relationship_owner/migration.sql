/*
  Warnings:

  - Added the required column `ownerCompanyId` to the `CompanyRelationship` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "CompanyRelationship" DROP CONSTRAINT "CompanyRelationship_agencyCompanyId_fkey";

-- AlterTable
ALTER TABLE "CompanyRelationship" ADD COLUMN     "ownerCompanyId" TEXT NOT NULL,
ALTER COLUMN "agencyCompanyId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CompanyRelationship_ownerCompanyId_idx" ON "CompanyRelationship"("ownerCompanyId");

-- AddForeignKey
ALTER TABLE "CompanyRelationship" ADD CONSTRAINT "CompanyRelationship_ownerCompanyId_fkey" FOREIGN KEY ("ownerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRelationship" ADD CONSTRAINT "CompanyRelationship_agencyCompanyId_fkey" FOREIGN KEY ("agencyCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
