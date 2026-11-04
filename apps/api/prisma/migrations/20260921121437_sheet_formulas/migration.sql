-- AlterEnum
ALTER TYPE "RateMode" ADD VALUE 'CLEAR_RATE_MINUS_20';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WeightBase" ADD VALUE 'AFFECTED_BALES_TRUCK_AVG';
ALTER TYPE "WeightBase" ADD VALUE 'AFFECTED_BALES_SAMPLE_AVG';

-- AlterTable
ALTER TABLE "Deduction" ADD COLUMN     "affectedBales" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "RateRule" ADD COLUMN     "maxActualPercent" DECIMAL(8,4);
