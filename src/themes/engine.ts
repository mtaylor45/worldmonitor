/**
 * Theme engine. Owns the active theme, its persistence, and the DOM it touches.
 *
 * Design constraints that shaped this file:
 *
 *   1. Cycling themes must be lossless. P0 acceptance is twenty theme cycles
 *      leaving the DOM structurally identical to boot, so every mutation the
 *      engine makes is paired with an exact inverse: the token style element is
 *      rewritten rather than appended to, chrome teardown always runs before
 *      the next mount, and the shell attribute is removed rather than set to a
 *      sentinel.
 *   2. The engine must never throw into upstream startup. `bootThemes()` is
 *      called from `src/main.ts`, ahead of the dashboard; a bad stored value or
 *      a blocked localStorage must degrade to the default theme, not a blank
 *      kiosk that nobody is present to reboot.
 *   3. Applying a theme is synchronous. Stylesheet loading is not, and is
 *      deliberately not awaited by `apply()` — see `applyThemeStyles`.
 */

import { THEME_CHANGE_EVENT, type ThemeChangeDetail, type ThemeDefinition, type ThemeId } from './types';

/** Attribute the active theme id is published on, for CSS and for tests. */
export const THEME_ATTRIBUTE = 'data-wm-theme';
/** Marks the element chrome mounts into. Set at an upstream seam. */
export const SHELL_ATTRIBUTE = 'data-wm-shell';
/**
 * Attribute identifying an upstream panel host.
 *
 * This is UPSTREAM's own attribute, not one we add. SCOPE.md §4 budgeted a
 * third seam to stamp `data-wm-panel` onto panel hosts; that seam turned out to
 * be unnecessary, because upstream already marks every panel with
 * `data-panel="<key>"` and reads it back in fourteen places (panel-layout,
 * MobilePanelNav, PanelTabBar, tv-mode, search-selection-dispatcher, ...). Rule
 * §4.4 — prefer a DOM hook over an upstream edit — applies directly, so we
 * consume the existing attribute and spend two seams instead of three.
 *
 * Kept as a constant so that if upstream ever renames it, the fix is this line
 * rather than a search across our tree. The value doubles as the panel key,
 * which is what the P3 context snapshot needs to name a panel to the LLM.
 */
export const PANEL_ATTRIBUTE = 'data-panel';

export const THEME_STORAGE_KEY = 'wm-theme';
export const DEFAULT_THEME_ID = 'default';

/** `id` of the engine-owned <style> element carrying token overrides. */
const TOKEN_STYLE_ID = 'wm-theme-tokens';

export class ThemeEngine {
  private readonly themes = new Map<ThemeId, ThemeDefinition>();
  private activeId: ThemeId | null = null;
  private mountedChromeOn: HTMLElement | null = null;
  private chromeObserver: MutationObserver | null = null;

  constructor(private readonly doc: Document = document) {}

  register(theme: ThemeDefinition): void {
    this.themes.set(theme.id, theme);
  }

  list(): readonly ThemeDefinition[] {
    return [...this.themes.values()];
  }

  get(id: ThemeId): ThemeDefinition | undefined {
    return this.themes.get(id);
  }

  current(): ThemeId {
    return this.activeId ?? DEFAULT_THEME_ID;
  }

