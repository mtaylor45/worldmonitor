import type { ThemeDefinition } from '../types';
import { lcarsChrome } from './chrome';
import { lcarsTokens, type LcarsPalette } from './tokens';

/**
 * Sound slots (SCOPE.md §7.1). The files are added in P1; the paths are fixed
 * now so the mapping from slot to character is reviewable before the assets
 * land. Play at 0.15–0.2 — the raw files are loud.
 *
 * Provenance caveat: these .ogg files come from `louh/lcars` with an unstated
 * origin and are likely show-sourced. Fine for a personal LAN kiosk; they must
 * be replaced before any public distribution. Recorded in docs/LCARS-ASSETS.md.
 */
const SOUNDS = {
  wake: '/sounds/panel_beep_07.ogg',
  accept: '/sounds/panel_beep_14.ogg',
  change: '/sounds/panel_beep_03.ogg',
  deny: '/sounds/deny_beep_01.ogg',
  alert: '/sounds/panel_beep_08.ogg',
} as const;

export function createLcarsTheme(palette: LcarsPalette): ThemeDefinition {
  return {
    id: palette === 'drexler' ? 'lcars' : 'lcars-bright',
    label: palette === 'drexler' ? 'LCARS' : 'LCARS (bright)',
    tokens: lcarsTokens(palette),
    loadStyles: () => import('./lcars.css'),
    chrome: lcarsChrome,
    sounds: SOUNDS,
  };
}

/** Variant A — Drexler, screen-accurate. */
export const lcarsTheme = createLcarsTheme('drexler');
/** Variant B — bright, higher contrast at distance. */
export const lcarsBrightTheme = createLcarsTheme('bright');
