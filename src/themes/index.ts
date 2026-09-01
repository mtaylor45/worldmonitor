/**
 * Public entry point for the theme layer.
 *
 * Upstream reaches this module at exactly one seam: `bootThemes()` from
 * `src/main.ts`. The other seam is a DOM attribute and contains no code.
 * See docs/UPSTREAM-DIFF.md.
 */

import { DEFAULT_THEME_ID, themes } from './engine';
import { createActions, installActions, type ActionRouter } from './actions';
import { createSoundPlayer, type SoundPlayer } from './sounds';
import { defaultTheme } from './default';
import { lcars, lcarsBright } from './lcars';

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
export {
  FOCUS_ATTRIBUTE,
  createActions,
  installActions,
  panelKeys,
  parseAction,
  type ActionDefinition,
  type ActionRouter,
} from './actions';
export { createSoundPlayer, type SoundPlayer } from './sounds';
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
let router: ActionRouter | null = null;
let sounds: SoundPlayer | null = null;

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
    // Sounds follow the active theme: a slot name is all any caller knows, and
    // the theme decides what it sounds like.
    sounds = createSoundPlayer();
    themes.onChange((theme) => sounds?.load(theme));

    router = installActions(
      createActions({
        set: (id) => void themes.apply(id),
        cycle: () => {
          const all = themes.list();
          const i = all.findIndex((t) => t.id === themes.current?.id);
          void themes.apply(all[(i + 1) % all.length]?.id ?? DEFAULT_THEME_ID);
        },
        ids: () => themes.list().map((t) => t.id),
      }),
      // Audible outcome for every dispatch: the refusal tone on a command that
      // could not be carried out is what stops a dead rail button reading as a
      // broken panel.
      (action, handled) => {
        if (!handled) return sounds?.play('deny');
        sounds?.play(action.startsWith('theme.') ? 'change' : 'accept');
      },
    );

    const pinned = themeFromUrl();
    if (pinned) return themes.apply(pinned, { persist: false }).then(() => undefined);
    return themes.init(DEFAULT_THEME_ID);
  } catch (error) {
    // console is deliberate: an unattended kiosk has no other operator channel.
    console.warn('[wm-themes] boot failed, staying on upstream default:', error);
    return Promise.resolve();
  }
}

/** The action router, once `bootThemes()` has run. P3's tool executor uses it. */
export function getActionRouter(): ActionRouter | null {
  return router;
}

/** Test seam: lets a suite boot the module-level listener wiring again. */
export function resetThemeBootForTests(): void {
  router?.dispose();
  router = null;
  sounds?.dispose();
  sounds = null;
  booted = false;
}
