-- お知らせの宛先（全スタッフ／自社スタッフのみ／チーム／個別）、編集日時、添付
ALTER TABLE "CompanyAnnouncement" ADD COLUMN IF NOT EXISTS "audience" TEXT NOT NULL DEFAULT 'ALL';
ALTER TABLE "CompanyAnnouncement" ADD COLUMN IF NOT EXISTS "teamIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyAnnouncement" ADD COLUMN IF NOT EXISTS "staffUserIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CompanyAnnouncement" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);

ALTER TABLE "NoteAttachment" ADD COLUMN IF NOT EXISTS "companyAnnouncementId" TEXT;
CREATE INDEX IF NOT EXISTS "NoteAttachment_companyAnnouncementId_idx" ON "NoteAttachment"("companyAnnouncementId");
DO $$ BEGIN
  ALTER TABLE "NoteAttachment" ADD CONSTRAINT "NoteAttachment_companyAnnouncementId_fkey" FOREIGN KEY ("companyAnnouncementId") REFERENCES "CompanyAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
