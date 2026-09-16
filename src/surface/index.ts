/**
 * Which physical display this window is, and how the two stay in sync.
 *
 * The kiosk is now two panels driven by one machine (SCOPE.md §2):
 *
 *   dashboard   2U  1280x400   the data. No rail — navigation moved off it.
 *   nav         1U  1424x280   the control console. Pages, voice, status.
 *   panel           1280x720   the original single-display layout, kept as the
 *                              fallback when only one output is connected and
 *                              as the target you develop against on a laptop.
 *
 * **They talk over `BroadcastChannel`, not the sidecar.** The sidecar already
 * fans out to every connected client and would have worked, but routing page
 * selection through it would mean the navigation display goes dead whenever
 * the voice backend is down — and the whole discipline of this fork is that
 * every layer degrades to nothing rather than taking the dashboard with it.
 * `BroadcastChannel` is same-origin, same-browser, and needs no server at all.
 * Voice still drives pages: it dispatches the same action a touch does.
 *
 * Both windows are the same origin under one Chromium profile, which is what
 * makes this work. If that ever stops being true, the `storage`-event fallback
 * below still carries state, because a `localStorage` write is visible to
 * every other window of the origin.
 */

/** Ours. Set on `<html>` before the theme applies, read by `lcars.css`. */
export const SURFACE_ATTRIBUTE = 'data-wm-surface';

export const SURFACES = ['panel', 'dashboard', 'nav'] as const;
export type Surface = (typeof SURFACES)[number];

export const DEFAULT_SURFACE: Surface = 'panel';

/** Channel name. Namespaced so it cannot collide with anything upstream adds. */
const CHANNEL = 'wm-surface';
/** Fallback key. Written only when `BroadcastChannel` is unavailable. */
const FALLBACK_KEY = 'wm-surface-bus';

/**
 * Viewport heights that identify a surface when nothing is pinned.
 *
 * A guess, but a well-conditioned one: the three targets are 280, 400 and 720
 * pixels tall, so the thresholds sit in wide gaps rather than near a boundary.
 * The pin is still what the kiosk uses — inference exists so that dragging a
 * window onto the nav display during development does the obvious thing.
 */
const NAV_MAX_HEIGHT = 320;
const DASHBOARD_MAX_HEIGHT = 520;

/** The page both displays should be showing. */
export interface SurfacePageMessage {
  type: 'page';
  id: string;
  /** Set by the sender so a window ignores its own echo. */
  from: string;
}

/**
 * An action the OTHER display should perform.
 *
 * The console is a control surface for a dashboard in a different window, and
 * a different window is a different DOM. Every action that manipulates the
 * dashboard — focusing a panel, focusing the map, toggling a map layer — would
 * otherwise run against the console's own parked copy and do nothing anyone
 * can see. That is not hypothetical: it is what the GLOBE button did.
 */
export interface SurfaceActionMessage {
  type: 'action';
  action: string;
  argument?: string;
  from: string;
}

export type SurfaceMessage = SurfacePageMessage | SurfaceActionMessage;

/**
 * A message as a caller writes it — the sender stamps `from` itself.
 *
 * Spelled as a union of Omits rather than `Omit<SurfaceMessage, 'from'>`,
 * because `Omit` collapses a union into one object with the shared keys, which
 * would accept a page id on an action and reject a valid one.
 */
export type OutgoingMessage =
  | Omit<SurfacePageMessage, 'from'>
  | Omit<SurfaceActionMessage, 'from'>;

function isSurface(value: unknown): value is Surface {
  return typeof value === 'string' && (SURFACES as readonly string[]).includes(value);
}

/**
 * The surface this window is rendering.
 *
 * A URL pin wins, exactly as `?wm-theme=` does and for the same reason: a
 * kiosk display has no keyboard, so its identity has to come from how it was
 * launched rather than from storage that could wedge.
 */
export function detectSurface(win: Window = window): Surface {
  try {
    const pinned = new URLSearchParams(win.location.search).get('wm-surface');
    if (isSurface(pinned)) return pinned;
  } catch {
    // A sandboxed frame can throw on location access. Fall through to size.
  }

  const height = win.innerHeight || 0;
  if (height > 0 && height <= NAV_MAX_HEIGHT) return 'nav';
  if (height > 0 && height <= DASHBOARD_MAX_HEIGHT) return 'dashboard';
  return DEFAULT_SURFACE;
}

/** Stamps the surface onto `<html>` so the stylesheet can key off it. */
export function applySurface(surface: Surface, doc: Document = document): void {
  doc.documentElement.setAttribute(SURFACE_ATTRIBUTE, surface);
}

export function currentSurface(doc: Document = document): Surface {
  const value = doc.documentElement.getAttribute(SURFACE_ATTRIBUTE);
  return isSurface(value) ? value : DEFAULT_SURFACE;
}

