-- 募集の「追加のお知らせ」
CREATE TABLE "RecruitmentAnnouncement" (
    "id" TEXT NOT NULL,
    "publicRecruitmentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentAnnouncement_publicRecruitmentId_createdAt_idx" ON "RecruitmentAnnouncement"("publicRecruitmentId", "createdAt");

ALTER TABLE "RecruitmentAnnouncement" ADD CONSTRAINT "RecruitmentAnnouncement_publicRecruitmentId_fkey" FOREIGN KEY ("publicRecruitmentId") REFERENCES "PublicRecruitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecruitmentAnnouncement" ADD CONSTRAINT "RecruitmentAnnouncement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 新しいテーブルにもRLSを有効にする（prisma/enable-rls.sqlと同じ方針）
ALTER TABLE "RecruitmentAnnouncement" ENABLE ROW LEVEL SECURITY;
