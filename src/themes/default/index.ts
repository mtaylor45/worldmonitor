import type { Theme } from '../types';

/**
 * The upstream World Monitor look, expressed as a theme.
 *
 * It declares NO tokens, no stylesheet and no chrome. That is deliberate, and
 * it is a departure from this file's scaffold, which carried a placeholder
 * palette awaiting extraction from upstream's CSS.
 *
 * The P0 acceptance criterion is that `default` renders unmodified upstream
 * pixel-for-pixel under screenshot diff, and the only way to guarantee that
 * indefinitely is to contribute zero declarations — then the diff is
 * structurally exact rather than dependent on a transcription staying accurate.
 *
 * Re-declaring upstream's `:root` values here passes the screenshot diff on the
 * day it is written and then silently diverges the first time upstream retunes
 * a colour, which is a rendering bug no test in this repo would catch. Several
 * of those values carry comments in `main.css` recording exactly such a retune.
 *
 * The extraction was still done. It lives in `src/themes/tokens.ts` as a
 * documented reference for theme authors — you cannot write a theme without
 * knowing which properties exist — and a drift test compares it against
 * `main.css` on every run. See `docs/P0-PORT.md` for the full argument.
 *
 * Consequence worth stating plainly: `default` also inherits upstream's own
 * `data-theme` light/dark and `data-variant` behaviour, because it does not
 * intervene in the cascade at all. That is the intended reading of "unmodified".
 */
export const defaultTheme: Theme = {
  id: 'default',
  name: 'World Monitor',
  description: 'The upstream dashboard appearance.',

  // Empty rather than absent: the engine emits an empty rule, so the node count
  // stays constant across theme cycles while nothing reaches the cascade.
  tokens: { color: {}, font: {}, space: {}, radius: {} },

  // No chrome: the default theme uses upstream's own DOM structure untouched.
  // This is what makes the engine safe — a theme with no chrome is a pure
  // restyle, and the shell mount never runs.
  chrome: undefined,
};
