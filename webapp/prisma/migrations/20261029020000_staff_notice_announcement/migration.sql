-- 募集の「追加のお知らせ」から作ったスタッフのお知らせを、元のお知らせと結び付ける
-- （お知らせを削除したら、スタッフのお知らせ欄からも消す）
ALTER TABLE "StaffNotice" ADD COLUMN "recruitmentAnnouncementId" TEXT;

CREATE INDEX "StaffNotice_recruitmentAnnouncementId_idx" ON "StaffNotice"("recruitmentAnnouncementId");

ALTER TABLE "StaffNotice" ADD CONSTRAINT "StaffNotice_recruitmentAnnouncementId_fkey" FOREIGN KEY ("recruitmentAnnouncementId") REFERENCES "RecruitmentAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
