-- CreateTable
CREATE TABLE "IdDocumentUploadHistory" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdDocumentUploadHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdDocumentUploadHistory_membershipId_createdAt_idx" ON "IdDocumentUploadHistory"("membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "IdDocumentUploadHistory" ADD CONSTRAINT "IdDocumentUploadHistory_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "CompanyMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IdDocumentUploadHistory" ENABLE ROW LEVEL SECURITY;
