import { Router } from 'express';
import { DEFAULT_TOLERANCE_FRACTION } from '@dalmia/calc';
import { updateSettingsSchema, type SettingsDto } from '@dalmia/types';
import { currentUser } from '../auth/middleware';
import { SETTING_KEYS } from '../config/engine-config';
import { writeAudit, type AuditEntry } from '../lib/audit';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';

type SettingKey = keyof typeof SETTING_KEYS;

/** Reads the Setting rows with the same fall-backs as loadEngineConfig, so this screen shows what the engine uses. */
async function readSettings(): Promise<SettingsDto> {
  const rows = new Map((await prisma.setting.findMany()).map((s) => [s.key, s.value]));
  const tolerance = Number(rows.get(SETTING_KEYS.toleranceFraction));
  const defaultTolerance = rows.get(SETTING_KEYS.defaultWeightTolerancePercent);
  return {
    toleranceFraction: rows.has(SETTING_KEYS.toleranceFraction) && Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : DEFAULT_TOLERANCE_FRACTION,
    useWeightToleranceRow: rows.get(SETTING_KEYS.useWeightToleranceRow) === 'true',
    allowNegativeOtherShortage: rows.get(SETTING_KEYS.allowNegativeOtherShortage) === 'true',
    defaultWeightTolerancePercent:
      defaultTolerance !== undefined && defaultTolerance !== '' && Number.isFinite(Number(defaultTolerance)) ? Number(defaultTolerance) : null,
  };
}

/** Mounted at /api/admin/settings behind requireAuth + requireAdmin. Only the keys in SETTING_KEYS exist. */
export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await readSettings());
  }),
);

settingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(updateSettingsSchema, req); // strict: an unknown key is a 400
    const before = await readSettings();

    const audits: AuditEntry[] = [];
    await prisma.$transaction(async (tx) => {
      for (const key of Object.keys(SETTING_KEYS) as SettingKey[]) {
        const value = input[key];
        if (value === undefined || value === before[key]) continue;
        // A blank default tolerance is "no row": the lookups endpoint reads a missing row as blank.
        if (value === null) await tx.setting.deleteMany({ where: { key } });
        else await tx.setting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } });
        audits.push({ userId: admin.id, action: 'SETTING_UPDATE', field: key, oldValue: before[key], newValue: value });
      }
      await writeAudit(audits, tx);
    });
    res.json(await readSettings());
  }),
);
