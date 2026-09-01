import type { Theme } from '../types';
import { lcarsChrome } from './chrome';
import { lcarsTokens, type LcarsPalette } from './tokens';

/**
 * Sound slots (SCOPE.md §7.1). The files are added in P1; the paths are fixed
 * now so the mapping from slot to character is reviewable before the assets
 * land. Play at 0.15–0.2 — the raw files are loud.
 *
 * Provenance caveat: these .ogg files come from `louh/lcars` with an unstated
 * origin and are likely show-sourced. Fine for a personal LAN kiosk; they must
 * be replaced before any public distribution. See docs/LCARS-ASSETS.md.
 */
const SOUNDS = {
  wake: '/sounds/panel_beep_07.ogg',
  accept: '/sounds/panel_beep_14.ogg',
  change: '/sounds/panel_beep_03.ogg',
  deny: '/sounds/deny_beep_01.ogg',
  alert: '/sounds/panel_beep_08.ogg',
} as const;

/** The kiosk panel this theme is laid out for (SCOPE.md §2). */
const KIOSK_TARGET = { width: 1280, height: 720, label: '9in kiosk' } as const;

export function createLcarsTheme(palette: LcarsPalette): Theme {
  const drexler = palette === 'drexler';
  return {
    id: drexler ? 'lcars' : 'lcars-bright',
    name: drexler ? 'LCARS' : 'LCARS (bright)',
    description: drexler
      ? 'Screen-accurate Drexler palette, muted.'
      : 'Higher-contrast palette for legibility at distance.',
    tokens: lcarsTokens(palette),
    stylesheet: () => import('./lcars.css?url'),
    chrome: lcarsChrome,
    targets: [KIOSK_TARGET],
    sounds: SOUNDS,
  };
}

/** Variant A — Drexler, screen-accurate. */
export const lcars = createLcarsTheme('drexler');
/** Variant B — bright, higher contrast at distance. */
export const lcarsBright = createLcarsTheme('bright');
