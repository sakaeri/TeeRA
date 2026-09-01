/*
  Warnings:

  - You are about to drop the column `note` on the `CompanyRelationship` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CompanyRelationship" DROP COLUMN "note";

-- CreateTable
CREATE TABLE "RelationshipNote" (
    "id" TEXT NOT NULL,
    "companyRelationshipId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RelationshipNote_companyRelationshipId_idx" ON "RelationshipNote"("companyRelationshipId");

-- AddForeignKey
ALTER TABLE "RelationshipNote" ADD CONSTRAINT "RelationshipNote_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipNote" ADD CONSTRAINT "RelationshipNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
