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

import { CHROME_MOUNT_EVENT, bootThemes, getActionRouter } from './themes';
import { startContextPublisher } from './context';
import { bootVoice } from './voice';
import { applySurface, currentSurface, detectSurface, openBus } from './surface';
import { startPages } from './pages/controller';
import { PAGES } from './pages';
import { layerState } from './themes/actions';
import {
  markActivePage,
  markAvailablePages,
  markLayerState,
  syncNavLayers,
} from './themes/lcars/nav';

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
    // Surface FIRST, before anything reads it. The theme's chrome branches on
    // it at mount time — a rail on a 400px-tall dashboard, or a console on the
    // wrong display, is not something that can be corrected afterwards without
    // a full re-mount.
    applySurface(detectSurface());

    // Voice first, so the port exists before the action registry is built and
    // `voice.ptt` can reach a real client rather than a stub.
    const voice = bootVoice({
      playSound: (slot) => playThemeSound(slot),

      // P3's second validation. The router is the SAME registry the rail
      // dispatches through, so an action the sidecar asks for goes through
      // exactly the checks a button press does - and one the registry does not
      // know is refused here even though the sidecar already accepted it.
      //
      // Resolved lazily: the router does not exist until bootThemes() below.
      performAction: (action, argument) =>
        getActionRouter()?.handle(action, argument) ?? false,
    });

    // One bus for both displays, shared by the page controller and the remote
    // action port below. Opening two would work but would have each window
    // ignoring only its own echo per-bus, so a message from bus A would look
    // foreign to bus B in the same window and be acted on twice.
    const bus = openBus();
    const surface = currentSurface();

    // Pages before themes, so `page.set` is already in the registry that the
    // console's buttons dispatch through.
    const pages = startPages({
      bus,
      onChange: (id, available) => {
        markActivePage(id);
        markAvailablePages(available);
      },
    });

    // The lit page button lives ON the chrome, so it dies with every re-mount —
    // and upstream re-mounts constantly, rebuilding the dashboard by assigning
    // `innerHTML`. Measured: the console lit OPS at 924ms and was dark again by
    // 990ms, because the only hook was a theme change and a re-mount is not
    // one. `CHROME_MOUNT_EVENT` fires on every mount, which is what this needs.
    //
    // Re-applied without broadcasting: nothing about the shared page actually
    // changed, and telling the other display otherwise would make a repaint on
    // one panel look like a navigation on both.
    document.addEventListener(CHROME_MOUNT_EVENT, () => {
      pages.set(pages.current(), { broadcast: false });
      if (surface === 'nav') syncNavLayers();
    });

    // The map renders its layer controls seconds after chrome mounts, so the
    // console's layer row is empty at build time and there is no event to say
    // when it stops being. Polled rather than observed: a subtree observer on
    // a dashboard that repaints several times a second costs far more than
    // eleven cheap checks, and the layer set is fixed once the map has drawn —
    // so this stops the moment it succeeds, and gives up rather than polling a
    // build that has no map at all.
    if (surface === 'nav') {
      let attempts = 0;
      const poll = window.setInterval(() => {
        if (syncNavLayers()) {
          window.clearInterval(poll);
          // The buttons exist now, so ask what they should be showing. The two
          // panels boot independently: without a request, a console that came
          // up second would wait for the next change before it knew anything.
          bus.post({ type: 'request', what: 'layers' });
          return;
        }
        if ((attempts += 1) > 10) window.clearInterval(poll);
      }, 1_500);

      bus.subscribe((message) => {
        if (message.type === 'layers') markLayerState(message.state);
      });
    }

    const themes = bootThemes({
      voice,

      // Only the console forwards. Everywhere else this window IS the
      // dashboard, so `target: 'dashboard'` means "run it here" and a remote
      // port would send the action to a display that does not exist.
      ...(surface === 'nav'
        ? {
            remote: {
              dispatch: (action: string, argument: string | undefined) =>
                bus.post({ type: 'action', action, ...(argument ? { argument } : {}) }),
            },
          }
        : {}),
      pages: {
        set: (id) => pages.set(id),
        next: () => pages.next(),
        current: () => pages.current(),
        ids: () => PAGES.map((page) => page.id),
        pageFor: (key) => pages.pageFor(key),
      },
    });

    // The dashboard performs what the console asked for. Routed through the
    // SAME registry a local dispatch uses, so an action arriving over the bus
    // gets exactly the checks a button press does — and the dashboard has no
    // remote port of its own, so nothing is forwarded back and the two cannot
    // volley.
    if (surface !== 'nav') {
      const report = () => bus.post({ type: 'layers', state: layerState() });

      bus.subscribe((message) => {
        if (message.type === 'request' && message.what === 'layers') return void report();
        if (message.type !== 'action') return;
        getActionRouter()?.handle(message.action, message.argument);
        // Reported after performing, not instead of: the map may refuse the
        // toggle, turn a conflicting layer off, or hit its concurrent limit,
        // and what it actually did is the only thing worth sending.
        report();
      });

      // Also when the map changes layers on its own — a conflicting layer
      // being dropped, or the user touching the dashboard directly. Watched
      // rather than polled because it is an attribute filter on one subtree,
      // which is cheap, unlike observing a dashboard that repaints constantly.
      startLayerWatch(report);
    }

    // The console shows no data, so it publishes no snapshot: the model would
    // be told the dashboard has no panels, which is true of this window and
    // false of the system. The dashboard window publishes for both.
    if (surface === 'nav') return themes;

    // The model reads this snapshot and never the DOM (SCOPE.md §3).
    startContextPublisher({
      send: (snapshot) => voice.sendContext(snapshot),
      // Read from the live registry rather than captured: the action list is
      // generated, and a copy taken at boot would drift the moment one is added.
      actions: () => getActionRouter()?.actionNames() ?? [],
    });

    return themes;
  } catch (error) {
    // console is deliberate: an unattended kiosk has no other operator channel.
    console.warn('[wm-boot] startup failed, dashboard continues:', error);
    return Promise.resolve();
  }
}

/**
 * Reports layer changes the map makes on its own.
 *
 * The toggles do not exist when this runs — the map renders them seconds
 * later — so this waits for them, then watches their `class` attribute, which
 * is where upstream records which layers are lit.
 */
function startLayerWatch(report: () => void): void {
  if (typeof MutationObserver !== 'function') return;

  let attempts = 0;
  const poll = window.setInterval(() => {
    const host = document.querySelector('.layer-toggles');
    if (!host) {
      if ((attempts += 1) > 10) window.clearInterval(poll);
      return;
    }
    window.clearInterval(poll);

    let pending = 0;
    new MutationObserver(() => {
      // Coalesced: toggling one layer can restyle several at once when the
      // map drops a conflicting one, and that is one change to report.
      window.clearTimeout(pending);
      pending = window.setTimeout(report, 120);
    }).observe(host, { attributes: true, attributeFilter: ['class'], subtree: true });

    report();
  }, 1_500);
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
