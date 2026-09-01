/**
 * Theme engine. Owns the active theme, its persistence, and the DOM it touches.
 *
 * Design constraints that shaped this file:
 *
 *   1. Cycling themes must be lossless. P0 acceptance is twenty theme cycles
 *      leaving the DOM structurally identical to boot, so every mutation the
 *      engine makes is paired with an exact inverse: chrome mounts return their
 *      own teardown, the token style element is rewritten rather than appended
 *      to, stylesheet <link>s are owned and removed, and the shell attribute is
 *      removed rather than set to a sentinel.
 *   2. The engine must never throw into upstream startup. `bootThemes()` is
 *      called from `src/main.ts`, ahead of the dashboard; a bad stored value or
 *      a blocked localStorage must degrade to the default theme, not a blank
 *      kiosk that nobody is present to reboot.
 *   3. Tokens land synchronously. Stylesheets and chrome do too, where they
 *      can; only the stylesheet fetch is async, and nothing waits on it.
 */

import {
  ACTION_EVENT,
  THEME_CHANGE_EVENT,
  type ActionDetail,
  type ChromeContext,
  type ChromeTeardown,
  type Theme,
  type ThemeChangeDetail,
  type ThemeTokens,
  type TokenMap,
} from './types';

/** Attribute the active theme id is published on, for CSS and for tests. */
export const THEME_ATTRIBUTE = 'data-wm-theme';
/** Marks the element chrome mounts into. Set at an upstream seam. */
export const SHELL_ATTRIBUTE = 'data-wm-shell';
/** Marks the element a theme's shell chrome renders the dashboard into. */
export const CONTENT_ATTRIBUTE = 'data-wm-content';

/**
 * Attribute identifying an upstream panel host.
 *
 * This is UPSTREAM's own attribute, not one we add. SCOPE.md §4.2 budgeted a
 * seam to stamp `data-wm-panel` onto panel hosts; that seam turned out to be
 * unnecessary, because upstream already marks every panel with
 * `data-panel="<key>"` and reads it back in fourteen places (panel-layout,
 * MobilePanelNav, PanelTabBar, tv-mode, search-selection-dispatcher, ...).
 * Rule §4.4 — prefer a DOM hook over an upstream edit — applies directly.
 *
 * Kept as a constant so that if upstream ever renames it, the fix is this line
 * rather than a search across our tree. The value doubles as the panel key,
 * which is what the P3 context snapshot needs to name a panel to the LLM.
 */
export const PANEL_ATTRIBUTE = 'data-panel';

export const THEME_STORAGE_KEY = 'wm-theme';
export const DEFAULT_THEME_ID = 'default';

const TOKEN_STYLE_ID = 'wm-theme-tokens';
const STYLESHEET_LINK_ATTR = 'data-wm-theme-style';

/** Emits an action on the shared bus. Rail buttons and P3 voice both use it. */
export function dispatchAction(action: string, payload?: unknown): void {
  window.dispatchEvent(new CustomEvent<ActionDetail>(ACTION_EVENT, { detail: { action, payload } }));
}

export class ThemeEngine {
  private readonly registry = new Map<string, Theme>();
  private active: Theme | undefined;
  /** Teardowns for everything the active theme mounted, in mount order. */
  private teardowns: ChromeTeardown[] = [];
  private shellObserver: MutationObserver | null = null;
  private panelObserver: MutationObserver | null = null;
  /** Panel hosts the active theme's `panel` slot is currently mounted on. */
  private readonly mountedPanels = new WeakSet<HTMLElement>();

  constructor(private readonly doc: Document = document) {}

  register(...themes: Theme[]): void {
    for (const theme of themes) this.registry.set(theme.id, theme);
  }

  list(): Theme[] {
    return [...this.registry.values()];
  }

  get current(): Theme | undefined {
    return this.active;
  }

  /**
   * Applies the persisted theme, or `fallbackId` when there is none.
   *
   * Async because a theme's stylesheet is fetched on demand; callers that must
   * not block on the network (the boot seam) simply do not await it.
   */
  async init(fallbackId: string = DEFAULT_THEME_ID): Promise<void> {
    await this.apply(readStoredTheme() ?? fallbackId, { persist: false });
  }

