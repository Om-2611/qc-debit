-- CreateEnum
CREATE TYPE "IonPushStatus" AS ENUM ('QUEUED', 'RUNNING', 'DRAFT_CREATED', 'SUBMITTED', 'FAILED', 'FAILED_RETRYABLE', 'CHECK_MANUALLY', 'DRY_RUN_OK');

-- CreateEnum
CREATE TYPE "IonRunMode" AS ENUM ('DRY_RUN', 'DRAFT_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "IonEnvironment" AS ENUM ('TRAINING', 'LIVE');

-- CreateTable
CREATE TABLE "IonPush" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" "IonPushStatus" NOT NULL DEFAULT 'QUEUED',
    "env" "IonEnvironment" NOT NULL,
    "runMode" "IonRunMode" NOT NULL,
    "payload" JSONB NOT NULL,
    "itemCodeOverride" TEXT,
    "mismatchConfirmedById" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "autoRetriesLeft" INTEGER NOT NULL DEFAULT 0,
    "ionDnNo" TEXT,
    "ionStatus" TEXT,
    "checkpoint" TEXT,
    "draftClickedAt" TIMESTAMP(3),
    "submitClickedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorStep" TEXT,
    "lastErrorKind" TEXT,
    "lockedBy" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "resetAt" TIMESTAMP(3),
    "resetById" TEXT,
    "resetNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IonPush_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IonPushStep" (
    "id" TEXT NOT NULL,
    "pushId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "message" TEXT,
    "screenshotId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IonPushStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IonScreenshot" (
    "id" TEXT NOT NULL,
    "pushId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IonScreenshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IonPush_reportId_idx" ON "IonPush"("reportId");

-- CreateIndex
CREATE INDEX "IonPush_status_env_idx" ON "IonPush"("status", "env");

-- CreateIndex
CREATE UNIQUE INDEX "IonPushStep_pushId_seq_key" ON "IonPushStep"("pushId", "seq");

-- CreateIndex
CREATE INDEX "IonScreenshot_pushId_idx" ON "IonScreenshot"("pushId");

-- AddForeignKey
ALTER TABLE "IonPush" ADD CONSTRAINT "IonPush_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IonPush" ADD CONSTRAINT "IonPush_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IonPushStep" ADD CONSTRAINT "IonPushStep_pushId_fkey" FOREIGN KEY ("pushId") REFERENCES "IonPush"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IonScreenshot" ADD CONSTRAINT "IonScreenshot_pushId_fkey" FOREIGN KEY ("pushId") REFERENCES "IonPush"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one live iON push per report: not reset, and not a dry run (dry runs save nothing in iON).
CREATE UNIQUE INDEX "IonPush_one_binding_per_report" ON "IonPush"("reportId") WHERE "resetAt" IS NULL AND "runMode" <> 'DRY_RUN';
