/**
 * The default token contract, extracted verbatim from upstream CSS.
 *
 * PROVENANCE — every value below was copied from `src/styles/main.css` at the
 * commit recorded in docs/P0-PORT.md. Nothing here is hand-invented; the
 * extraction procedure and its re-verification step are documented there.
 *
 *   :root            main.css:8    backgrounds, borders, text, overlays,
 *                                  scrollbar, input, panels, map, fonts
 *   :root            main.css:82   semantic / threat / billing / DEFCON /
 *                                  status colours and legacy aliases
 *   :root            main.css:1580 dashboard grid metrics
 *
 * This is a REFERENCE, not something the engine applies. The `default` theme
 * deliberately overrides nothing (see `src/themes/default/index.ts`), so
 * upstream stays the single source of truth for its own values and this table
 * cannot silently drift into a rendering difference. Its job is to tell a new
 * theme author which properties exist and what the baseline looks like, and to
 * back the drift check in `tests/dom/theme-token-contract.test.mts`.
 */

import type { TokenMap } from './types';

/** Surface, border and text ramp — main.css:8. */
export const BASE_TOKENS: TokenMap = Object.freeze({
  bg: '#0a0a0a',
  'bg-secondary': '#111',
  surface: '#141414',
  'surface-hover': '#1e1e1e',
  'surface-active': '#1a1a2e',

  border: '#2a2a2a',
  'border-strong': '#444',
  'border-subtle': '#1a1a1a',

  text: '#e8e8e8',
  'text-secondary': '#ccc',
  'text-dim': '#888',
  'text-muted': '#838383',
  'text-faint': '#7f7f7f',
  'text-ghost': '#666',
  accent: '#fff',

  'overlay-subtle': 'rgba(255, 255, 255, 0.03)',
  'overlay-light': 'rgba(255, 255, 255, 0.05)',
  'overlay-medium': 'rgba(255, 255, 255, 0.1)',
  'overlay-heavy': 'rgba(255, 255, 255, 0.2)',
  'shadow-color': 'rgba(0, 0, 0, 0.5)',
  'darken-light': 'rgba(0, 0, 0, 0.15)',
  'darken-medium': 'rgba(0, 0, 0, 0.2)',
  'darken-heavy': 'rgba(0, 0, 0, 0.3)',

  'scrollbar-thumb': '#333',
  'scrollbar-thumb-hover': '#555',

  'input-bg': '#1a1a1a',

  'panel-bg': '#141414',
  'panel-border': '#2a2a2a',

  'map-bg': '#020a08',
  'map-grid': '#0a2a20',
  'map-country': '#0a2018',
  'map-stroke': '#0f5040',
});

/**
 * Signal colours — main.css:82.
 *
 * A theme that restyles these is making a semantic claim, not a decorative
 * one. LCARS in particular must not repaint the severity ramp into its own
 * palette: salmon is alert-only (SCOPE.md §2), and recolouring `--threat-low`
 * to a warm LCARS orange would make a calm reading look like an alarm.
 */
export const SIGNAL_TOKENS: TokenMap = Object.freeze({
  'semantic-critical': '#ff4444',
  'semantic-high': '#ff8800',
  'semantic-elevated': '#ffaa00',
  'semantic-normal': '#44aa44',
  'semantic-low': '#3388ff',
  'semantic-info': '#3b82f6',
  'semantic-positive': '#44ff88',

  'threat-critical': '#ef4444',
  'threat-high': '#f97316',
  'threat-medium': '#eab308',
  'threat-low': '#22c55e',
  'threat-info': '#3b82f6',

  'billing-tone-active': '#22c55e',
  'billing-tone-attention': '#eab308',
  'billing-tone-ending': '#3b82f6',
  'billing-tone-ended': '#ef4444',
  'billing-tone-unknown': '#9ca3af',

  'defcon-1': '#ff0040',
  'defcon-2': '#ff4400',
  'defcon-3': '#ffaa00',
  'defcon-4': '#00aaff',
  'defcon-5': '#2d8a6e',

  'status-live': '#44ff88',
  'status-cached': '#ffaa00',
  'status-unavailable': '#ff4444',

  red: '#ff4444',
  'red-strong': '#d62b2b',
  green: '#44ff88',
  yellow: '#ffaa00',
});

/** Type stack — main.css:8. `--font-body` derives from `--font-body-base`. */
export const FONT_TOKENS: TokenMap = Object.freeze({
  'font-mono':
    "'SF Mono', 'Monaco', 'Cascadia Code', 'Fira Code', 'DejaVu Sans Mono', 'Liberation Mono', monospace",
  'font-body-base': 'var(--font-mono)',
  'font-body': 'var(--font-body-base)',
});

/** Dashboard grid metrics — main.css:1580. */
export const LAYOUT_TOKENS: TokenMap = Object.freeze({
  'dashboard-panel-row-min': '200px',
  'dashboard-panel-row-max': '380px',
  'dashboard-grid-gap': '4px',
});

/** Every token a theme may override, with its upstream baseline value. */
export const DEFAULT_TOKEN_CONTRACT: TokenMap = Object.freeze({
  ...BASE_TOKENS,
  ...SIGNAL_TOKENS,
  ...FONT_TOKENS,
  ...LAYOUT_TOKENS,
});

export const TOKEN_NAMES: readonly string[] = Object.freeze(
  Object.keys(DEFAULT_TOKEN_CONTRACT).sort(),
);