  /**
   * Switch to `id`. Unknown ids fall back to the default theme rather than
   * throwing, so a stale persisted value or a mis-heard voice command degrades
   * to a readable dashboard.
   */
  async apply(id: string, options: { persist?: boolean } = {}): Promise<string> {
    const { persist = true } = options;
    const theme = this.registry.get(id) ?? this.registry.get(DEFAULT_THEME_ID);
    if (!theme) return DEFAULT_THEME_ID;
    if (this.active?.id === theme.id) return theme.id;

    const previous = this.active?.id ?? null;

    // Teardown first, and unconditionally: chrome must never outlive its theme.
    this.teardownChrome();
    this.removeStylesheet();

    this.writeTokens(theme);
    this.doc.documentElement.setAttribute(THEME_ATTRIBUTE, theme.id);
    this.active = theme;

    // Chrome mounts before the stylesheet resolves. The frame is styleless for
    // one frame on a cold switch, which is the right trade on a kiosk: the DOM
    // the dashboard renders into must exist before upstream looks for it.
    this.mountChrome(theme);
    this.watchShell(theme);
    this.warnOffTarget(theme);

    if (persist) writeStoredTheme(theme.id);
    this.emit({ previous, current: theme.id });

    await this.loadStylesheet(theme);
    return theme.id;
  }

