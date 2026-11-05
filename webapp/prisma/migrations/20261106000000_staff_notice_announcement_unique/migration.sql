-- 会社からのお知らせは、1人のスタッフに1件だけ（あとから入った人へ過去のお知らせを足すときの二重登録を防ぐ）
DELETE FROM "StaffNotice" a
USING "StaffNotice" b
WHERE a."companyAnnouncementId" IS NOT NULL
  AND a."companyAnnouncementId" = b."companyAnnouncementId"
  AND a."staffUserId" = b."staffUserId"
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS "StaffNotice_staffUserId_companyAnnouncementId_key" ON "StaffNotice"("staffUserId", "companyAnnouncementId");
