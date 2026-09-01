import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoiceClient } from '@/voice/client';
import { PROTOCOL_VERSION, parseServerMessage, VOICE_STATES } from '@/voice/protocol';

/**
 * A scriptable stand-in for the platform WebSocket.
 *
 * The sidecar is a separate container that may be stopped, restarting, or not
 * deployed at all, so the behaviour worth testing is what the dashboard does
 * when it is absent — which is the state it will be in until the hardware
 * exists.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  receiveRaw(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  drop(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
}

interface Harness {
  client: VoiceClient;
  socket(): FakeSocket;
  timers: { fn: () => void; ms: number }[];
  runTimers(): void;
}

function harness(handlers: Record<string, unknown> = {}): Harness {
  FakeSocket.instances = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const client = new VoiceClient({
    url: 'ws://127.0.0.1:8765/voice',
    socketFactory: (url) => new FakeSocket(url) as unknown as WebSocket,
    setTimeoutFn: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeoutFn: () => undefined,
    ...handlers,
  });
  return {
    client,
    socket: () => FakeSocket.instances[FakeSocket.instances.length - 1]!,
    timers,
    runTimers: () => {
      const pending = timers.splice(0, timers.length);
      for (const t of pending) t.fn();
    },
  };
}

describe('voice protocol', () => {
  it('drops frames it does not understand rather than throwing', () => {
    // The sidecar can be a version ahead after an update. An unknown frame is
    // not a failure, and must not take the dashboard down.
    for (const raw of ['not json', '{}', '[]', '{"type":"nope"}', '{"type":"state"}']) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });

  it('rejects a state value outside the contract', () => {
    expect(parseServerMessage('{"type":"state","state":"daydreaming"}')).toBeNull();
    for (const state of VOICE_STATES) {
      expect(parseServerMessage(`{"type":"state","state":"${state}"}`)).toEqual({
        type: 'state',
        state,
      });
    }
  });

  it('treats a missing final flag as a partial transcript', () => {
    expect(parseServerMessage('{"type":"transcript","text":"sudan"}')).toEqual({
      type: 'transcript',
      text: 'sudan',
      final: false,
    });
  });
});

describe('VoiceClient', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
  });

  it('announces itself with the protocol version on connect', () => {
    const h = harness();
    h.client.connect();
    h.socket().open();

    expect(JSON.parse(h.socket().sent[0]!)).toEqual({
      type: 'hello',
      client: 'lcars-world-monitor',
      version: PROTOCOL_VERSION,
    });
  });

  it('reports failure from ptt when there is no sidecar', () => {
    // This is what makes the rail play the refusal tone. A wall panel gives no
    // other signal that voice is unavailable, so a silent no-op would be
    // indistinguishable from a broken button.
    const h = harness();
    expect(h.client.ptt(true)).toBe(false);
    expect(h.client.connected).toBe(false);
  });

  it('sends ptt once connected', () => {
    const h = harness();
    h.client.connect();
    h.socket().open();

    expect(h.client.ptt(true)).toBe(true);
    expect(JSON.parse(h.socket().sent[1]!)).toEqual({ type: 'ptt', pressed: true });
  });

  it('routes every server message to its handler', () => {
    const onState = vi.fn();
    const onWake = vi.fn();
    const onTranscript = vi.fn();
    const onResponse = vi.fn();
    const onError = vi.fn();
    const h = harness({ onState, onWake, onTranscript, onResponse, onError });
    h.client.connect();
    h.socket().open();

    h.socket().receive({ type: 'state', state: 'listening' });
    h.socket().receive({ type: 'wake', confidence: 0.9 });
    h.socket().receive({ type: 'transcript', text: 'show sudan', final: true });
    h.socket().receive({ type: 'response', text: 'Acknowledged.' });
    h.socket().receive({ type: 'error', message: 'stt down' });

    expect(onState).toHaveBeenCalledWith('listening');
    expect(onWake).toHaveBeenCalledWith(0.9);
    expect(onTranscript).toHaveBeenCalledWith('show sudan', true);
    expect(onResponse).toHaveBeenCalledWith('Acknowledged.');
    expect(onError).toHaveBeenCalledWith('stt down');
  });

  it('keeps processing after a handler throws', () => {
    // A throwing handler is the caller's bug, not a reason to drop the
    // connection or stop reading later frames.
    const onTranscript = vi.fn();
    const h = harness({
      onState: () => {
        throw new Error('handler bug');
      },
      onTranscript,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.client.connect();
    h.socket().open();

    h.socket().receive({ type: 'state', state: 'listening' });
    h.socket().receive({ type: 'transcript', text: 'still here', final: true });

    expect(onTranscript).toHaveBeenCalledWith('still here', true);
  });

  it('ignores non-string frames', () => {
    const onState = vi.fn();
    const h = harness({ onState });
    h.client.connect();
    h.socket().open();
    h.socket().receiveRaw(new ArrayBuffer(8));
    expect(onState).not.toHaveBeenCalled();
  });

  it('returns the indicator to idle when the sidecar goes away', () => {
    // The failure this prevents: the indicator stuck on LISTENING because the
    // container died mid-utterance, on a panel nobody is watching.
    const onState = vi.fn();
    const onConnectionChange = vi.fn();
    const h = harness({ onState, onConnectionChange });
    h.client.connect();
    h.socket().open();
    h.socket().receive({ type: 'state', state: 'listening' });
    h.socket().drop();

    expect(onState).toHaveBeenLastCalledWith('idle');
    expect(onConnectionChange).toHaveBeenLastCalledWith(false);
  });

  it('backs off exponentially, then reconnects', () => {
    const h = harness();
    h.client.connect();
    h.socket().open();

    h.socket().drop();
    expect(h.timers[0]?.ms).toBe(500);
    h.runTimers();

    // A second failure without a successful open doubles the wait.
    h.socket().drop();
    expect(h.timers[0]?.ms).toBe(1000);
    expect(FakeSocket.instances.length).toBe(2);
  });

  it('resets the backoff after a successful connection', () => {
    // Otherwise a panel that has been up for days reconnects on a 30s delay
    // after a one-second sidecar restart.
    const h = harness();
    h.client.connect();
    h.socket().open();
    h.socket().drop();
    h.runTimers();
    h.socket().drop();
    h.runTimers();
    h.socket().open();
    h.socket().drop();

    expect(h.timers[0]?.ms).toBe(500);
  });

  it('stops reconnecting once disconnected deliberately', () => {
    const h = harness();
    h.client.connect();
    h.socket().open();
    h.client.disconnect();

    expect(h.timers).toHaveLength(0);
  });

  it('survives a socket factory that throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const timers: { fn: () => void; ms: number }[] = [];
    const client = new VoiceClient({
      url: 'not a url',
      socketFactory: () => {
        throw new Error('bad scheme');
      },
      setTimeoutFn: (fn, ms) => {
        timers.push({ fn, ms });
        return 1;
      },
      clearTimeoutFn: () => undefined,
    });

    expect(() => client.connect()).not.toThrow();
    // And it still schedules a retry rather than giving up silently.
    expect(timers).toHaveLength(1);
  });
});
