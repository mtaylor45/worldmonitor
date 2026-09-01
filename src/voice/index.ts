/**
 * Voice layer entry point.
 *
 * Owns the sidecar connection and everything the dashboard shows about it: the
 * state indicator, the live transcript, and the chirps. It does NOT own audio
 * capture or playback — SCOPE.md §3 puts the whole audio loop natively in the
 * sidecar, because kiosk Chromium makes microphone permissions painful and the
 * browser adds nothing to that path.
 *
 * Everything here degrades to nothing. With no sidecar running the dashboard
 * renders identically, the indicator reads STANDING BY, and `voice.ptt`
 * reports failure so the rail plays the refusal tone — which is the honest
 * feedback for a button whose backend is not up.
 */

import { VoiceClient } from './client';
import { VOICE_STATES, type VoiceState } from './protocol';

export { VoiceClient } from './client';
export * from './protocol';

/** What the footer indicator reads in each state. All capitals, per the design system. */
const LABELS: Record<VoiceState, string> = {
  idle: 'STANDING BY',
  listening: 'LISTENING',
  thinking: 'WORKING',
  speaking: 'SPEAKING',
};

/** How long a final transcript stays on screen before the footer clears. */
const TRANSCRIPT_LINGER_MS = 6_000;

/** The port the action registry calls. Kept minimal on purpose. */
export interface VoicePort {
  /** Returns false when there is no sidecar — the caller plays the refusal tone. */
  ptt(): boolean;
  readonly connected: boolean;
}

export interface BootVoiceOptions {
  /** Sidecar URL. Defaults to the same host on the sidecar's port. */
  url?: string;
  /** Plays a themed sound by slot. Injected so this layer owns no audio assets. */
  playSound?: (slot: 'wake' | 'accept' | 'change' | 'deny' | 'alert') => void;
  doc?: Document;
  /**
   * Transport seam, for tests.
   *
   * Deliberately the socket and not the whole client: injecting a prebuilt
   * `VoiceClient` would bypass every handler wired below, so a test would
   * exercise a client with no indicator, no transcript and no chirp - which is
   * precisely the wiring worth testing.
   */
  socketFactory?: (url: string) => WebSocket;
  setTimeoutFn?: (fn: () => void, ms: number) => number;
  clearTimeoutFn?: (handle: number) => void;
}

/**
 * Default sidecar endpoint.
 *
 * Same host, fixed port: the sidecar is a container beside the dashboard on the
 * kiosk, never a remote service. `ws:` rather than `wss:` because this never
 * leaves the machine, and a self-signed certificate on localhost would be
 * ceremony with no security benefit.
 */
function defaultUrl(doc: Document): string {
  const host = doc.defaultView?.location?.hostname || '127.0.0.1';
  return `ws://${host}:8765/voice`;
}

function setIndicator(doc: Document, state: VoiceState): void {
  // Queried each time rather than cached: theme chrome unmounts and re-mounts,
  // so a node captured at boot is frequently not the node on screen now.
  const indicator = doc.querySelector<HTMLElement>('.lcars-voice');
  if (!indicator) return;
  indicator.dataset.voiceState = state;
  const label = indicator.querySelector<HTMLElement>('.lcars-voice-text');
  if (label) label.textContent = LABELS[state];
}

function setTranscript(doc: Document, text: string): void {
  const slot = doc.querySelector<HTMLElement>('[data-wm-transcript]');
  if (!slot) return;
  slot.textContent = text;
  // An empty element still occupies its grid cell and shows its background;
  // `hidden` keeps the footer bar clean between utterances.
  slot.hidden = text.length === 0;
}

let started = false;
let active: VoiceClient | null = null;

/**
 * Connects to the sidecar and wires the indicator, transcript and chirps.
 *
 * Idempotent, and never throws: this runs inside dashboard startup on an
 * unattended panel, where an exception would cost the whole display for the
 * sake of a feature whose backend may not even be deployed.
 */
export function bootVoice(options: BootVoiceOptions = {}): VoicePort {
  const doc = options.doc ?? document;
  const play = options.playSound ?? (() => undefined);

  if (started && active) return portFor(active);
  started = true;

  let clearTranscript: ReturnType<typeof setTimeout> | undefined;

  const client = new VoiceClient({
    url: options.url ?? defaultUrl(doc),
    ...(options.socketFactory ? { socketFactory: options.socketFactory } : {}),
    ...(options.setTimeoutFn ? { setTimeoutFn: options.setTimeoutFn } : {}),
    ...(options.clearTimeoutFn ? { clearTimeoutFn: options.clearTimeoutFn } : {}),

    onState: (state) => setIndicator(doc, state),

    // The chirp fires here, on detection, NOT when the response is ready. It
    // is an acknowledgement that the computer is listening, and its latency is
    // the only latency the user actually perceives - everything downstream can
    // take a second.
    onWake: () => play('wake'),

    onTranscript: (text, final) => {
      clearTimeout(clearTranscript);
      setTranscript(doc, text);
      if (final) {
        clearTranscript = setTimeout(() => setTranscript(doc, ''), TRANSCRIPT_LINGER_MS);
      }
    },

    onError: (message) => {
      report(message);
      play('deny');
      setIndicator(doc, 'idle');
      setTranscript(doc, '');
    },

    onConnectionChange: (connected) => {
      if (!connected) {
        setIndicator(doc, 'idle');
        setTranscript(doc, '');
      }
    },
  });

  active = client;
  try {
    client.connect();
  } catch (error) {
    // connect() catches its own failures; this is belt and braces for a
    // future implementation that does not.
    report(error instanceof Error ? error.message : String(error));
  }

  return portFor(client);
}

function portFor(client: VoiceClient): VoicePort {
  return {
    ptt: () => client.ptt(true),
    get connected() {
      return client.connected;
    },
  };
}

/** The booted client, or null. */
export function getVoiceClient(): VoiceClient | null {
  return active;
}

/** Test seam: drops the module-level client so a suite can boot a fresh one. */
export function resetVoiceForTests(): void {
  active?.disconnect();
  active = null;
  started = false;
}

/** Every state the indicator can show. Re-exported for tests and the chrome. */
export const VOICE_STATE_LABELS = LABELS;
export { VOICE_STATES };

function report(message: string): void {
  // console is deliberate: an unattended kiosk has no other operator channel.
  console.warn(`[wm-voice] ${message}`);
}
