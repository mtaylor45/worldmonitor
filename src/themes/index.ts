/**
 * Public entry point for the theme layer.
 *
 * Upstream reaches this module at exactly one seam: `bootThemes()` from
 * `src/main.ts`. The other seam is a DOM attribute and contains no code.
 * See docs/UPSTREAM-DIFF.md.
 */

import { DEFAULT_THEME_ID, themes } from './engine';
import { defaultTheme } from './default';
import { lcars, lcarsBright } from './lcars';
import { ACTION_EVENT, type ActionDetail } from './types';

export {
  CONTENT_ATTRIBUTE,
  DEFAULT_THEME_ID,
  PANEL_ATTRIBUTE,
  SHELL_ATTRIBUTE,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  ThemeEngine,
  dispatchAction,
  themes,
} from './engine';
export { ACTION_EVENT, THEME_CHANGE_EVENT } from './types';
export type {
  ActionDetail,
  ChromeContext,
  ChromeMount,
  ChromeTeardown,
  Theme,
  ThemeChangeDetail,
  ThemeChrome,
  ThemeTokens,
  TokenMap,
} from './types';

themes.register(defaultTheme, lcars, lcarsBright);

let booted = false;

/**
 * Reads the URL override for a theme, e.g. `?wm-theme=lcars`.
 *
 * Exists for the kiosk: the `cage` autostart unit pins a theme in the launch
 * URL, so a panel that is never interactively configured still comes up in the
 * right skin, and a wedged persisted value can be overridden without a
 * keyboard. Does not persist — a URL is a one-shot instruction, and writing it
 * to storage would make a debugging query string sticky.
 */
function themeFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('wm-theme');
  } catch {
    return null;
  }
}

/**
 * Call once during app boot, before the dashboard renders.
 *
 *   import { bootThemes } from './themes';
 *   bootThemes();
 *
 * Wires the two actions the frame emits — `theme.cycle` from the rail button
 * and `theme.set` from the voice layer — into the same handler, so speech and
 * touch go through one code path.
 *
 * Returns a promise that settles once the active theme's stylesheet has
 * loaded, but the seam deliberately does not await it: tokens, chrome and the
 * theme attribute are all in place synchronously, and blocking upstream's
 * startup on a stylesheet fetch would delay the dashboard for a kiosk that has
 * already painted its frame.
 *
 * Idempotent, and never throws. This runs inside upstream's startup path on an
 * unattended kiosk, where an exception here would cost the whole dashboard for
 * the sake of its colour scheme.
 */
export function bootThemes(): Promise<void> {
  if (booted) return Promise.resolve();
  booted = true;

  try {
    window.addEventListener(ACTION_EVENT, (ev) => {
      const { action, payload } = (ev as CustomEvent<ActionDetail>).detail ?? {};

      if (action === 'theme.cycle') {
        const all = themes.list();
        const i = all.findIndex((t) => t.id === themes.current?.id);
        void themes.apply(all[(i + 1) % all.length]?.id ?? DEFAULT_THEME_ID);
      }

      if (action === 'theme.set' && typeof payload === 'string') {
        if (themes.list().some((t) => t.id === payload)) void themes.apply(payload);
      }
    });

    const pinned = themeFromUrl();
    if (pinned) return themes.apply(pinned, { persist: false }).then(() => undefined);
    return themes.init(DEFAULT_THEME_ID);
  } catch (error) {
    // console is deliberate: an unattended kiosk has no other operator channel.
    console.warn('[wm-themes] boot failed, staying on upstream default:', error);
    return Promise.resolve();
  }
}

/** Test seam: lets a suite boot the module-level listener wiring again. */
export function resetThemeBootForTests(): void {
  booted = false;
}
