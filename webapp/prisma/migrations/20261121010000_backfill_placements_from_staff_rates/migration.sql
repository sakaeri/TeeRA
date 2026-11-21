-- スタッフ詳細の単価に勤務先が入っているのに配属されていないスタッフを、その勤務先に配属する。
-- 配属の記録が既にあるもの（配属解除したものを含む）はそのまま。何度流しても同じ結果になる。
INSERT INTO "StaffPlacement" ("id", "staffUserId", "companyRelationshipId", "active", "createdAt")
SELECT gen_random_uuid()::text, r."staffUserId", r."companyRelationshipId", true, now()
FROM (
  SELECT DISTINCT "staffUserId", "companyRelationshipId"
  FROM "StaffTaskRate"
  WHERE "companyRelationshipId" IS NOT NULL
) r
WHERE NOT EXISTS (
  SELECT 1 FROM "StaffPlacement" p
  WHERE p."staffUserId" = r."staffUserId" AND p."companyRelationshipId" = r."companyRelationshipId"
)
ON CONFLICT ("staffUserId", "companyRelationshipId") DO NOTHING;
