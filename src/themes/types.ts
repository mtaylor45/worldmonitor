/**
 * Theme system contracts.
 *
 * World Monitor is vanilla TypeScript, so "chrome" components are plain DOM
 * factories rather than JSX. A theme may ship:
 *
 *   1. tokens  — CSS custom properties applied to :root
 *   2. stylesheet — a lazily-loaded CSS file scoped by [data-wm-theme="id"]
 *   3. chrome  — optional structural components (LCARS elbows, rails, end-caps)
 *
 * Themes that only restyle need (1) and (2). LCARS needs all three.
 */

export type TokenMap = Record<string, string>;

export interface ThemeTokens {
  /** Semantic colors. Keys become --wm-color-<key>. */
  color: TokenMap;
  /** Font families, sizes, weights, tracking. Becomes --wm-font-<key>. */
  font: TokenMap;
  /** Spacing scale. Becomes --wm-space-<key>. */
  space: TokenMap;
  /** Corner radii. Becomes --wm-radius-<key>. */
  radius: TokenMap;
  /** Anything else the theme needs. Becomes --wm-<key>. */
  extra?: TokenMap;
  /**
   * Overrides for UPSTREAM's own custom properties, emitted verbatim — `bg`
   * becomes `--bg`, not `--wm-color-bg`.
   *
   * This group is what makes "restyle via tokens alone" actually true. The
   * `--wm-*` groups above are a vocabulary our own chrome reads; upstream's
   * 28,000-line stylesheet has never heard of them, so a theme that only
   * defined those would leave every unmodified upstream panel looking exactly
   * as before, sitting inside a themed frame. Mapping the semantic vocabulary
   * onto the properties upstream actually consumes (`--bg`, `--surface`,
   * `--text`, `--panel-border`, ...) is what lets panels inherit a theme with
   * no panel-level CSS at all.
   *
   * Values here are normally `var(--wm-color-...)` references rather than
   * literals, so the semantic layer stays the single source of truth.
   *
   * See `src/themes/tokens.ts` for the full contract and which properties are
   * safe to repaint — the signal ramp is not.
   */
  upstream?: TokenMap;
}

/**
 * A chrome slot receives its host element and returns a teardown function.
 * Teardown must fully reverse the mount — themes are hot-swappable, and the
 * P0 acceptance criterion is that twenty cycles leave the DOM identical.
 */
export type ChromeMount = (host: HTMLElement, ctx: ChromeContext) => ChromeTeardown;
export type ChromeTeardown = () => void;

export interface ChromeContext {
  /** Dispatch a named action. The voice layer (P3) uses the same bus. */
  dispatch: (action: string, payload?: unknown) => void;
  /** Current theme id. */
  themeId: string;
}

export interface ThemeChrome {
  /**
   * Wraps the whole app. Receives the shell host; must leave a
   * [data-wm-content] element in the DOM for the dashboard to render into.
   */
  shell?: ChromeMount;
  /** Wraps each panel. Called once per panel host. */
  panel?: ChromeMount;
}

/**
 * Named sound slots. A caller asks for a slot, never a filename, so the active
 * theme owns what each event sounds like. Characters are documented in
 * docs/VOICE-CHARACTER.md and docs/LCARS-ASSETS.md.
 */
export type ThemeSoundSlot = 'wake' | 'accept' | 'change' | 'deny' | 'alert';

export interface DisplayTarget {
  width: number;
  height: number;
  /** Optional label, e.g. "9in kiosk". */
  label?: string;
}

export interface Theme {
  id: string;
  name: string;
  /** One line shown in the theme picker. */
  description?: string;
  tokens: ThemeTokens;
  /**
   * Lazily-imported stylesheet. Use `() => import('./lcars.css?url')` under
   * Vite so the CSS is code-split and only fetched when the theme is applied.
   *
   * `?url` rather than a bare CSS import on purpose: it yields a URL this
   * engine injects as a `<link>` it owns and can remove again. A plain
   * `import('./x.css')` lets Vite inject a `<style>` that never comes back
   * out, which would leave a theme's rules in the document after switching
   * away from it.
   */
  stylesheet?: () => Promise<{ default: string }>;
  chrome?: ThemeChrome;
  /** Resolutions this theme is tuned for. Informational; drives a warning. */
  targets?: DisplayTarget[];
  /** Optional UI sounds, keyed by slot. LCARS beeps live here. */
  sounds?: Partial<Record<ThemeSoundSlot, string>>;
}

/** Emitted on `document` whenever the active theme changes. */
export interface ThemeChangeDetail {
  readonly previous: string | null;
  readonly current: string;
}

export const THEME_CHANGE_EVENT = 'wm:theme-change';

/** The bus rail buttons and the P3 voice layer both dispatch on. */
export const ACTION_EVENT = 'wm:action';

export interface ActionDetail {
  readonly action: string;
  readonly payload?: unknown;
}
