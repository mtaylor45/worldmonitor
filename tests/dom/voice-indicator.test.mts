import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeEngine, SHELL_ATTRIBUTE } from '@/themes/engine';
import { createActions, installActions } from '@/themes/actions';
import { bootVoice, resetVoiceForTests, VOICE_STATE_LABELS } from '@/voice';
import { ACTION_EVENT, type ActionDetail, type Theme } from '@/themes/types';

/**
 * These tests cover the seam between the voice layer and the LCARS chrome:
 * the state indicator, the live transcript, the wake chirp, and the rail's
 * LISTEN button. That seam is where P2 is actually visible to a user, and none
 * of it needs a microphone.
 */

class FakeSocket {
  static latest: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor() {
    FakeSocket.latest = this;
  }
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }
  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
  send(frame: string): void {
    this.sent.push(frame);
  }
  close(): void {
    this.readyState = WebSocket.CLOSED;
  }
}

/** Transport seam, so bootVoice wires its own handlers around a fake socket. */
const transport = {
  socketFactory: () => new FakeSocket() as unknown as WebSocket,
  setTimeoutFn: () => 0,
  clearTimeoutFn: () => undefined,
};

const EMPTY = { color: {}, font: {}, space: {}, radius: {} };
const passthrough: Theme = { id: 'default', name: 'World Monitor', tokens: EMPTY };

async function mountLcars(): Promise<ThemeEngine> {
  document.head.innerHTML = '';
  document.body.innerHTML = `<div id="app" ${SHELL_ATTRIBUTE}></div>`;
  const { lcars } = await import('@/themes/lcars');
  const engine = new ThemeEngine(document, 0);
  engine.register(passthrough, lcars);
  await engine.apply('lcars');
  return engine;
}

describe('voice indicator', () => {
  beforeEach(() => {
    resetVoiceForTests();
    FakeSocket.latest = null;
  });

  it('renders a transcript slot and an idle status tag', async () => {
    await mountLcars();
    expect(document.querySelector('[data-wm-transcript]')).not.toBeNull();
    const voice = document.querySelector<HTMLElement>('.lcars-voice');
    expect(voice?.dataset.voiceState).toBe('idle');
    expect(voice?.textContent).toBe('STANDING BY');
  });

  it('reflects every state the sidecar reports', async () => {
    await mountLcars();
    bootVoice({ ...transport });
    FakeSocket.latest!.open();

    for (const state of ['listening', 'thinking', 'speaking', 'idle'] as const) {
      FakeSocket.latest!.receive({ type: 'state', state });
      const voice = document.querySelector<HTMLElement>('.lcars-voice');
      expect(voice?.dataset.voiceState, state).toBe(state);
      expect(voice?.textContent, state).toBe(VOICE_STATE_LABELS[state]);
    }
  });

  it('sounds the chirp on wake, before any transcript arrives', async () => {
    // The chirp is an acknowledgement that the computer is listening, and its
    // latency is the only latency the user actually perceives. If it waited
    // for recognition it would be pointless.
    await mountLcars();
    const played: string[] = [];
    bootVoice({ ...transport, playSound: (slot) => played.push(slot) });
    FakeSocket.latest!.open();

    FakeSocket.latest!.receive({ type: 'wake', confidence: 0.9 });
    expect(played).toEqual(['wake']);
    expect(document.querySelector('[data-wm-transcript]')?.textContent).toBe('');
  });

  it('shows a live transcript and hides the slot when empty', async () => {
    await mountLcars();
    bootVoice({ ...transport });
    FakeSocket.latest!.open();

    const slot = document.querySelector<HTMLElement>('[data-wm-transcript]')!;
    expect(slot.hidden).toBe(true);

    FakeSocket.latest!.receive({ type: 'transcript', text: 'show me sudan', final: false });
    expect(slot.textContent).toBe('show me sudan');
    expect(slot.hidden).toBe(false);
  });

  it('plays the refusal tone and clears down on an error', async () => {
    await mountLcars();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const played: string[] = [];
    bootVoice({ ...transport, playSound: (slot) => played.push(slot) });
    FakeSocket.latest!.open();

    FakeSocket.latest!.receive({ type: 'transcript', text: 'partial', final: false });
    FakeSocket.latest!.receive({ type: 'error', message: 'ollama unreachable' });

    expect(played).toEqual(['deny']);
    expect(document.querySelector<HTMLElement>('.lcars-voice')?.dataset.voiceState).toBe('idle');
    expect(document.querySelector('[data-wm-transcript]')?.textContent).toBe('');
  });

  it('survives having no chrome to render into', async () => {
    // Under the `default` theme there is no indicator at all. The client must
    // still run: a tokens-only theme cannot break the app.
    document.body.innerHTML = `<div id="app" ${SHELL_ATTRIBUTE}></div>`;
    bootVoice({ ...transport });
    FakeSocket.latest!.open();

    expect(() => FakeSocket.latest!.receive({ type: 'state', state: 'speaking' })).not.toThrow();
  });
});

describe('LISTEN rail button', () => {
  beforeEach(() => {
    resetVoiceForTests();
    FakeSocket.latest = null;
  });

  function wire(voice: ReturnType<typeof bootVoice> | undefined) {
    return installActions(
      createActions(
        { set: () => undefined, cycle: () => undefined, ids: () => ['default'] },
        voice,
      ),
    );
  }

  it('sends push-to-talk when the sidecar is connected', async () => {
    await mountLcars();
    const port = bootVoice({ ...transport });
    FakeSocket.latest!.open();
    const router = wire(port);

    document.querySelector<HTMLButtonElement>('[data-wm-action="voice.ptt"]')?.click();

    const frames = FakeSocket.latest!.sent.map((f) => JSON.parse(f));
    expect(frames).toContainEqual({ type: 'ptt', pressed: true });
    router.dispose();
  });

  it('reports failure when there is no sidecar, so the rail refuses audibly', async () => {
    await mountLcars();
    const port = bootVoice({ ...transport });
    // Deliberately never opened: this is the state the panel is in until the
    // sidecar is deployed, and a silent no-op would be indistinguishable from
    // a broken button.
    const outcomes: [string, boolean][] = [];
    const router = installActions(
      createActions(
        { set: () => undefined, cycle: () => undefined, ids: () => ['default'] },
        port,
      ),
      (action, handled) => outcomes.push([action, handled]),
    );

    document.querySelector<HTMLButtonElement>('[data-wm-action="voice.ptt"]')?.click();

    expect(outcomes).toEqual([['voice.ptt', false]]);
    router.dispose();
  });

  it('still refuses when the voice layer was never booted at all', () => {
    document.body.innerHTML = '';
    const outcomes: [string, boolean][] = [];
    const router = wire(undefined);
    window.dispatchEvent(
      new CustomEvent<ActionDetail>(ACTION_EVENT, { detail: { action: 'voice.ptt' } }),
    );
    router.dispose();
    // No crash, and the action is reported unhandled.
    expect(outcomes).toEqual([]);
  });
});
