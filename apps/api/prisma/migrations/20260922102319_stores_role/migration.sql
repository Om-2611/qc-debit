-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STORES';

-- Analysts, store keepers and Stores do not see rates unless an admin switches it on for them.
-- (Postgres cannot use a new enum value in the same transaction that adds it, so the STORES row is
-- handled by the seed and the users API default instead.)
UPDATE "User" SET "canSeeRates" = false WHERE "role" IN ('QC_ANALYST', 'RM_STORE');
