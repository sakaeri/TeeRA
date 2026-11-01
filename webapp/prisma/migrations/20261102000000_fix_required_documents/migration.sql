-- 20261101030000_required_documents は、最初は Company に列を足す内容で、のちに
-- ContractTemplate に足す内容へ書き換えた。書き換え前の版がすでに当たっている
-- データベースでは、ContractTemplate の列が無いままになるため、ここで足し直す
-- （すでにあれば何もしない）。Company 側の使わなくなった列は消す。
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "requireIdDocument" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "requireBankInfo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Company" DROP COLUMN IF EXISTS "requireIdDocument";
ALTER TABLE "Company" DROP COLUMN IF EXISTS "requireBankInfo";
