import { z } from 'zod';

const num = z.number().finite().nullable();
const nonNegative = z.number().finite().min(0).nullable();

/** Engine input as sent by clients — everything except `config`, which always comes from the database. */
export const calcInputSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'reportDate must be YYYY-MM-DD'),
  materials: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        invoiceWeightKg: nonNegative,
        invoiceBales: nonNegative,
        invoiceRate: nonNegative,
        dalmiaWeightKg: nonNegative,
        dalmiaBales: nonNegative,
        dalmiaRate: nonNegative,
      }),
    )
    .max(20),
  baleWeightsKg: z.array(nonNegative).max(3),
  readings: z
    .array(
      z.object({
        parameterCode: z.string().min(1),
        perBale: z.array(nonNegative).max(3),
        purchaseAdjustment: num.optional(),
      }),
    )
    .max(50),
  shortageAdjustments: z
    .array(z.object({ materialCode: z.string().min(1), adjustmentQty: z.number().finite() }))
    .max(20)
    .optional(),
  weightTolerancePercent: nonNegative.optional(),
});
export type CalcInputDto = z.infer<typeof calcInputSchema>;
