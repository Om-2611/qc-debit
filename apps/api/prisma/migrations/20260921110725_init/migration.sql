-- CreateEnum
CREATE TYPE "Role" AS ENUM ('GATE', 'QC_ANALYST', 'QC_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'WEIGHTS_ENTERED', 'QC_ENTERED', 'PENDING_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "ReportSource" AS ENUM ('MANUAL', 'IMPORTED');

-- CreateEnum
CREATE TYPE "ParameterCategory" AS ENUM ('DISCRETIONARY', 'NON_DISCRETIONARY');

-- CreateEnum
CREATE TYPE "InputMode" AS ENUM ('KG_PER_BALE', 'PERCENT_PER_BALE');

-- CreateEnum
CREATE TYPE "RateMode" AS ENUM ('DOMINANT_MATERIAL_RATE', 'DOMINANT_MATERIAL_RATE_MINUS_20', 'FIXED');

-- CreateEnum
CREATE TYPE "WeightBase" AS ENUM ('TOTAL_DALMIA_WEIGHT', 'CLEAR_WEIGHT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parameter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ParameterCategory" NOT NULL,
    "inputMode" "InputMode" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDeductible" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormRule" (
    "id" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "seasonStartMonth" INTEGER NOT NULL,
    "seasonEndMonth" INTEGER NOT NULL,
    "normPercent" DECIMAL(8,4) NOT NULL,
    "effectiveFrom" DATE NOT NULL,

    CONSTRAINT "NormRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateRule" (
    "id" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "rateMode" "RateMode" NOT NULL,
    "fixedRate" DECIMAL(12,4),
    "weightBase" "WeightBase" NOT NULL,
    "effectiveFrom" DATE NOT NULL,

    CONSTRAINT "RateRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reportNo" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "ReportSource" NOT NULL DEFAULT 'MANUAL',
    "reportDate" DATE NOT NULL,
    "supplierId" TEXT,
    "partyNameRaw" TEXT,
    "poNumber" TEXT,
    "truckNumber" TEXT,
    "grnNumber" TEXT,
    "tokenDate" DATE,
    "tokenNumber" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATE,
    "weightTolerancePercent" DECIMAL(8,4),
    "remarks" TEXT,
    "sentBackNote" TEXT,
    "reopenReason" TEXT,
    "checkedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "checkedByName" TEXT,
    "approvedByName" TEXT,
    "standardTotal" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "approvedTotal" DECIMAL(16,4) NOT NULL DEFAULT 0,
    "narration" TEXT,
    "importBatchId" TEXT,
    "importSheetName" TEXT,
    "recomputedTotal" DECIMAL(16,4),
    "hasMismatch" BOOLEAN NOT NULL DEFAULT false,
    "mismatchDetail" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportMaterialLine" (
    "reportId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "invoiceWeightKg" DECIMAL(14,4),
    "invoiceBales" DECIMAL(10,2),
    "invoiceRate" DECIMAL(12,4),
    "dalmiaWeightKg" DECIMAL(14,4),
    "dalmiaBales" DECIMAL(10,2),
    "dalmiaRate" DECIMAL(12,4),

    CONSTRAINT "ReportMaterialLine_pkey" PRIMARY KEY ("reportId","materialId")
);

-- CreateTable
CREATE TABLE "ReportBale" (
    "reportId" TEXT NOT NULL,
    "baleIndex" INTEGER NOT NULL,
    "baleWeightKg" DECIMAL(12,4),

    CONSTRAINT "ReportBale_pkey" PRIMARY KEY ("reportId","baleIndex")
);

-- CreateTable
CREATE TABLE "QcReading" (
    "reportId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "baleIndex" INTEGER NOT NULL,
    "value" DECIMAL(12,4),

    CONSTRAINT "QcReading_pkey" PRIMARY KEY ("reportId","parameterId","baleIndex")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "reportId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "normPercent" DECIMAL(8,4) NOT NULL,
    "totalKg" DECIMAL(12,4),
    "actualPercent" DECIMAL(10,4) NOT NULL,
    "purchaseAdjustment" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,4) NOT NULL,
    "weightBase" "WeightBase" NOT NULL,
    "isDeductible" BOOLEAN NOT NULL DEFAULT true,
    "standardQty" DECIMAL(14,4) NOT NULL,
    "standardAmount" DECIMAL(16,4) NOT NULL,
    "approvedQty" DECIMAL(14,4) NOT NULL,
    "approvedAmount" DECIMAL(16,4) NOT NULL,
    "differenceQty" DECIMAL(14,4) NOT NULL,
    "differenceAmount" DECIMAL(16,4) NOT NULL,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("reportId","parameterId")
);

-- CreateTable
CREATE TABLE "ShortageLine" (
    "reportId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "shortageQty" DECIMAL(14,4) NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "standardAmount" DECIMAL(16,4) NOT NULL,
    "approvedQty" DECIMAL(14,4) NOT NULL,
    "approvedAmount" DECIMAL(16,4) NOT NULL,
    "adjustment" DECIMAL(14,4),
    "otherDescription" TEXT,

    CONSTRAINT "ShortageLine_pkey" PRIMARY KEY ("reportId","materialId")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sheetCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "reportId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Material_name_key" ON "Material"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Parameter_code_key" ON "Parameter"("code");

-- CreateIndex
CREATE INDEX "NormRule_parameterId_idx" ON "NormRule"("parameterId");

-- CreateIndex
CREATE INDEX "RateRule_parameterId_idx" ON "RateRule"("parameterId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reportNo_key" ON "Report"("reportNo");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_supplierId_idx" ON "Report"("supplierId");

-- CreateIndex
CREATE INDEX "Report_reportDate_idx" ON "Report"("reportDate");

-- CreateIndex
CREATE INDEX "Report_grnNumber_idx" ON "Report"("grnNumber");

-- CreateIndex
CREATE INDEX "Report_truckNumber_invoiceNumber_idx" ON "Report"("truckNumber", "invoiceNumber");

-- CreateIndex
CREATE INDEX "Report_importBatchId_idx" ON "Report"("importBatchId");

-- CreateIndex
CREATE INDEX "AuditLog_reportId_at_idx" ON "AuditLog"("reportId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "AuditLog"("userId", "at");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormRule" ADD CONSTRAINT "NormRule_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "Parameter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateRule" ADD CONSTRAINT "RateRule_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "Parameter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMaterialLine" ADD CONSTRAINT "ReportMaterialLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportMaterialLine" ADD CONSTRAINT "ReportMaterialLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportBale" ADD CONSTRAINT "ReportBale_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcReading" ADD CONSTRAINT "QcReading_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcReading" ADD CONSTRAINT "QcReading_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "Parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "Parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortageLine" ADD CONSTRAINT "ShortageLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortageLine" ADD CONSTRAINT "ShortageLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
