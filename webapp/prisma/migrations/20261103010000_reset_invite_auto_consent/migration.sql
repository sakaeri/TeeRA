-- 契約書テンプレートを付けた招待から参加すると、本人が同意していないのに
-- 契約書が「契約中・同意済み」で作られていた。その契約書を確認待ちに戻し、
-- 本人に書類の提出と同意をやり直してもらう。
-- 対象は、招待で作られた契約書（招待の使用者とテンプレートが一致）のうち、
-- 本人の同意の記録（氏名・同意のハッシュ）も、署名済み書面のアップロードも無いものだけ。
UPDATE "StaffContract" AS sc
SET "status" = 'PENDING_CONSENT',
    "consentedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "InviteToken" AS it
WHERE it."usedByUserId" = sc."staffUserId"
  AND it."contractTemplateId" = sc."templateId"
  AND sc."status" = 'ACTIVE'
  AND sc."partyName" IS NULL
  AND sc."consentHash" IS NULL
  AND sc."uploadedDocumentUrl" IS NULL;
