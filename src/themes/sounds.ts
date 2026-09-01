/**
 * UI sound playback for the active theme.
 *
 * A theme declares a `sounds` map from slot name to URL; this module preloads
 * those and plays them by slot. Nothing outside here knows a filename — the
 * caller asks for `deny` and the active theme decides what that sounds like,
 * which is what lets a second theme ship a different sound set for free.
 *
 * Six preloaded `Audio` objects is the whole implementation. Howler is not
 * worth its weight for this (docs/LCARS-ASSETS.md).
 */

import type { Theme, ThemeSoundSlot } from './types';

/**
 * The raw files are loud — the source repo's own guidance is 0.15–0.2, and on a
 * wall panel in a living room the top of that range is already assertive.
 * `alert` and `deny` sit slightly higher because they must cut through.
 */
const VOLUME: Record<ThemeSoundSlot, number> = {
  wake: 0.15,
  accept: 0.15,
  change: 0.15,
  deny: 0.2,
  alert: 0.2,
};

export interface SoundPlayer {
  play(slot: ThemeSoundSlot): void;
  /** Swap in a different theme's sound set. Safe to call with a theme that has none. */
  load(theme: Theme | undefined): void;
  /** Silence everything — used when a theme is torn down. */
  dispose(): void;
}

/**
 * Browsers block audio until the user has interacted with the page. A kiosk
 * boots untouched and stays that way, so the first sounds would throw
 * NotAllowedError forever. We keep playback silent-but-harmless until then and
 * unlock on the first real interaction, which on this dashboard is a rail press.
 */
function installUnlock(onUnlock: () => void): () => void {
  let done = false;
  const unlock = () => {
    if (done) return;
    done = true;
    onUnlock();
  };
  const events = ['pointerdown', 'keydown'] as const;
  for (const type of events) window.addEventListener(type, unlock, { once: true, passive: true });
  return () => {
    for (const type of events) window.removeEventListener(type, unlock);
  };
}

export function createSoundPlayer(): SoundPlayer {
  const clips = new Map<ThemeSoundSlot, HTMLAudioElement>();
  let unlocked = false;
  const removeUnlock = installUnlock(() => {
    unlocked = true;
  });

  const load = (theme: Theme | undefined): void => {
    for (const clip of clips.values()) {
      clip.pause();
      // Dropping the src lets the browser release the decoded buffer rather
      // than holding every theme's sound set for the life of the session.
      clip.removeAttribute('src');
      clip.load();
    }
    clips.clear();
    if (!theme?.sounds) return;

    for (const [slot, url] of Object.entries(theme.sounds)) {
      if (!url) continue;
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = VOLUME[slot as ThemeSoundSlot] ?? 0.15;
      clips.set(slot as ThemeSoundSlot, audio);
    }
  };

  const play = (slot: ThemeSoundSlot): void => {
    if (!unlocked) return;
    const clip = clips.get(slot);
    if (!clip) return;
    try {
      // Rewind rather than allocate: rail presses can arrive faster than a
      // clip finishes, and a new Audio per press leaks under a stuck key.
      clip.currentTime = 0;
      // Autoplay policy still rejects sometimes; a missed beep is not an error
      // worth surfacing on a display nobody is sitting in front of.
      void clip.play().catch(() => undefined);
    } catch {
      // Some browsers throw on currentTime before metadata has loaded.
    }
  };

  return {
    play,
    load,
    dispose: () => {
      removeUnlock();
      load(undefined);
    },
  };
}
