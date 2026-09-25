-- 未使用の列挙値・カラムを削除する（実データ上は使われていないことを
-- 事前に確認済み）。
-- ・TodoKind: AUTO_*系（自動タスクは毎回その場で計算されDB保存されない）
-- ・TodoItem.relatedEntityType/relatedEntityId: 常にNULL、参照コード無し
-- ・RecruitmentStatus: DRAFT（求人は作成と同時に即PUBLISHEDになる仕様で、
--   下書き保存フローは実装されていない）
-- ・SalarySlipStatus.FINALIZED / InvoiceStatus.CONFIRMED: 「確定する」中間
--   状態の廃止済み残骸（既存データは20260909052244でDRAFTへ移行済み）

-- TodoItem.kind: TodoKindからAUTO_*を削除
ALTER TYPE "TodoKind" RENAME TO "TodoKind_old";
CREATE TYPE "TodoKind" AS ENUM ('MANUAL');
ALTER TABLE "TodoItem" ALTER COLUMN "kind" TYPE "TodoKind" USING ("kind"::text::"TodoKind");
DROP TYPE "TodoKind_old";

-- TodoItem: 未使用カラムを削除
ALTER TABLE "TodoItem" DROP COLUMN "relatedEntityType";
ALTER TABLE "TodoItem" DROP COLUMN "relatedEntityId";

-- PublicRecruitment.status: RecruitmentStatusからDRAFTを削除
ALTER TABLE "PublicRecruitment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "RecruitmentStatus" RENAME TO "RecruitmentStatus_old";
CREATE TYPE "RecruitmentStatus" AS ENUM ('PUBLISHED', 'STOPPED', 'DELETED');
ALTER TABLE "PublicRecruitment" ALTER COLUMN "status" TYPE "RecruitmentStatus" USING ("status"::text::"RecruitmentStatus");
ALTER TABLE "PublicRecruitment" ALTER COLUMN "status" SET DEFAULT 'PUBLISHED'::"RecruitmentStatus";
DROP TYPE "RecruitmentStatus_old";

-- SalarySlip.status: SalarySlipStatusからFINALIZEDを削除
ALTER TABLE "SalarySlip" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "SalarySlipStatus" RENAME TO "SalarySlipStatus_old";
CREATE TYPE "SalarySlipStatus" AS ENUM ('DRAFT', 'ISSUED');
ALTER TABLE "SalarySlip" ALTER COLUMN "status" TYPE "SalarySlipStatus" USING ("status"::text::"SalarySlipStatus");
ALTER TABLE "SalarySlip" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"SalarySlipStatus";
DROP TYPE "SalarySlipStatus_old";

-- Invoice.status: InvoiceStatusからCONFIRMEDを削除
ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED');
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus" USING ("status"::text::"InvoiceStatus");
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"InvoiceStatus";
DROP TYPE "InvoiceStatus_old";
