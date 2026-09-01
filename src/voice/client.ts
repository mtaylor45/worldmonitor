/**
 * WebSocket client for the voice sidecar.
 *
 * The sidecar is a separate container that may be stopped, restarting, or not
 * deployed at all — P2 ships the frontend before the hardware exists. So the
 * governing rule here is the same one the theme engine follows: this must never
 * take the dashboard with it. A missing sidecar is an ordinary state, not an
 * error, and the dashboard renders identically without one.
 *
 * Reconnection is unbounded but backed off. A wall panel is expected to
 * outlive many sidecar restarts without anyone touching it, so giving up after
 * N attempts would mean a kiosk that silently loses voice at 3am and never
 * recovers.
 */

import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type VoiceState,
} from './protocol';

export interface VoiceClientHandlers {
  onState?(state: VoiceState): void;
  /** Wake word detected. Fires before recognition — sound the chirp here. */
  onWake?(confidence: number | undefined): void;
  onTranscript?(text: string, final: boolean): void;
  onResponse?(text: string): void;
  onError?(message: string): void;
  onConnectionChange?(connected: boolean): void;
}

export interface VoiceClientOptions extends VoiceClientHandlers {
  url: string;
  /** Injectable for tests. Defaults to the platform WebSocket. */
  socketFactory?: (url: string) => WebSocket;
  /** Injectable for tests, so a suite need not wait on real backoff. */
  setTimeoutFn?: (fn: () => void, ms: number) => number;
  clearTimeoutFn?: (handle: number) => void;
}

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

export class VoiceClient {
  private socket: WebSocket | null = null;
  private backoff = INITIAL_BACKOFF_MS;
  private retry: number | null = null;
  private closed = false;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => number;
  private readonly clearTimeoutFn: (handle: number) => void;

  constructor(private readonly options: VoiceClientOptions) {
    this.setTimeoutFn =
      options.setTimeoutFn ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((h) => window.clearTimeout(h));
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    this.closed = false;
    if (this.socket) return;

    let socket: WebSocket;
    try {
      const factory = this.options.socketFactory ?? ((url: string) => new WebSocket(url));
      socket = factory(this.options.url);
    } catch (error) {
      // A malformed URL or a blocked scheme throws synchronously. Treat it as
      // a failed connection and back off, rather than surfacing to the caller.
      report('could not open socket', error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.backoff = INITIAL_BACKOFF_MS;
      this.send({ type: 'hello', client: 'lcars-world-monitor', version: PROTOCOL_VERSION });
      this.options.onConnectionChange?.(true);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      // Unrecognised frames are dropped: the sidecar can be a version ahead
      // after an update, and a frame we do not understand is not a failure.
      if (!message) return;
      try {
        this.dispatch(message);
      } catch (error) {
        // A throwing handler is the caller's bug, not a reason to drop the
        // connection or stop processing later frames.
        report('voice handler threw', error);
      }
    };

    socket.onerror = () => {
      // Deliberately quiet. `onclose` always follows, and that is where
      // reconnection is handled; logging both would fill the journal on a
      // kiosk whose sidecar is simply not running yet.
    };

    socket.onclose = () => {
      this.socket = null;
      this.options.onConnectionChange?.(false);
      // Returning to idle matters: the indicator must not sit on LISTENING
      // because the sidecar died mid-utterance.
      this.options.onState?.('idle');
      this.scheduleReconnect();
    };
  }

  /** Stops reconnecting and closes. Used on teardown, not on failure. */
  disconnect(): void {
    this.closed = true;
    if (this.retry !== null) {
      this.clearTimeoutFn(this.retry);
      this.retry = null;
    }
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Closing an already-closing socket throws in some browsers.
    }
  }

  /** Push-to-talk. Returns false when there is no sidecar to talk to. */
  ptt(pressed: boolean): boolean {
    return this.send({ type: 'ptt', pressed });
  }

  cancel(): boolean {
    return this.send({ type: 'cancel' });
  }

  private send(message: ClientMessage): boolean {
    if (!this.connected || !this.socket) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      report('send failed', error);
      return false;
    }
  }

  private dispatch(message: ReturnType<typeof parseServerMessage> & object): void {
    switch (message.type) {
      case 'state':
        this.options.onState?.(message.state);
        break;
      case 'wake':
        this.options.onWake?.(message.confidence);
        break;
      case 'transcript':
        this.options.onTranscript?.(message.text, message.final);
        break;
      case 'response':
        this.options.onResponse?.(message.text);
        break;
      case 'error':
        this.options.onError?.(message.message);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retry !== null) return;
    const delay = this.backoff;
    // Doubling with a ceiling: fast enough to recover from a sidecar restart
    // in a second or two, slow enough that a sidecar which is never coming up
    // does not spin the CPU on a fanless panel for the rest of its life.
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.retry = this.setTimeoutFn(() => {
      this.retry = null;
      if (!this.closed) this.connect();
    }, delay);
  }
}

function report(message: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  // console is deliberate: an unattended kiosk has no other operator channel.
  console.warn(`[wm-voice] ${message}: ${reason}`);
}
