import type { Prisma } from '@prisma/client';
import { DEFAULT_TOLERANCE_FRACTION, type EngineConfig } from '@dalmia/calc';
import { prisma } from '../prisma';

export const SETTING_KEYS = {
  toleranceFraction: 'toleranceFraction',
  useWeightToleranceRow: 'useWeightToleranceRow',
  allowNegativeOtherShortage: 'allowNegativeOtherShortage',
  defaultWeightTolerancePercent: 'defaultWeightTolerancePercent',
} as const;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Builds the engine configuration from the Parameter / NormRule / RateRule / Setting tables. */
export async function loadEngineConfig(client: Prisma.TransactionClient = prisma): Promise<EngineConfig> {
  const [parameters, settings] = await Promise.all([
    client.parameter.findMany({
      where: { isActive: true },
      include: { norms: true, rates: true },
      orderBy: { sortOrder: 'asc' },
    }),
    client.setting.findMany(),
  ]);
  const setting = new Map(settings.map((s) => [s.key, s.value]));
  const tolerance = Number(setting.get(SETTING_KEYS.toleranceFraction));

  return {
    parameters: parameters.map((p) => ({
      code: p.code,
      name: p.name,
      category: p.category,
      inputMode: p.inputMode,
      sortOrder: p.sortOrder,
      isDeductible: p.isDeductible,
      norms: p.norms.map((n) => ({
        seasonStartMonth: n.seasonStartMonth,
        seasonEndMonth: n.seasonEndMonth,
        normPercent: n.normPercent.toNumber(),
        effectiveFrom: isoDate(n.effectiveFrom),
      })),
      rates: p.rates.map((r) => ({
        rateMode: r.rateMode,
        fixedRate: r.fixedRate?.toNumber() ?? null,
        weightBase: r.weightBase,
        maxActualPercent: r.maxActualPercent?.toNumber() ?? null,
        effectiveFrom: isoDate(r.effectiveFrom),
      })),
    })),
    toleranceFraction: Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : DEFAULT_TOLERANCE_FRACTION,
    useWeightToleranceRow: setting.get(SETTING_KEYS.useWeightToleranceRow) === 'true',
    allowNegativeOtherShortage: setting.get(SETTING_KEYS.allowNegativeOtherShortage) === 'true',
  };
}
