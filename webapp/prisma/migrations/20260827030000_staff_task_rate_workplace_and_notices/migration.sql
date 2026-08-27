-- DropIndex
DROP INDEX "StaffTaskRate_companyId_staffUserId_taskName_key";

-- AlterTable
ALTER TABLE "StaffTaskRate" ADD COLUMN     "companyRelationshipId" TEXT;

-- CreateTable
CREATE TABLE "StaffNotice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffNotice_staffUserId_readAt_idx" ON "StaffNotice"("staffUserId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "StaffTaskRate_companyId_staffUserId_taskName_companyRelatio_key" ON "StaffTaskRate"("companyId", "staffUserId", "taskName", "companyRelationshipId");

-- AddForeignKey
ALTER TABLE "StaffTaskRate" ADD CONSTRAINT "StaffTaskRate_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffNotice" ADD CONSTRAINT "StaffNotice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffNotice" ADD CONSTRAINT "StaffNotice_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

