-- AlterTable
ALTER TABLE "CompanyMembership" ADD COLUMN "viaAgencyRelationshipId" TEXT;

-- CreateIndex
CREATE INDEX "CompanyMembership_viaAgencyRelationshipId_idx" ON "CompanyMembership"("viaAgencyRelationshipId");

-- AddForeignKey
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_viaAgencyRelationshipId_fkey" FOREIGN KEY ("viaAgencyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;
