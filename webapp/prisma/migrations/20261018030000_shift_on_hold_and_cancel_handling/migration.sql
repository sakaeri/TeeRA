-- CreateEnum
CREATE TYPE "CancelStaffHandling" AS ENUM ('HOLD', 'RELEASE');

-- CreateEnum
CREATE TYPE "CancellationSource" AS ENUM ('CLIENT_APP', 'CLIENT_REPORTED');

-- AlterEnum
ALTER TYPE "ShiftStatus" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "CompanyPlacementRate" ADD COLUMN     "cancelStaffHandling" "CancelStaffHandling" NOT NULL DEFAULT 'HOLD';

-- AlterTable
ALTER TABLE "ShiftCancellation" ADD COLUMN     "source" "CancellationSource" NOT NULL DEFAULT 'CLIENT_APP';

