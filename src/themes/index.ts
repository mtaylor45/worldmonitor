/**
 * Public entry point for the theme layer.
 *
 * Upstream reaches this module at exactly one seam: `bootThemes()` from
 * `src/main.ts`. The other two seams are DOM attributes and contain no code.
 * See docs/UPSTREAM-DIFF.md.
 */

import {
  DEFAULT_THEME_ID,
  PANEL_ATTRIBUTE,
  SHELL_ATTRIBUTE,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  ThemeEngine,
  readStoredTheme,
} from './engine';
import { defaultTheme } from './default';
import { lcarsBrightTheme, lcarsTheme } from './lcars';
import { THEME_CHANGE_EVENT, type ThemeChangeDetail, type ThemeDefinition, type ThemeId } from './types';

export {
  DEFAULT_THEME_ID,
  PANEL_ATTRIBUTE,
  SHELL_ATTRIBUTE,
  THEME_ATTRIBUTE,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  ThemeEngine,
};
export type { ThemeChangeDetail, ThemeDefinition, ThemeId };

let engine: ThemeEngine | null = null;

/** The themes registered at boot, in switcher order. */
export const BUILTIN_THEMES: readonly ThemeDefinition[] = [
  defaultTheme,
  lcarsTheme,
  lcarsBrightTheme,
];

/**
 * Reads the URL override for a theme, e.g. `?wm-theme=lcars`.
 *
 * Exists for the kiosk: the `cage` autostart unit pins a theme in the launch
 * URL, so a panel that is never interactively configured still comes up in the
 * right skin, and a wedged persisted value can be overridden without a
 * keyboard. Does not persist — a URL is a one-shot instruction, and writing it
 * to storage would make a debugging query string sticky.
 */
function themeFromUrl(): ThemeId | null {
  try {
    return new URLSearchParams(window.location.search).get('wm-theme');
  } catch {
    return null;
  }
}

/**
 * Initialise the theme layer and apply the persisted (or URL-pinned) theme.
 *
 * Idempotent: a second call returns the existing engine rather than
 * re-registering, so an accidental double-invocation at the seam is harmless.
 *
 * Never throws. This runs inside upstream's startup path on an unattended
 * kiosk, where an exception here would cost the whole dashboard for the sake
 * of its colour scheme.
 */
export function bootThemes(): ThemeEngine {
  if (engine) return engine;
  const created = new ThemeEngine();
  engine = created;

  try {
    for (const theme of BUILTIN_THEMES) created.register(theme);

    const url = themeFromUrl();
    if (url) {
      created.apply(url, { persist: false });
    } else {
      created.apply(readStoredTheme() ?? DEFAULT_THEME_ID);
    }
  } catch (error) {
    // console is deliberate: an unattended kiosk has no other operator channel.
    console.warn('[wm-themes] boot failed, staying on upstream default:', error);
  }

  return created;
}

/** The booted engine, or null if `bootThemes()` has not run. */
export function getThemeEngine(): ThemeEngine | null {
  return engine;
}

/**
 * Switch themes. The `theme.set` action in the P3 registry resolves to this,
 * so rail button and voice command share one implementation.
 */
export function setTheme(id: ThemeId): ThemeId {
  return (engine ?? bootThemes()).apply(id);
}

/** Advance to the next registered theme. Backs the rail's `theme.cycle`. */
export function cycleTheme(): ThemeId {
  const active = engine ?? bootThemes();
  const ids = active.list().map((theme) => theme.id);
  if (ids.length === 0) return DEFAULT_THEME_ID;
  const index = ids.indexOf(active.current());
  return active.apply(ids[(index + 1) % ids.length] ?? DEFAULT_THEME_ID);
}

/** Test seam: drops the module-level engine so a suite can boot a fresh one. */
export function resetThemeEngineForTests(): void {
  engine = null;
}