  /** The element chrome mounts into. */
  shell(): HTMLElement | null {
    return this.doc.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`) ?? this.doc.body ?? null;
  }

  /**
   * Where the dashboard renders. A theme's shell chrome is required to leave a
   * `[data-wm-content]` element behind; without chrome this is the shell.
   */
  content(): HTMLElement | null {
    return this.doc.querySelector<HTMLElement>(`[${CONTENT_ATTRIBUTE}]`) ?? this.shell();
  }

  // ---------------------------------------------------------------- tokens

  /**
   * Rewrites (never appends to) the single engine-owned style element.
   *
   * Tokens go into a `[data-wm-theme="<id>"]` rule on `:root` rather than
   * inline styles: inline custom properties on `<html>` would be impossible for
   * a theme stylesheet to override, and harder to inspect.
   *
   * A theme with no tokens leaves the element empty rather than removing it, so
   * the node count stays constant across cycles.
   */
  private writeTokens(theme: Theme): void {
    const style = this.tokenStyleElement();
    const declarations = flattenTokens(theme.tokens);
    if (declarations.length === 0) {
      style.textContent = '';
      return;
    }
    const body = declarations.map(([name, value]) => `  ${name}: ${value};`).join('\n');
    style.textContent = `:root[${THEME_ATTRIBUTE}="${theme.id}"] {\n${body}\n}\n`;
  }

  private tokenStyleElement(): HTMLStyleElement {
    const existing = this.doc.getElementById(TOKEN_STYLE_ID);
    if (existing instanceof HTMLStyleElement) return existing;
    const style = this.doc.createElement('style');
    style.id = TOKEN_STYLE_ID;
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
    return style;
  }

  // ------------------------------------------------------------ stylesheet

  private async loadStylesheet(theme: Theme): Promise<void> {
    if (!theme.stylesheet) return;
    try {
      const mod = await theme.stylesheet();
      // The theme may have changed while the import was in flight.
      if (this.active?.id !== theme.id) return;
      const link = this.doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = mod.default;
      link.setAttribute(STYLESHEET_LINK_ATTR, theme.id);
      (this.doc.head ?? this.doc.documentElement).appendChild(link);
    } catch (error) {
      // Vite's preload helper rejects a CSS import with "Unable to preload CSS
      // for <url>" when the injected link errors, and an unconsumed rejection
      // surfaces as an unhandled error. Upstream hit exactly this with
      // happy-theme.css (see bootstrap/variant-theme.ts); same contract, kept
      // in our tree so we do not depend on the shape of an upstream export.
      report(`stylesheet failed to load for "${theme.id}"`, error);
    }
  }

  private removeStylesheet(): void {
    this.doc.querySelectorAll(`link[${STYLESHEET_LINK_ATTR}]`).forEach((link) => {
      link.remove();
    });
  }

  // ---------------------------------------------------------------- chrome

  private context(theme: Theme): ChromeContext {
    return { dispatch: dispatchAction, themeId: theme.id };
  }

  private mountChrome(theme: Theme): void {
    const chrome = theme.chrome;
    if (!chrome) return;
    const shell = this.shell();
    if (!shell) return;

    if (chrome.shell) {
      try {
        this.teardowns.push(chrome.shell(shell, this.context(theme)));
      } catch (error) {
        // A theme that cannot render its chrome must not take the dashboard
        // with it; tokens are already applied and upstream's UI is intact.
        report(`shell chrome failed to mount for "${theme.id}"`, error);
      }
    }

    if (chrome.panel) {
      this.mountPanels(theme);
      this.watchPanels(theme);
    }
  }

  private mountPanels(theme: Theme): void {
    const mount = theme.chrome?.panel;
    if (!mount) return;
    const root = this.content() ?? this.shell();
    if (!root) return;
    root.querySelectorAll<HTMLElement>(`[${PANEL_ATTRIBUTE}]`).forEach((host) => {
      if (this.mountedPanels.has(host)) return;
      try {
        const teardown = mount(host, this.context(theme));
        this.mountedPanels.add(host);
        this.teardowns.push(() => {
          this.mountedPanels.delete(host);
          teardown();
        });
      } catch (error) {
        report(`panel chrome failed to mount for "${theme.id}"`, error);
      }
    });
  }

  private teardownChrome(): void {
    this.shellObserver?.disconnect();
    this.shellObserver = null;
    this.panelObserver?.disconnect();
    this.panelObserver = null;

    // Reverse order: the shell mounted first and must come out last, or a panel
    // teardown would be reaching into a subtree the shell already reclaimed.
    const pending = this.teardowns.reverse();
    this.teardowns = [];
    for (const teardown of pending) {
      try {
        teardown();
      } catch (error) {
        report('chrome teardown failed', error);
      }
    }
  }

  /**
   * Re-mounts chrome after upstream rebuilds the shell's contents.
   *
   * `bootThemes()` runs before `new App('app')`, so chrome mounted at boot is
   * wiped by upstream's first render — and again by any later re-render, since
   * the dashboard rebuilds panel markup by assigning innerHTML. Watching for it
   * keeps the theme layer working without spending an upstream seam on a
   * post-render hook, and without depending on upstream's render timing.
   */
  private watchShell(theme: Theme): void {
    if (!theme.chrome?.shell || typeof MutationObserver === 'undefined') return;
    const shell = this.shell();
    if (!shell) return;

    const observer = new MutationObserver(() => {
      if (this.active?.id !== theme.id) return;
      // Chrome is intact if its content well is still in the document.
      if (shell.querySelector(`[${CONTENT_ATTRIBUTE}]`)) return;
      // Drop the stale teardowns first: they close over nodes upstream has
      // already discarded, so running them would re-attach detached markup.
      this.teardowns = [];
      this.mountChrome(theme);
    });
    observer.observe(shell, { childList: true, subtree: false });
    this.shellObserver = observer;
  }

  /** Upstream adds and removes panels at runtime; the panel slot follows. */
  private watchPanels(theme: Theme): void {
    if (typeof MutationObserver === 'undefined') return;
    const root = this.content() ?? this.shell();
    if (!root) return;
    const observer = new MutationObserver(() => {
      if (this.active?.id !== theme.id) return;
      this.mountPanels(theme);
    });
    observer.observe(root, { childList: true, subtree: true });
    this.panelObserver = observer;
  }

  // ----------------------------------------------------------------- misc

  private warnOffTarget(theme: Theme): void {
    if (!theme.targets?.length || typeof window === 'undefined') return;
    const { innerWidth: w, innerHeight: h } = window;
    if (!w || !h) return;
    if (theme.targets.some((t) => t.width === w && t.height === h)) return;
    const tuned = theme.targets.map((t) => `${t.width}x${t.height}`).join(', ');
    report(`"${theme.id}" is tuned for ${tuned}; running at ${w}x${h}`, 'off-target viewport');
  }

  private emit(detail: ThemeChangeDetail): void {
    this.doc.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_CHANGE_EVENT, { detail }));
  }
}

/**
 * Expands the grouped token maps into CSS declarations.
 *
 * The `--wm-*` groups are our own semantic vocabulary. `upstream` is emitted
 * verbatim so it lands on the properties upstream's stylesheet actually reads.
 */
function flattenTokens(tokens: ThemeTokens): [string, string][] {
  const out: [string, string][] = [];
  const push = (prefix: string, map: TokenMap | undefined) => {
    for (const [key, value] of Object.entries(map ?? {})) out.push([`${prefix}${key}`, value]);
  };
  push('--wm-color-', tokens.color);
  push('--wm-font-', tokens.font);
  push('--wm-space-', tokens.space);
  push('--wm-radius-', tokens.radius);
  push('--wm-', tokens.extra);
  push('--', tokens.upstream);
  return out;
}

export function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Private mode, blocked storage, or a kiosk profile with no writable
    // origin store. Not an error: the default theme is a correct fallback.
    return null;
  }
}

export function writeStoredTheme(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort; the session still renders the chosen theme.
  }
}

function report(message: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  // console is deliberate: an unattended kiosk has no other operator channel.
  console.warn(`[wm-themes] ${message}: ${reason}`);
}

/** The process-wide registry. Themes register into this at import time. */
export const themes = new ThemeEngine();
