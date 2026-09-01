import type { ThemeTokens } from '../types';

/**
 * LCARS — Library Computer Access/Retrieval System.
 *
 * Palette follows the TNG-era screens: near-black field, blocks of
 * butterscotch/lilac/periwinkle, gold for numeric readouts, salmon reserved
 * strictly for alert states so it stays meaningful.
 *
 * The signature of LCARS is not the colours, it's the *gutter*: every coloured
 * block is separated by a few pixels of pure black, and every outer corner is a
 * full pill. Get the gutter and the radius right and it reads correctly even
 * before the palette lands.
 *
 * Both variants ship. Which one is right is a legibility test at 2.5 m on a
 * 163-PPI panel, not a taste decision, and cannot be settled before the
 * hardware exists (SCOPE.md §7.1).
 */
export type LcarsPalette = 'drexler' | 'bright';

/**
 * Tone names, not colour names, for the structural ramp — the rail asks for
 * `tan` and gets whichever hex the active variant assigns, so a variant swap
 * never touches chrome.
 *
 * The meaning-carrying tokens (`alert`, `ok`, `readout`, `voice-*`) are named
 * semantically instead, per the project convention: a theme that renames red to
 * blue should not have to lie about it.
 */
interface LcarsRamp {
  bg: string;
  'bg-panel': string;
  primary: string;
  tan: string;
  lilac: string;
  periwinkle: string;
  ice: string;
  cream: string;
  readout: string;
  text: string;
  'text-dim': string;
  'text-invert': string;
  ok: string;
  'voice-idle': string;
  'voice-listening': string;
  'voice-speaking': string;
}

/**
 * Variant A — Drexler. Screen-accurate and muted.
 *
 * Source: `louh/lcars` `src/styles/index.css` custom properties (GPL-3.0),
 * attributed there to a Star Trek scenic artist. See docs/LCARS-ASSETS.md.
 *
 * Four of the nine published Drexler hues are deliberately unused: `#eb9870`,
 * `#c47d69`, `#d29a7f` and `#9c698a` sit in the salmon/peach family, close
 * enough to the alert salmon `#cc6666` that putting them in the structural ramp
 * would erode the one rule this theme most needs to keep.
 */
const DREXLER: LcarsRamp = {
  bg: '#090909',
  'bg-panel': '#0d0d0d',
  primary: '#faa41b',
  tan: '#ec943a',
  lilac: '#c082a9',
  periwinkle: '#b6a5d1',
  ice: '#8b72aa',
  cream: '#faa41b',
  readout: '#ffcc00',
  text: '#e8c07a',
  'text-dim': '#c89a4a',
  'text-invert': '#090909',
  ok: '#99cc99',
  'voice-idle': '#5a5a7a',
  'voice-listening': '#b6a5d1',
  'voice-speaking': '#faa41b',
};

/** Variant B — bright. Higher contrast, matches the reference screenshot. */
const BRIGHT: LcarsRamp = {
  bg: '#000000',
  'bg-panel': '#000000',
  primary: '#ff9c00',
  tan: '#ffcc66',
  lilac: '#cc99cc',
  periwinkle: '#9999ff',
  ice: '#99ccff',
  cream: '#ffeebb',
  readout: '#ffcc00',
  text: '#ffcc66',
  'text-dim': '#c89a4a',
  'text-invert': '#000000',
  ok: '#99cc99',
  'voice-idle': '#5a5a7a',
  'voice-listening': '#99ccff',
  'voice-speaking': '#ff9c00',
};

/**
 * Alert salmon. Identical in both variants and deliberately outside the tone
 * ramp: SCOPE.md §2 makes salmon alert-only, and the moment it becomes
 * decorative the theme stops communicating.
 */
const ALERT_SALMON = '#cc6666';

export function lcarsTokens(palette: LcarsPalette): ThemeTokens {
  const ramp = palette === 'drexler' ? DREXLER : BRIGHT;

  return {
    color: { ...ramp, alert: ALERT_SALMON },

    font: {
      display: "'Antonio', 'Oswald', 'Arial Narrow', sans-serif",
      body: "'Antonio', 'Oswald', 'Arial Narrow', sans-serif",
      // At 163 PPI on a 9in panel, 13px is the practical floor for the
      // condensed face. Anything smaller loses stroke definition.
      'size-micro': '13px',
      'size-label': '15px',
      'size-body': '17px',
      'size-readout': '26px',
      'size-title': '38px',
      'tracking-label': '0.08em',
      weight: '400',
      'weight-bold': '600',
      // Cap-height match, per louh/lcars. The 1.36 factor is calibrated for
      // Swiss 911; Antonio has different vertical metrics and P1 must
      // re-measure it against rendered text rather than inherit it on faith.
      'cap-factor': '1.36',
    },

    space: {
      // The black gap between blocks. This one value carries the look.
      gutter: '5px',
      block: '10px',
      rail: '128px',
      'rail-btn': '34px',
      header: '54px',
      footer: '30px',
    },

    radius: {
      // Outer caps are true pills. The CSS uses `border-radius: 50%` on the two
      // outer corners rather than this length where the block height varies —
      // a percentage stays correct at any height, where a fixed radius flattens
      // as the block grows (docs/LCARS-ASSETS.md). This value covers the
      // fixed-height corners.
      cap: '999px',
      elbow: '68px',
      'elbow-inner': '28px',
      // LCARS blocks are square except where they cap. Not a rounded-card UI.
      block: '0px',
    },

    extra: {
      'elbow-arm': '54px',
      /**
       * Width the content well loses to the frame: rail + frame padding + the
       * body gap. The stylesheet needs this as a literal in media queries (a
       * custom property cannot appear in a media condition), so it is recorded
       * here as the single place the two must agree.
       */
      'frame-inset': '148px',
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
      'border-strong': 'var(--wm-color-primary)',
      'border-subtle': '#1a1a1a',
      'panel-border': 'var(--wm-color-tan)',

      text: 'var(--wm-color-text)',
      'text-secondary': 'var(--wm-color-text-dim)',
      accent: 'var(--wm-color-readout)',

      'font-body-base': 'var(--wm-font-body)',
    },
  };
}
