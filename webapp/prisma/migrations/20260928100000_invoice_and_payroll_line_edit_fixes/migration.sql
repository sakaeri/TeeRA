-- AlterTable
ALTER TABLE "SalarySlip" ADD COLUMN     "excludedShiftIds" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "excludedShiftIds" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "isManuallyEdited" BOOLEAN NOT NULL DEFAULT false;
