/**
 * Design tokens sampled from https://www.dalmiapolypro.in on 2026-09-21 — see brand.md for raw
 * values, method and font substitutions. This file is the single source: it feeds the MUI theme
 * and is written to :root as CSS variables by applyTokens(). Light theme only for v1; a dark
 * theme only needs a second token set.
 */
export interface TokenMeta {
  value: string;
  /** Where the value came from, shown on Admin → Settings → Appearance. */
  source: string;
}

export const COLOR_TOKENS = {
  '--brand-primary': { value: '#005051', source: 'Sampled: footer, nav links, tiles. White text 9.27:1' },
  '--brand-primary-dark': { value: '#002829', source: 'Site theme palette (button hover in the app)' },
  '--brand-primary-mid': { value: '#3E7C7D', source: 'Sampled: section headings, active nav' },
  '--brand-primary-light': { value: '#E0EDED', source: 'Derived tint of primary: active nav, selected rows' },
  '--brand-accent': { value: '#4AB861', source: 'Sampled: labels, button outline. Not for white text (2.52:1)' },
  '--text-primary': { value: '#1E1E1E', source: 'Sampled: theme dark' },
  '--text-secondary': { value: '#565656', source: 'Sampled: body paragraphs' },
  '--bg-page': { value: '#FFFFFF', source: 'Sampled: header and page background' },
  '--bg-surface': { value: '#F5F5F5', source: 'Sampled: light section bands (zebra rows in the app)' },
  '--border': { value: '#DBDBDB', source: 'Site theme palette' },
  '--success': { value: '#2E7D32', source: 'Specified: within norm' },
  '--warning': { value: '#F9A825', source: 'Specified: pending approvals, import mismatches' },
  '--danger': { value: '#C62828', source: 'Specified: actual % above norm, negative weight difference' },
} as const satisfies Record<string, TokenMeta>;

export const OTHER_TOKENS = {
  '--brand-gradient': {
    value: 'linear-gradient(90deg, #00AA9F 0%, #079446 100%)',
    source: 'Pixel-sampled from the site’s gradient panel. Login hero and header strip only',
  },
  '--radius': { value: '20px', source: 'Sampled: buttons are near-pill (46px tall, 20px radius)' },
  '--radius-surface': { value: '4px', source: 'Design decision (site uses 0px): cards, inputs, tables' },
  '--font-heading': {
    value: "'Nunito Sans Variable', 'Nunito Sans', 'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif",
    source: 'Substitute: site uses Avenir LT 85 Heavy (commercial, cannot be self-hosted)',
  },
  '--font-body': {
    value: "'Nunito Sans Variable', 'Nunito Sans', 'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif",
    source: 'Substitute: site uses Avenir LT 35 Light (commercial)',
  },
  '--font-numeric': {
    value: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
    source: 'Specified: tabular figures for money and quantity columns',
  },
} as const satisfies Record<string, TokenMeta>;

export type ColorToken = keyof typeof COLOR_TOKENS;
export const color = (name: ColorToken): string => COLOR_TOKENS[name].value;

/** Chart series: primary, accent, then a muted teal/grey ramp (never the Recharts defaults). */
export const CHART_SERIES = ['#005051', '#4AB861', '#3E7C7D', '#7FA8A8', '#8A9A9A', '#B5C4C4'] as const;

export function applyTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, meta] of Object.entries({ ...COLOR_TOKENS, ...OTHER_TOKENS })) {
    root.style.setProperty(name, meta.value);
  }
}
