import type { ThemeTokens } from '../types';

/**
 * LCARS palette variants (SCOPE.md §7.1).
 *
 * Both ship; the choice is a legibility test on the 163-PPI panel at 2.5 m,
 * not a taste decision, and cannot be settled before the hardware exists.
 */
export type LcarsPalette = 'drexler' | 'bright';

/**
 * Tone names, not colour names. The rail asks for `tan` or `periwinkle` and
 * gets whichever hex the active variant assigns — so a variant swap never
 * requires touching chrome.
 */
interface LcarsRamp {
  tan: string;
  lilac: string;
  periwinkle: string;
  ice: string;
  cream: string;
  ground: string;
}

/**
 * Variant A — Drexler. Screen-accurate and muted.
 * Source: `louh/lcars` `src/styles/index.css` custom properties (GPL-3.0),
 * attributed there to a Star Trek scenic artist. See docs/LCARS-ASSETS.md.
 */
const DREXLER: LcarsRamp = {
  tan: '#ec943a',
  lilac: '#c082a9',
  periwinkle: '#b6a5d1',
  ice: '#8b72aa',
  cream: '#faa41b',
  ground: '#090909',
};

/** Variant B — bright. Higher contrast, matches the reference screenshot. */
const BRIGHT: LcarsRamp = {
  tan: '#ffcc66',
  lilac: '#cc99cc',
  periwinkle: '#99ccff',
  ice: '#ff9933',
  cream: '#ffff99',
  ground: '#000000',
};

/**
 * Alert salmon. Deliberately identical in both variants and deliberately NOT
 * part of the tone ramp: SCOPE.md §2 makes salmon alert-only, and the moment
 * it becomes decorative the theme stops communicating.
 */
const ALERT_SALMON = '#cc6666';

export function lcarsTokens(palette: LcarsPalette): ThemeTokens {
  const ramp = palette === 'drexler' ? DREXLER : BRIGHT;

  return {
    color: {
      ...ramp,
      alert: ALERT_SALMON,
      bg: ramp.ground,
      'bg-panel': '#0d0d0d',
      primary: ramp.tan,
      text: '#f5f5f5',
      'text-dim': ramp.tan,
      'text-invert': ramp.ground,
      ok: '#3fb950',
      readout: ramp.cream,
      'voice-idle': ramp.ice,
      'voice-listening': ramp.cream,
      'voice-speaking': ramp.periwinkle,
    },

    font: {
      // P1 self-hosts Antonio in public/fonts/ and drops the Google Fonts
      // @import. Keeping the family in one token means that swap — or a
      // licensed Helvetica LT Std Ultra Compressed — is a one-line change.
      display: "'Antonio', 'Oswald', 'Arial Narrow', system-ui, sans-serif",
      body: "'Antonio', 'Oswald', 'Arial Narrow', system-ui, sans-serif",
      // 13px floor throughout: SCOPE.md §5 P1 requires legibility at 2.5 m and
      // nothing below 13px.
      'size-micro': '13px',
      'size-label': '14px',
      'size-body': '15px',
      'size-readout': '26px',
      'size-title': '22px',
      'tracking-label': '0.08em',
      weight: '400',
      'weight-bold': '700',
      // Cap-height match, per louh/lcars. The 1.36 factor is calibrated for
      // Swiss 911; Antonio has different vertical metrics and P1 must
      // re-measure it against real rendered text rather than inherit it.
      'cap-factor': '1.36',
    },

    space: {
      // The 5px black gutter is the signature of LCARS, more than any hex.
      gutter: '5px',
      block: '5px',
      rail: '104px',
      'rail-btn': '30px',
      header: '52px',
      footer: '28px',
    },

    radius: {
      cap: '14px',
      elbow: '42px',
      'elbow-inner': '18px',
      block: '4px',
    },

    /**
     * Map the LCARS vocabulary onto upstream's OWN custom properties, so
     * unmodified upstream panels inherit the theme with no panel-level CSS.
     *
     * The signal ramp (--threat-*, --semantic-*, --defcon-*, --status-*) is
     * deliberately absent: those carry meaning, and repainting --threat-low
     * into a warm LCARS orange would make a calm reading look like an alarm.
     * See src/themes/tokens.ts.
     */
    upstream: {
      bg: 'var(--wm-color-bg)',
      'bg-secondary': 'var(--wm-color-bg)',
      surface: 'var(--wm-color-bg-panel)',
      'surface-hover': '#161616',
      'surface-active': '#1c1c1c',
      'panel-bg': 'var(--wm-color-bg-panel)',

      border: 'var(--wm-color-tan)',
      'border-strong': 'var(--wm-color-cream)',
      'border-subtle': '#1a1a1a',
      'panel-border': 'var(--wm-color-tan)',

      text: 'var(--wm-color-text)',
      'text-secondary': 'var(--wm-color-tan)',
      accent: 'var(--wm-color-cream)',

      'font-body-base': 'var(--wm-font-body)',
    },
  };
}
