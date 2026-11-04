export * from './types';
export * from './defaults';
export { calculateReport, computeWeights, selectNorm, selectRate, round } from './engine';
export { buildTallyNarration } from './narration';
export type { NarrationOptions } from './narration';
export { sampleReportInput, sheetParityConfig, blankMaterial, SAMPLE_HEADER } from './sample';
export { toYMD, ymdKey, monthInSeason, seasonLabel } from './dates';
