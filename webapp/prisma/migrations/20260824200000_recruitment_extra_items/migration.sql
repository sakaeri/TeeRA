-- Replace the four fixed PUBLIC-only detail columns (応募条件/服装/持ち物/
-- 集合場所) with a single ordered [{label, value}] JSON array, matching the
-- existing ContractTemplate.extraItems quick-add-chip pattern.
ALTER TABLE "PublicRecruitment" ADD COLUMN "extraItems" JSONB NOT NULL DEFAULT '[]';

UPDATE "PublicRecruitment"
SET "extraItems" = (
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('label', '応募条件', 'value', "applicationConditions") AS x
    WHERE "applicationConditions" IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('label', '服装', 'value', "attire")
    WHERE "attire" IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('label', '持ち物', 'value', "belongings")
    WHERE "belongings" IS NOT NULL
    UNION ALL
    SELECT jsonb_build_object('label', '集合場所', 'value', "meetingPlace")
    WHERE "meetingPlace" IS NOT NULL
  ) t
)
WHERE "applicationConditions" IS NOT NULL
   OR "attire" IS NOT NULL
   OR "belongings" IS NOT NULL
   OR "meetingPlace" IS NOT NULL;

ALTER TABLE "PublicRecruitment" DROP COLUMN "applicationConditions";
ALTER TABLE "PublicRecruitment" DROP COLUMN "attire";
ALTER TABLE "PublicRecruitment" DROP COLUMN "belongings";
ALTER TABLE "PublicRecruitment" DROP COLUMN "meetingPlace";
