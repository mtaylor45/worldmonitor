/**
 * Theme engine contract (LCARS World Monitor, P0).
 *
 * Lives entirely in `src/themes/` so upstream merges stay cheap: the engine is
 * reachable from upstream code at exactly three seams (see docs/UPSTREAM-DIFF.md)
 * and everything else here is additive.
 *
 * Deliberately independent of upstream's `data-variant` mechanism. That system
 * is token-only and its variant list is a closed enum guarded by a drift test
 * (`tests/desktop-one-binary-model.test.mjs`) because `/api/download` consumes
 * it. A theme here may also replace structural chrome, and must be addable
 * without touching that enum.
 */

/** Registered theme identifier. `default` is always present. */
export type ThemeId = string;

/**
 * CSS custom properties a theme overrides, keyed WITHOUT the leading `--`.
 *
 * Applied to the shell element as inline custom properties, so a theme never
 * has to out-specify upstream selectors — inline style on an ancestor wins the
 * cascade for inherited custom properties without `!important`.
 */
export type ThemeTokens = Readonly<Record<string, string>>;

/**
 * Structural chrome: DOM a theme adds around the upstream dashboard.
 *
 * `mount` receives the shell element (the node carrying `data-wm-shell`) and
 * returns a teardown. The engine guarantees `unmount` runs before another
 * theme mounts, so cycling themes cannot accumulate DOM — the P0 acceptance
 * criterion of twenty cycles leaving the DOM structurally identical.
 */
export interface ThemeChrome {
  mount(shell: HTMLElement): void;
  unmount(shell: HTMLElement): void;
}

/**
 * Named UI sounds. P0 records the slot; P1 wires playback (SCOPE.md §7.1).
 * Values are URLs resolved against the app origin — no CDN, kiosk is LAN-only.
 */
export type ThemeSounds = Readonly<Partial<Record<ThemeSoundSlot, string>>>;

export type ThemeSoundSlot =
  | 'wake'
  | 'accept'
  | 'change'
  | 'deny'
  | 'alert';

export interface ThemeDefinition {
  readonly id: ThemeId;
  /** Shown in the switcher. Not translated in P0 — theme names are proper nouns. */
  readonly label: string;
  /**
   * Token overrides. Omit (or leave empty) for a passthrough theme that must
   * render upstream unmodified — see `src/themes/default/index.ts`.
   */
  readonly tokens?: ThemeTokens;
  /**
   * Loads the theme's stylesheet, if it has one. Kept as a dynamic import so a
   * theme's CSS stays off every other theme's eager graph, matching how
   * upstream defers its own variant stylesheets (`bootstrap/variant-theme.ts`).
   */
  readonly loadStyles?: () => Promise<unknown>;
  readonly chrome?: ThemeChrome;
  readonly sounds?: ThemeSounds;
}

/** Emitted on `document` whenever the active theme changes. */
export interface ThemeChangeDetail {
  readonly previous: ThemeId | null;
  readonly current: ThemeId;
}

export const THEME_CHANGE_EVENT = 'wm:theme-change';
