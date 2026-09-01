import type { ThemeDefinition } from '../types';

/**
 * The identity theme: upstream, untouched.
 *
 * It deliberately declares NO tokens, no stylesheet and no chrome. The P0
 * acceptance criterion is that `default` renders unmodified upstream
 * pixel-for-pixel under screenshot diff, and the only way to guarantee that
 * indefinitely is to contribute zero declarations — then the diff is
 * structurally exact rather than dependent on a transcription staying accurate.
 *
 * The obvious alternative, re-declaring upstream's `:root` values here, was
 * rejected: it passes the screenshot diff on the day it is written and then
 * silently diverges the first time upstream retunes a colour, which is a
 * rendering bug that no test in this repo would catch. The extracted values
 * still exist, as a documented reference for theme authors and as the basis of
 * the drift check, in `src/themes/tokens.ts`.
 *
 * Consequence worth stating plainly: `default` also inherits upstream's own
 * `data-theme` light/dark and `data-variant` behaviour, because it does not
 * intervene in the cascade at all. That is the intended reading of "unmodified".
 */
export const defaultTheme: ThemeDefinition = {
  id: 'default',
  label: 'Default',
};
