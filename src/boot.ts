/**
 * Composition root for everything this fork adds.
 *
 * The upstream seam in `src/main.ts` calls exactly one function, and this is
 * it. There are now two subsystems — themes and voice — and something has to
 * wire them together without either importing the other; putting that here
 * keeps `src/themes/` unaware of the sidecar and `src/voice/` unaware of the
 * rail that drives it.
 *
 * The seam stays two lines. Composing here rather than in `main.ts` is what
 * keeps it that way as more subsystems arrive (P3 adds `src/context/`).
 */

import { bootThemes } from './themes';
import { bootVoice } from './voice';

let booted = false;

/**
 * Boots the theme layer and the voice layer.
 *
 * Idempotent, and never throws. This runs inside upstream's startup path on an
 * unattended kiosk, where an exception would cost the whole dashboard for the
 * sake of its colour scheme or a sidecar that may not be deployed.
 *
 * Returns a promise that settles once the active theme's stylesheet has
 * loaded; the seam deliberately does not await it.
 */
export function bootApp(): Promise<void> {
  if (booted) return Promise.resolve();
  booted = true;

  try {
    // Voice first, so the port exists before the action registry is built and
    // `voice.ptt` can reach a real client rather than a stub.
    const voice = bootVoice({ playSound: (slot) => playThemeSound(slot) });
    return bootThemes({ voice });
  } catch (error) {
    // console is deliberate: an unattended kiosk has no other operator channel.
    console.warn('[wm-boot] startup failed, dashboard continues:', error);
    return Promise.resolve();
  }
}

/**
 * Plays a themed sound slot.
 *
 * Resolved lazily through the theme layer rather than held as a reference: the
 * active theme decides what each slot sounds like, and it can change after
 * boot.
 */
function playThemeSound(slot: 'wake' | 'accept' | 'change' | 'deny' | 'alert'): void {
  void import('./themes').then((themes) => themes.playSound(slot));
}

/** Test seam. */
export function resetBootForTests(): void {
  booted = false;
}