  /**
   * The element chrome mounts into.
   *
   * Falls back to `document.body` when the shell seam is absent so the engine
   * still functions against an upstream file we have not patched — the seam is
   * an optimisation for where chrome lands, never a hard dependency. Returns
   * null only pre-`<body>`, which `apply()` treats as "tokens only".
   */
  shell(): HTMLElement | null {
    return this.doc.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`) ?? this.doc.body ?? null;
  }

  /**
   * Switch to `id`. Unknown ids fall back to the default theme rather than
   * throwing, so a stale persisted value or a bad voice command degrades to a
   * readable dashboard.
   *
   * Returns the id actually applied.
   */
  apply(id: ThemeId, options: { persist?: boolean } = {}): ThemeId {
    const { persist = true } = options;
    const resolved = this.themes.has(id) ? id : DEFAULT_THEME_ID;
    if (resolved === this.activeId) return resolved;

    const previous = this.activeId;
    const theme = this.themes.get(resolved);

    // Teardown first, and unconditionally: chrome must never outlive its theme,
    // and unmounting from the element we actually mounted on (not the element
    // currently matching the seam) is what keeps repeated cycles lossless even
    // if upstream re-rendered the shell underneath us.
    this.stopWatchingChrome();
    this.unmountChrome(previous);

    this.writeTokens(theme);
    this.doc.documentElement.setAttribute(THEME_ATTRIBUTE, resolved);
    this.activeId = resolved;

    if (theme) {
      this.mountChrome(theme);
      this.watchChrome(theme);
      void applyThemeStyles(theme);
    }

    if (persist) writeStoredTheme(resolved);
    this.emit({ previous, current: resolved });
    return resolved;
  }

  /**
   * Rewrites (never appends to) the single engine-owned style element.
   *
   * Tokens go into a `[data-wm-theme="<id>"]` rule on `:root` rather than
   * inline styles: inline custom properties on `<html>` would be invisible to
   * `getComputedStyle` diffing in tests and impossible for a theme stylesheet
   * to override. A theme with no tokens leaves the element empty rather than
   * removing it, so the node count stays constant across cycles.
   */
  private writeTokens(theme: ThemeDefinition | undefined): void {
    const style = this.tokenStyleElement();
    const tokens = theme?.tokens;
    if (!tokens || Object.keys(tokens).length === 0) {
      style.textContent = '';
      return;
    }
    const body = Object.entries(tokens)
      .map(([name, value]) => `  --${name}: ${value};`)
      .join('\n');
    style.textContent = `:root[${THEME_ATTRIBUTE}="${theme.id}"] {\n${body}\n}\n`;
  }

  private tokenStyleElement(): HTMLStyleElement {
    const existing = this.doc.getElementById(TOKEN_STYLE_ID);
    if (existing instanceof HTMLStyleElement) return existing;
    const style = this.doc.createElement('style');
    style.id = TOKEN_STYLE_ID;
    // Appended to <head> last so it wins over upstream's :root block at equal
    // specificity. The attribute selector raises specificity anyway; source
    // order is belt-and-braces against a late-injected upstream stylesheet.
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
    return style;
  }

  private mountChrome(theme: ThemeDefinition): void {
    if (!theme.chrome) return;
    const shell = this.shell();
    if (!shell) return;
    this.mountChromeOn(theme, shell);
  }

  private mountChromeOn(theme: ThemeDefinition, shell: HTMLElement): void {
    if (!theme.chrome) return;
    try {
      theme.chrome.mount(shell);
      this.mountedChromeOn = shell;
    } catch (error) {
      // A theme that cannot render its chrome must not take the dashboard with
      // it; the tokens are already applied and upstream's own UI is intact.
      reportThemeFailure(`chrome mount failed for "${theme.id}"`, error);
      this.mountedChromeOn = null;
    }
  }

  /**
   * Re-mounts chrome after upstream rebuilds the shell's contents.
   *
   * `bootThemes()` runs before `new App('app')`, so chrome mounted at boot is
   * wiped by upstream's first render — and again by any later re-render, since
   * the dashboard rebuilds panel markup by assigning innerHTML. Watching for it
   * keeps the theme layer working without spending a fourth upstream seam on a
   * post-render hook, and without depending on upstream's render timing.
   *
   * Safe against feedback loops because `mount` is required to be idempotent:
   * the re-mount either adds the chrome back (one mutation, then quiet) or does
   * nothing at all.
   */
  private watchChrome(theme: ThemeDefinition): void {
    if (!theme.chrome || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (this.activeId !== theme.id) return;
      const shell = this.shell();
      if (shell) this.mountChromeOn(theme, shell);
    });
    const target = this.shell();
    if (!target) return;
    observer.observe(target, { childList: true, subtree: false });
    this.chromeObserver = observer;
  }

  private stopWatchingChrome(): void {
    this.chromeObserver?.disconnect();
    this.chromeObserver = null;
  }

  private unmountChrome(previousId: ThemeId | null): void {
    const host = this.mountedChromeOn;
    this.mountedChromeOn = null;
    if (!host || previousId === null) return;
    const chrome = this.themes.get(previousId)?.chrome;
    if (!chrome) return;
    try {
      chrome.unmount(host);
    } catch (error) {
      reportThemeFailure(`chrome unmount failed for "${previousId}"`, error);
    }
  }

  private emit(detail: ThemeChangeDetail): void {
    this.doc.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, { detail }));
  }
}

/**
 * Loads a theme's stylesheet, swallowing the rejection.
 *
 * Vite's preload helper rejects a CSS-only dynamic import with "Unable to
 * preload CSS for <url>" when the injected <link> errors, and an unconsumed
 * `void import(...)` surfaces as an unhandled rejection. Upstream hit exactly
 * this with happy-theme.css and documents it in `bootstrap/variant-theme.ts`;
 * this is the same contract, kept in our own tree so we do not depend on the
 * shape of an upstream export.
 */
export function applyThemeStyles(theme: ThemeDefinition): Promise<void> {
  if (!theme.loadStyles) return Promise.resolve();
  return Promise.resolve()
    .then(theme.loadStyles)
    .then(
      () => undefined,
      (error: unknown) => {
        reportThemeFailure(`stylesheet failed to load for "${theme.id}"`, error);
      },
    );
}

export function readStoredTheme(): ThemeId | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Private mode, blocked storage, or a kiosk profile with no writable
    // origin store. Not an error: the default theme is a correct fallback.
    return null;
  }
}

export function writeStoredTheme(id: ThemeId): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort; the session still renders the chosen theme.
  }
}

function reportThemeFailure(message: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  // console is deliberate: an unattended kiosk has no other operator channel.
  console.warn(`[wm-themes] ${message}: ${reason}`);
}
