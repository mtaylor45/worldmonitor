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
  /** Field. #090909, never pure black — see below. */
  bg: string;
  'bg-panel': string;
  /** Frame spine. Structural only. */
  primary: string;
  tan: string;
  lilac: string;
  periwinkle: string;
  ice: string;
  cream: string;
  /** Header sweep. */
  peach: string;
  /** Numeric values only. */
  readout: string;
  text: string;
  'text-dim': string;
  'text-invert': string;
  /** Status: nominal. */
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
  'bg-panel': '#121212',
  primary: '#faa41b',
  tan: '#ec943a',
  lilac: '#c082a9',
  periwinkle: '#b6a5d1',
  ice: '#8b72aa',
  cream: '#d29a7f',
  peach: '#eb9870',
  readout: '#ffcc00',
  text: '#e8c07a',
  'text-dim': '#c89a4a',
  'text-invert': '#090909',
  ok: '#99cc99',
  'voice-idle': '#5a5a7a',
  'voice-listening': '#b6a5d1',
  'voice-speaking': '#faa41b',
};

/**
 * Variant B — Broadcast. TNG screens, high contrast. The design system's
 * primary palette, and each hue carries exactly one job.
 *
 * The field is #090909, NOT pure black: one step of lift stops an emissive
 * panel reading as a dead region, and it gives the gutter a faint presence
 * rather than a void.
 */
const BRIGHT: LcarsRamp = {
  bg: '#090909',
  'bg-panel': '#121212',
  primary: '#ff9c00',
  tan: '#ffcc66',
  lilac: '#cc99cc',
  periwinkle: '#9999ff',
  ice: '#99ccff',
  cream: '#ffeebb',
  peach: '#e8a87c',
  readout: '#ffcc00',
  text: '#ffcc66',
  'text-dim': '#e8a87c',
  'text-invert': '#090909',
  ok: '#99cc99',
  'voice-idle': '#5a5a7a',
  'voice-listening': '#99ccff',
  'voice-speaking': '#ff9c00',
};

/**
 * The status colours. Identical in both variants and deliberately outside the
 * tone ramp.
 *
 * The design system's one non-negotiable rule: **salmon and red are status
 * only.** The moment either appears as ornament, an alert stops meaning
 * anything. Nothing in this theme's chrome may reference them — the alert
 * state (below) is their sole legitimate use.
 */
const ALERT_SALMON = '#cc6666';
const CRITICAL_RED = '#ff3300';

export function lcarsTokens(palette: LcarsPalette): ThemeTokens {
  const ramp = palette === 'drexler' ? DREXLER : BRIGHT;

  return {
    color: { ...ramp, alert: ALERT_SALMON, critical: CRITICAL_RED },

    font: {
      display: "'Antonio', 'Oswald', 'Arial Narrow', sans-serif",
      body: "'Antonio', 'Oswald', 'Arial Narrow', sans-serif",
      // At 163 PPI on a 9in panel, 13px is the practical floor for the
      // condensed face. Anything smaller loses stroke definition.
      'size-micro': '13px',
      'size-label': '15px',
      'size-body': '17px',
      'size-readout': '26px',
      'size-head': '30px',
      'size-title': '44px',
      'tracking-label': '0.08em',
      weight: '400',
      'weight-semi': '600',
      'weight-bold': '700',
      // Cap-height match, per louh/lcars. The 1.36 factor is calibrated for
      // Swiss 911; Antonio has different vertical metrics and P1 must
      // re-measure it against rendered text rather than inherit it on faith.
      'cap-factor': '1.36',
    },

    space: {
      // The black gap between blocks. This one value carries the look.
      // Absolute. Two coloured blocks never touch.
      gutter: '5px',
      block: '10px',
      // The guide specifies 150px and allows 128px at 1280 "if content is
      // tight". It is: the well is already 1137px and upstream's header only
      // just fits after its degradation ladder re-runs. 128 stays.
      rail: '128px',
      'rail-btn': '34px',
      header: '64px',
      footer: '38px',
    },

    radius: {
      // Outer caps are true pills. The CSS uses `border-radius: 50%` on the two
      // outer corners rather than this length where the block height varies —
      // a percentage stays correct at any height, where a fixed radius flattens
      // as the block grows (docs/LCARS-ASSETS.md). This value covers the
      // fixed-height corners.
      cap: '999px',
      // 72 : 30 is exactly 2.40 : 1. The guide is explicit that the RATIO
      // carries the form — closer together and the joint reads as a plain
      // rounded corner, further apart and it reads as a bubble.
      elbow: '72px',
      'elbow-inner': '30px',
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
      // The gutter is the separation. "Put a border or shadow on a block" is
      // an explicit DON'T, so upstream's per-panel border is painted out to
      // the field colour rather than left tan — the 5px gutter plus the
      // panel's own lift (#121212 on #090909) does the work, which is exactly
      // the contrast the design system's own cells use.
      'panel-border': 'var(--wm-color-bg)',

      text: 'var(--wm-color-text)',
      'text-secondary': 'var(--wm-color-text-dim)',
      accent: 'var(--wm-color-readout)',
      // Numeric readouts are gold, everywhere, per the colour contract.
      green: 'var(--wm-color-ok)',

      'font-body-base': 'var(--wm-font-body)',
    },
  };
}
