-- 未使用の列挙値・カラムを削除する。
-- ローカル開発DBでは該当データが無いことを確認済みだったが、本番DBには
-- 確認できない実データがあり得るため、型変更の前に念のため該当行を安全な
-- 値へ寄せてから列挙値を削除する（型変更のUSING句は変換先に無い値が1件
-- でもあると失敗し、マイグレーション全体がロールバックされてしまうため）。
-- ・TodoKind: AUTO_*系（自動タスクは毎回その場で計算されDB保存されない）
-- ・TodoItem.relatedEntityType/relatedEntityId: 常にNULL、参照コード無し
-- ・RecruitmentStatus: DRAFT（求人は作成と同時に即PUBLISHEDになる仕様で、
--   下書き保存フローは実装されていない）
-- ・SalarySlipStatus.FINALIZED / InvoiceStatus.CONFIRMED: 「確定する」中間
--   状態の廃止済み残骸（既存データは20260909052244でDRAFTへ移行済みの
--   はずだが、念のため再度寄せておく）

-- TodoItem.kind: TodoKindからAUTO_*を削除
UPDATE "TodoItem" SET kind = 'MANUAL' WHERE kind::text <> 'MANUAL';
ALTER TYPE "TodoKind" RENAME TO "TodoKind_old";
CREATE TYPE "TodoKind" AS ENUM ('MANUAL');
ALTER TABLE "TodoItem" ALTER COLUMN "kind" TYPE "TodoKind" USING ("kind"::text::"TodoKind");
DROP TYPE "TodoKind_old";

-- TodoItem: 未使用カラムを削除
ALTER TABLE "TodoItem" DROP COLUMN "relatedEntityType";
ALTER TABLE "TodoItem" DROP COLUMN "relatedEntityId";

-- PublicRecruitment.status: RecruitmentStatusからDRAFTを削除
UPDATE "PublicRecruitment" SET status = 'PUBLISHED' WHERE status::text = 'DRAFT';
ALTER TABLE "PublicRecruitment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "RecruitmentStatus" RENAME TO "RecruitmentStatus_old";
CREATE TYPE "RecruitmentStatus" AS ENUM ('PUBLISHED', 'STOPPED', 'DELETED');
ALTER TABLE "PublicRecruitment" ALTER COLUMN "status" TYPE "RecruitmentStatus" USING ("status"::text::"RecruitmentStatus");
ALTER TABLE "PublicRecruitment" ALTER COLUMN "status" SET DEFAULT 'PUBLISHED'::"RecruitmentStatus";
DROP TYPE "RecruitmentStatus_old";

-- SalarySlip.status: SalarySlipStatusからFINALIZEDを削除
UPDATE "SalarySlip" SET status = 'DRAFT' WHERE status::text = 'FINALIZED';
ALTER TABLE "SalarySlip" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "SalarySlipStatus" RENAME TO "SalarySlipStatus_old";
CREATE TYPE "SalarySlipStatus" AS ENUM ('DRAFT', 'ISSUED');
ALTER TABLE "SalarySlip" ALTER COLUMN "status" TYPE "SalarySlipStatus" USING ("status"::text::"SalarySlipStatus");
ALTER TABLE "SalarySlip" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"SalarySlipStatus";
DROP TYPE "SalarySlipStatus_old";

-- Invoice.status: InvoiceStatusからCONFIRMEDを削除
UPDATE "Invoice" SET status = 'DRAFT' WHERE status::text = 'CONFIRMED';
ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED');
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus" USING ("status"::text::"InvoiceStatus");
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"InvoiceStatus";
DROP TYPE "InvoiceStatus_old";
