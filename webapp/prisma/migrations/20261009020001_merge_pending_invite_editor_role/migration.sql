-- 未使用(未redeem)の招待リンクに残っているtargetRole=COMPANY_EDITORも、
-- 本部編集者の選択肢廃止に合わせてCOMPANY_ADMINへ統一する。
UPDATE "InviteToken" SET "targetRole" = 'COMPANY_ADMIN' WHERE "targetRole" = 'COMPANY_EDITOR';
