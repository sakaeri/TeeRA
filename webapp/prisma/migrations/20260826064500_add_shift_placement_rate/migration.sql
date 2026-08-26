-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "companyPlacementRateId" TEXT;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyPlacementRateId_fkey" FOREIGN KEY ("companyPlacementRateId") REFERENCES "CompanyPlacementRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Invoice_issuingCompanyId_companyRelationshipId_periodLabe_key" RENAME TO "Invoice_issuingCompanyId_companyRelationshipId_periodLabel_key";
