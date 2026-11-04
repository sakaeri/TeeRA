-- 会社からスタッフへのお知らせ
CREATE TABLE IF NOT EXISTS "CompanyAnnouncement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "teamId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "includeAgencyStaff" BOOLEAN NOT NULL DEFAULT true,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "expiresOn" DATE,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanyAnnouncement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CompanyAnnouncement_companyId_createdAt_idx" ON "CompanyAnnouncement"("companyId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "CompanyAnnouncement" ADD CONSTRAINT "CompanyAnnouncement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "CompanyAnnouncement" ADD CONSTRAINT "CompanyAnnouncement_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "StaffNotice" ADD COLUMN IF NOT EXISTS "companyAnnouncementId" TEXT;
CREATE INDEX IF NOT EXISTS "StaffNotice_companyAnnouncementId_idx" ON "StaffNotice"("companyAnnouncementId");
DO $$ BEGIN
  ALTER TABLE "StaffNotice" ADD CONSTRAINT "StaffNotice_companyAnnouncementId_fkey" FOREIGN KEY ("companyAnnouncementId") REFERENCES "CompanyAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
