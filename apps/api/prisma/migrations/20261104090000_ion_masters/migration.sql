-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "gstRegistered" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ionAddressCode" TEXT,
ADD COLUMN     "ionStateCode" TEXT,
ADD COLUMN     "ionSupplierCode" TEXT;

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "ionItemCode" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "plantId" TEXT;

-- CreateTable
CREATE TABLE "Plant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ionSiteCode" TEXT NOT NULL,
    "ionSiteAddressLabel" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plant_code_key" ON "Plant"("code");

-- CreateIndex
CREATE INDEX "Report_plantId_idx" ON "Report"("plantId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "Plant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: DPNL is the only plant so far; every existing report belongs to it.
INSERT INTO "Plant" ("id", "code", "name", "ionSiteCode", "ionSiteAddressLabel", "stateCode")
VALUES ('plant_dpnl', 'DPNL', 'Dalmia Polypro (DPNL)', 'DPNL', 'DPNL (Bill to Address)', '27');

UPDATE "Report" SET "plantId" = 'plant_dpnl' WHERE "plantId" IS NULL;
