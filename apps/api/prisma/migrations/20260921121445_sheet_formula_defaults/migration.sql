-- Bring rules seeded before 2026-09-21 in line with the client's "Debit Note Format 1.xlsx".
-- Only rows still holding the old seeded defaults are touched; anything an admin has already changed is kept.
-- On a fresh database these statements match nothing (the seed now inserts the sheet's rules directly).
-- Approved reports are unaffected: they keep the snapshot taken at approval.

-- Sheet O36 / O37: =$E$20-20 (Clear rate, not the dominant material's rate)
UPDATE "RateRule" r
SET "rateMode" = 'CLEAR_RATE_MINUS_20'
FROM "Parameter" p
WHERE p.id = r."parameterId"
  AND p.code IN ('COLOUR_BOTTLE_PET', 'NON_PET')
  AND r."rateMode" = 'DOMINANT_MATERIAL_RATE_MINUS_20';

-- Sheet row 28: (L-D)% x No. of Bales x (M18/M19) x 10, amount charged only while actual % < 6
UPDATE "RateRule" r
SET "weightBase" = 'AFFECTED_BALES_TRUCK_AVG', "maxActualPercent" = 6
FROM "Parameter" p
WHERE p.id = r."parameterId"
  AND p.code = 'DIRTY_BOTTLE'
  AND r."weightBase" = 'TOTAL_DALMIA_WEIGHT';

-- Sheet row 30: (L-2)% x No. of Bales x AVERAGE(sample bale weights) x 5
UPDATE "RateRule" r
SET "weightBase" = 'AFFECTED_BALES_SAMPLE_AVG'
FROM "Parameter" p
WHERE p.id = r."parameterId"
  AND p.code = 'JAR_PET'
  AND r."weightBase" = 'TOTAL_DALMIA_WEIGHT';

-- Sheet rows 33 and 39 have no deduction formulas at all.
UPDATE "Parameter" SET "isDeductible" = false WHERE code IN ('NON_FOOD_GRADE_PET', 'METAL');