export interface SurfaceBus {
  /** Tells the other display. Returns false when nothing could be sent. */
  post(message: OutgoingMessage): boolean;
  /** Registers a listener. Returns its own teardown. */
  subscribe(handler: (message: SurfaceMessage) => void): () => void;
  close(): void;
  /** This window's id, so a sender can recognise its own echo. */
  readonly id: string;
}

interface BusOptions {
  win?: Window;
  /** Injected for tests, and so the fallback can be exercised deliberately. */
  channelFactory?: (name: string) => BroadcastChannel | null;
  id?: string;
}

/**
 * Opens the cross-display bus.
 *
 * Never throws. A display that cannot reach its sibling still works on its
 * own — the dashboard keeps showing whatever page it was on, and the nav
 * console keeps lighting the button it last selected. Two panels that have
 * lost touch with each other is a degraded state; a panel that threw during
 * boot is a black screen.
 */
export function openBus(options: BusOptions = {}): SurfaceBus {
  const win = options.win ?? window;
  const id = options.id ?? Math.random().toString(36).slice(2);
  const handlers = new Set<(message: SurfaceMessage) => void>();

  let channel: BroadcastChannel | null = null;
  try {
    // Read off the window rather than the global so a test can supply one, and
    // typed loosely because `lib.dom` does not put it on the Window interface.
    const Channel = (win as unknown as { BroadcastChannel?: typeof BroadcastChannel })
      .BroadcastChannel;
    channel = options.channelFactory
      ? options.channelFactory(CHANNEL)
      : typeof Channel === 'function'
        ? new Channel(CHANNEL)
        : null;
  } catch {
    channel = null;
  }

  function deliver(raw: unknown): void {
    const message = parse(raw);
    // A window hears its own posts on the storage fallback, and on some
    // engines through the channel too. Dropping the echo here means callers
    // never have to think about it.
    if (!message || message.from === id) return;
    for (const handler of [...handlers]) {
      try {
        handler(message);
      } catch (error) {
        report(error);
      }
    }
  }

  if (channel) {
    channel.onmessage = (event: MessageEvent) => deliver(event.data);
  }

  // Registered even when the channel opened: it costs nothing, and it is the
  // only path that survives a browser where BroadcastChannel is disabled by
  // policy but storage is not.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== FALLBACK_KEY || !event.newValue) return;
    try {
      deliver(JSON.parse(event.newValue));
    } catch {
      // A malformed write from another origin-sharing tab is not our problem.
    }
  };
  try {
    win.addEventListener('storage', onStorage);
  } catch {
    // Non-throwing by contract.
  }

  return {
    id,

    post(message) {
      const full = { ...message, from: id } as SurfaceMessage;
      let sent = false;
      try {
        channel?.postMessage(full);
        sent = channel !== null;
      } catch (error) {
        report(error);
      }
      try {
        // PAGE messages only. The write doubles as the last-known page for a
        // display that boots after its sibling, which is the normal case when
        // one panel powers on first — and an action is a one-shot instruction,
        // so persisting one would have it replayed at every later boot.
        if (full.type === 'page') {
          win.localStorage?.setItem(FALLBACK_KEY, JSON.stringify(full));
          sent = true;
        }
      } catch {
        // Private mode, blocked storage. The channel may still have carried it.
      }
      return sent;
    },

    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    close() {
      handlers.clear();
      try {
        win.removeEventListener('storage', onStorage);
      } catch {
        /* nothing to undo */
      }
      try {
        channel?.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/**
 * The last page either display selected, if one is recorded.
 *
 * Read at boot so a panel that comes up second joins on the page its sibling
 * is already showing, rather than resetting both to the first page.
 */
export function lastKnownPage(win: Window = window): string | null {
  try {
    const raw = win.localStorage?.getItem(FALLBACK_KEY);
    if (!raw) return null;
    const message = parse(JSON.parse(raw));
    return message?.type === 'page' ? message.id : null;
  } catch {
    return null;
  }
}

function parse(raw: unknown): SurfaceMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const from = String(value.from ?? '');

  if (value.type === 'page') {
    return typeof value.id === 'string' && value.id
      ? { type: 'page', id: value.id, from }
      : null;
  }

  if (value.type === 'action') {
    if (typeof value.action !== 'string' || !value.action) return null;
    return {
      type: 'action',
      action: value.action,
      ...(typeof value.argument === 'string' ? { argument: value.argument } : {}),
      from,
    };
  }

  return null;
}

function report(error: unknown): void {
  // console is deliberate: an unattended kiosk has no other operator channel.
  console.warn('[wm-surface]', error instanceof Error ? error.message : error);
}
