-- Split PublicRecruitment into two visibility tiers: ORDER (自社+配属済み
-- 派遣スタッフのみ、無料) and PUBLIC (TeeRA全体に公開、有料・掲載時にTeeを
-- ロック). Existing rows are all currently-published-as-public postings, so
-- they backfill to PUBLIC with publicOpenedAt = publishedAt to preserve
-- today's behavior for anything already live.
CREATE TYPE "RecruitmentVisibility" AS ENUM ('ORDER', 'PUBLIC');

ALTER TABLE "PublicRecruitment"
  ADD COLUMN "wageType" "WageType",
  ADD COLUMN "applicationConditions" TEXT,
  ADD COLUMN "belongings" TEXT,
  ADD COLUMN "meetingPlace" TEXT,
  ADD COLUMN "visibility" "RecruitmentVisibility" NOT NULL DEFAULT 'ORDER',
  ADD COLUMN "publicOpenedAt" TIMESTAMP(3);

UPDATE "PublicRecruitment" SET "visibility" = 'PUBLIC', "publicOpenedAt" = "publishedAt";

-- 配属記録 — 契約(StaffContract)とは無関係の軽量な事実の記録。
CREATE TABLE "StaffPlacement" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "companyRelationshipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPlacement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffPlacement_staffUserId_companyRelationshipId_key" ON "StaffPlacement"("staffUserId", "companyRelationshipId");
CREATE INDEX "StaffPlacement_companyRelationshipId_idx" ON "StaffPlacement"("companyRelationshipId");

ALTER TABLE "StaffPlacement" ADD CONSTRAINT "StaffPlacement_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffPlacement" ADD CONSTRAINT "StaffPlacement_companyRelationshipId_fkey" FOREIGN KEY ("companyRelationshipId") REFERENCES "CompanyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
