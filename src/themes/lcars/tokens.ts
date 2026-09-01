import type { ThemeTokens } from '../types';

/**
 * LCARS palette variants (SCOPE.md §7.1).
 *
 * Both ship; the choice is a legibility test on the 163-PPI panel at 2.5 m,
 * not a taste decision, and cannot be settled before the hardware exists.
 */
export type LcarsPalette = 'drexler' | 'bright';

/**
 * Variant A — Drexler. Screen-accurate and muted.
 * Source: `louh/lcars` `src/styles/index.css` custom properties (GPL-3.0),
 * attributed there to a Star Trek scenic artist. See docs/LCARS-ASSETS.md.
 */
const DREXLER = {
  'lcars-1': '#ec943a',
  'lcars-2': '#eb9870',
  'lcars-3': '#c47d69',
  'lcars-4': '#d29a7f',
  'lcars-5': '#faa41b',
  'lcars-6': '#c082a9',
  'lcars-7': '#9c698a',
  'lcars-8': '#b6a5d1',
  'lcars-9': '#8b72aa',
  'lcars-ground': '#090909',
} as const;

/** Variant B — bright. Higher contrast, matches the reference screenshot. */
const BRIGHT = {
  'lcars-1': '#ffcc66',
  'lcars-2': '#cc99cc',
  'lcars-3': '#99ccff',
  'lcars-4': '#ff9933',
  'lcars-5': '#ffff99',
  'lcars-6': '#cc99cc',
  'lcars-7': '#99ccff',
  'lcars-8': '#ffcc66',
  'lcars-9': '#ff9933',
  'lcars-ground': '#000000',
} as const;

/**
 * Alert salmon. Deliberately identical in both variants and deliberately NOT
 * part of the numbered ramp: SCOPE.md §2 makes salmon alert-only, and the
 * moment it becomes decorative the theme stops communicating.
 */
const ALERT_SALMON = '#cc6666';

/**
 * Structural constants. These, not the hex values, are the signature of LCARS:
 * a 5px black gutter and a full-pill outer radius.
 */
const STRUCTURE = {
  'lcars-gutter': '5px',
  'lcars-row-height': '28px',
  // Cap-height match, per louh/lcars. The 1.36 factor is calibrated for Swiss
  // 911; Antonio has different vertical metrics and P1 must re-measure it
  // against real rendered text rather than inherit the number on faith.
  'lcars-cap-factor': '1.36',
} as const;

export function lcarsTokens(palette: LcarsPalette): ThemeTokens {
  const ramp = palette === 'drexler' ? DREXLER : BRIGHT;
  return Object.freeze({
    ...ramp,
    ...STRUCTURE,
    'lcars-alert': ALERT_SALMON,

    // Map the LCARS ramp onto upstream's surface tokens so unmodified panels
    // inherit the theme without any panel-level CSS. The signal ramp
    // (--threat-*, --semantic-*, --defcon-*) is intentionally left alone: those
    // carry meaning, and repainting them into warm LCARS orange would make a
    // calm reading look like an alarm. See src/themes/tokens.ts.
    bg: ramp['lcars-ground'],
    'bg-secondary': ramp['lcars-ground'],
    surface: '#0d0d0d',
    'surface-hover': '#161616',
    'surface-active': '#1c1c1c',
    'panel-bg': '#0d0d0d',

    border: ramp['lcars-1'],
    'border-strong': ramp['lcars-5'],
    'border-subtle': '#1a1a1a',
    'panel-border': ramp['lcars-1'],

    text: '#f5f5f5',
    'text-secondary': ramp['lcars-1'],
    accent: ramp['lcars-5'],

    // P1 self-hosts Antonio in public/fonts/ and drops the Google Fonts
    // @import. Keeping the family name in one token means that swap — or a
    // licensed Helvetica LT Std Ultra Compressed — is a one-line change.
    'font-body-base': "'Antonio', 'Oswald', 'Arial Narrow', system-ui, sans-serif",
  });
}
