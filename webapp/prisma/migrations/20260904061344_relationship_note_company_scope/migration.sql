-- DropIndex
DROP INDEX "RelationshipNote_companyRelationshipId_idx";

-- AlterTable: add nullable first, backfill, then enforce NOT NULL
ALTER TABLE "RelationshipNote" ADD COLUMN     "companyId" TEXT;

-- Backfill: 既存メモは（双方向可視化前は実質オーナーしか見えなかったので）
-- そのCompanyRelationshipのownerCompanyIdのメモとして扱う。
UPDATE "RelationshipNote" rn
SET "companyId" = cr."ownerCompanyId"
FROM "CompanyRelationship" cr
WHERE rn."companyRelationshipId" = cr.id;

ALTER TABLE "RelationshipNote" ALTER COLUMN "companyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "RelationshipNote_companyRelationshipId_companyId_idx" ON "RelationshipNote"("companyRelationshipId", "companyId");

-- AddForeignKey
ALTER TABLE "RelationshipNote" ADD CONSTRAINT "RelationshipNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
