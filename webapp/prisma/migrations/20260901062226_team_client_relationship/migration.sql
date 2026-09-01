-- CreateTable
CREATE TABLE "TeamClientRelationship" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "companyRelationshipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamClientRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamClientRelationship_companyRelationshipId_idx" ON "TeamClientRelationship"("companyRelationshipId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamClientRelationship_teamId_companyRelationshipId_key" ON "TeamClientRelationship"("teamId", "companyRelationshipId");

-- AddForeignKey
ALTER TABLE "TeamClientRelationship" ADD CONSTRAINT "TeamClientRelationship_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamClientRelationship" ADD CONSTRAINT "TeamClientRelationship_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
