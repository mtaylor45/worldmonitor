import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSnapshot, snapshotsDiffer, startContextPublisher } from '@/context';
import { SNAPSHOT_VERSION } from '@/voice/protocol';
import { createActions, installActions } from '@/themes/actions';
import { PANEL_ATTRIBUTE, THEME_ATTRIBUTE, SHELL_ATTRIBUTE } from '@/themes/engine';
import { bootVoice, resetVoiceForTests } from '@/voice';

/**
 * P3 tests: the structured snapshot, and the second half of the deterministic
 * boundary — the dashboard validating an action the sidecar asked for before
 * anything happens.
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

const transport = {
  socketFactory: () => new FakeSocket() as unknown as WebSocket,
  setTimeoutFn: () => 0,
  clearTimeoutFn: () => undefined,
};

function dashboard(): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, 'lcars');
  document.body.innerHTML = `
    <div id="app" ${SHELL_ATTRIBUTE}>
      <div class="panels-grid">
        <div class="panel" ${PANEL_ATTRIBUTE}="cii">
          <span class="panel-title">Country Instability</span>
          <span class="panel-count">87</span>
        </div>
        <div class="panel" ${PANEL_ATTRIBUTE}="markets">
          <span class="panel-title">Markets</span>
        </div>
      </div>
    </div>`;
}

describe('dashboard snapshot', () => {
  beforeEach(dashboard);

  it('describes panels by key and title, never by markup', () => {
    // SCOPE.md §3: the LLM reads this, never the DOM. The snapshot carries no
    // HTML, so upstream can restyle freely without touching the voice layer.
    const snapshot = buildSnapshot({ actions: ['panel.focus'] });

    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(snapshot.theme).toBe('lcars');
    expect(snapshot.panels.map((p) => p.key)).toEqual(['cii', 'markets']);
    expect(snapshot.panels[0]?.title).toBe('Country Instability');
    expect(JSON.stringify(snapshot)).not.toContain('<');
  });

  it('omits panel readings by default', () => {
    // Data belongs in tool results, not in every prompt. Pushing every panel's
    // numbers into every turn costs prompt-processing time on a CPU for data
    // the model usually does not need, and grows without bound as panels are
    // added. The model asks for a reading with a tool.
    const snapshot = buildSnapshot();
    expect(snapshot.panels[0]?.readings).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('87');
  });

  it('can still include readings when explicitly asked', () => {
    // The escape hatch, for a self-contained snapshot while debugging.
    const snapshot = buildSnapshot({ includeReadings: true });
    expect(Object.values(snapshot.panels[0]?.readings ?? {})).toContain('87');
  });

  it('carries the action list the model may choose from', () => {
    const snapshot = buildSnapshot({ actions: ['panel.focus', 'theme.cycle'] });
    expect(snapshot.actions).toEqual(['panel.focus', 'theme.cycle']);
  });

  it('reports the alert state', () => {
    expect(buildSnapshot().alert).toBeUndefined();
    document.documentElement.setAttribute('data-wm-alert', 'true');
    expect(buildSnapshot().alert).toBe(true);
    document.documentElement.removeAttribute('data-wm-alert');
  });

  it('caps how many panels are sent', () => {
    // The dashboard renders forty. Sending all of them costs prompt tokens the
    // three-second budget cannot spare, and a small model picking one of forty
    // does measurably worse than one picking from a dozen.
    const grid = document.querySelector('.panels-grid')!;
    for (let i = 0; i < 40; i += 1) {
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.setAttribute(PANEL_ATTRIBUTE, `extra-${i}`);
      grid.appendChild(panel);
    }
    expect(buildSnapshot().panels.length).toBeLessThanOrEqual(12);
  });

  it('falls back to the key when a panel has no title', () => {
    document.body.innerHTML = `<div ${PANEL_ATTRIBUTE}="orphan"></div>`;
    expect(buildSnapshot().panels[0]?.title).toBe('orphan');
  });

  it('returns a usable snapshot even with no dashboard at all', () => {
    document.body.innerHTML = '';
    const snapshot = buildSnapshot();
    expect(snapshot.panels).toEqual([]);
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
  });
});

describe('context publisher', () => {
  beforeEach(dashboard);

  it('does not re-send an unchanged snapshot', () => {
    // The dashboard repaints several times a second from clocks and polling; a
    // snapshot per repaint would saturate the socket to say nothing.
    const sent: unknown[] = [];
    const publisher = startContextPublisher({
      send: (s) => {
        sent.push(s);
        return true;
      },
      actions: () => ['panel.focus'],
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    expect(publisher.publish()).toBe(true);
    expect(publisher.publish()).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('re-sends once the dashboard actually changes', () => {
    const sent: unknown[] = [];
    const publisher = startContextPublisher({
      send: (s) => {
        sent.push(s);
        return true;
      },
      actions: () => ['panel.focus'],
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    publisher.publish();
    // A panel appearing changes the vocabulary, so it is worth re-sending.
    // A *reading* changing is not: readings are not in the snapshot at all.
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute(PANEL_ATTRIBUTE, 'energy');
    document.querySelector('.panels-grid')!.appendChild(panel);

    expect(publisher.publish()).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('does not re-send when only a reading changed', () => {
    // The dashboard repaints constantly. Now that readings live in tools
    // rather than the snapshot, a number ticking over is not a context change.
    const sent: unknown[] = [];
    const publisher = startContextPublisher({
      send: (s) => {
        sent.push(s);
        return true;
      },
      actions: () => ['panel.focus'],
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    publisher.publish();
    document.querySelector('.panel-count')!.textContent = '92';
    expect(publisher.publish()).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('retries a snapshot that could not be sent', () => {
    // Remembering a snapshot that never left would leave the model reasoning
    // about the dashboard as it was at boot, for the rest of the session.
    let connected = false;
    const publisher = startContextPublisher({
      send: () => connected,
      actions: () => ['panel.focus'],
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    expect(publisher.publish()).toBe(false);
    connected = true;
    expect(publisher.publish()).toBe(true);
  });

  it('survives a snapshot builder that throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const publisher = startContextPublisher({
      send: () => true,
      actions: () => {
        throw new Error('registry exploded');
      },
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });
    expect(() => publisher.publish()).not.toThrow();
  });

  it('detects difference against a null baseline', () => {
    expect(snapshotsDiffer(null, buildSnapshot())).toBe(true);
  });
});

describe('action dispatch from the sidecar', () => {
  beforeEach(() => {
    resetVoiceForTests();
    FakeSocket.latest = null;
    dashboard();
  });

  function wire(performed: [string, string | undefined][], allow: boolean) {
    const port = bootVoice({
      ...transport,
      performAction: (action, argument) => {
        performed.push([action, argument]);
        return allow;
      },
    });
    FakeSocket.latest!.open();
    return port;
  }

  it('performs an action the sidecar asks for', () => {
    const performed: [string, string | undefined][] = [];
    wire(performed, true);

    FakeSocket.latest!.receive({ type: 'action', action: 'panel.focus', argument: 'cii' });

    expect(performed).toEqual([['panel.focus', 'cii']]);
  });

  it('sounds acceptance when performed and refusal when not', () => {
    // A command that silently does nothing is indistinguishable from a broken
    // assistant on a wall panel.
    const played: string[] = [];
    resetVoiceForTests();
    bootVoice({
      ...transport,
      playSound: (slot) => played.push(slot),
      performAction: (action) => action === 'theme.cycle',
    });
    FakeSocket.latest!.open();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    FakeSocket.latest!.receive({ type: 'action', action: 'theme.cycle' });
    FakeSocket.latest!.receive({ type: 'action', action: 'system.reboot' });

    expect(played).toEqual(['accept', 'deny']);
  });

  it('refuses when there is no handler wired at all', () => {
    resetVoiceForTests();
    const played: string[] = [];
    bootVoice({ ...transport, playSound: (slot) => played.push(slot) });
    FakeSocket.latest!.open();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    FakeSocket.latest!.receive({ type: 'action', action: 'panel.focus', argument: 'cii' });

    expect(played).toEqual(['deny']);
  });

  it('the real registry refuses an action it does not know', () => {
    // The second validation. The sidecar already accepted this; the dashboard
    // checks again, because one validation is a single point of trust in a
    // language model's output.
    const router = installActions(
      createActions({ set: () => undefined, cycle: () => undefined, ids: () => ['default'] }),
    );

    expect(router.handle('panel.focus', 'cii')).toBe(true);
    expect(router.handle('system.reboot')).toBe(false);
    expect(router.handle('panel.focus', 'warp-core')).toBe(false);
    router.dispose();
  });

  it('publishes context over the socket', () => {
    const port = bootVoice({ ...transport });
    FakeSocket.latest!.open();

    expect(port.sendContext(buildSnapshot({ actions: ['panel.focus'] }))).toBe(true);
    const frames = FakeSocket.latest!.sent.map((f) => JSON.parse(f));
    const context = frames.find((f) => f.type === 'context');
    expect(context?.snapshot?.panels?.[0]?.key).toBe('cii');
  });

  it('drops a malformed action frame', () => {
    const performed: [string, string | undefined][] = [];
    wire(performed, true);

    FakeSocket.latest!.receive({ type: 'action' });
    FakeSocket.latest!.receive({ type: 'action', action: '' });

    expect(performed).toEqual([]);
  });
});
