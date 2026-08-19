-- CreateIndex
CREATE UNIQUE INDEX "Invoice_issuingCompanyId_companyRelationshipId_periodLabe_key" ON "Invoice"("issuingCompanyId", "companyRelationshipId", "periodLabel");
