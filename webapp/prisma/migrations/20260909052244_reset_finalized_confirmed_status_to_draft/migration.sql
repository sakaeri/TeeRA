-- 「確定する」（給与明細FINALIZED／請求書CONFIRMED）という中間状態を廃止し、
-- 「下書き（DRAFT）→PDF発行（ISSUED）」の2状態に単純化する。
-- スキーマのenum自体は互換性のため残すが、既存データがもし残っていた場合に
-- 備えて、念のため下書き（DRAFT、編集可能な状態）へ寄せておく。
UPDATE "SalarySlip" SET status = 'DRAFT' WHERE status = 'FINALIZED';
UPDATE "Invoice" SET status = 'DRAFT' WHERE status = 'CONFIRMED';
