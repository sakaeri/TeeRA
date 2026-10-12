-- 本部編集者(COMPANY_EDITOR)は本部管理者(COMPANY_ADMIN)と全く同じ権限のため、
-- 選択肢として廃止し、既存メンバーも管理者に統一する。
UPDATE "CompanyMembership" SET role = 'COMPANY_ADMIN' WHERE role = 'COMPANY_EDITOR';
