import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALERT_ATTRIBUTE, isAlert, setAlert } from '@/alert';
import { buildSnapshot } from '@/context';
import { PANEL_ATTRIBUTE, SHELL_ATTRIBUTE, THEME_ATTRIBUTE } from '@/themes/engine';
import { bootVoice, resetVoiceForTests } from '@/voice';

/**
 * P4-1 tests: the display half of the proactive alert.
 *
 * The decision — thresholds, hysteresis, quiet hours — is the sidecar's and is
 * tested in `voice-sidecar/tests/test_alerts.py`. What is tested here is that
 * the dashboard renders that decision, sounds it once, and leaves no trace
 * when it clears.
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

describe('alert attribute', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(ALERT_ATTRIBUTE);
  });

  it('raises and clears', () => {
    expect(isAlert()).toBe(false);
    expect(setAlert(true)).toBe(true);
    expect(document.documentElement.getAttribute(ALERT_ATTRIBUTE)).toBe('true');
    expect(setAlert(false)).toBe(true);
    expect(isAlert()).toBe(false);
  });

  it('removes the attribute rather than setting it false', () => {
    // An empty or false-valued attribute is still an attribute, and the CSS
    // selector is `[data-wm-alert='true']` — so `false` would look cleared and
    // read as present to anything counting attributes.
    setAlert(true);
    setAlert(false);
    expect(document.documentElement.hasAttribute(ALERT_ATTRIBUTE)).toBe(false);
  });

  it('reports whether the state actually changed', () => {
    // This is what makes the tone edge-triggered.
    expect(setAlert(true)).toBe(true);
    expect(setAlert(true)).toBe(false);
    expect(setAlert(false)).toBe(true);
    expect(setAlert(false)).toBe(false);
  });

  it('sounds the alert tone once per crossing, not once per message', () => {
    // The sidecar polls every few minutes and a panel can sit in alert for an
    // hour. Sounding on every message would turn the one sound that means
    // "look now" into a metronome.
    const played: string[] = [];
    const playSound = (slot: string) => played.push(slot);

    setAlert(true, { playSound });
    setAlert(true, { playSound });
    setAlert(true, { playSound });
    expect(played).toEqual(['alert']);
  });

  it('makes no sound when clearing', () => {
    const played: string[] = [];
    const playSound = (slot: string) => played.push(slot);
    setAlert(true, { playSound });
    setAlert(false, { playSound });
    expect(played).toEqual(['alert']);
  });

  it('never writes upstream\'s data-theme', () => {
    // Upstream sets `data-theme` before first paint for light/dark. Writing it
    // would silently clobber the colour scheme across all of main.css.
    const before = document.documentElement.getAttribute('data-theme');
    setAlert(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe(before);
  });
});

describe('alert in the snapshot', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(ALERT_ATTRIBUTE);
    document.documentElement.setAttribute(THEME_ATTRIBUTE, 'lcars');
    document.body.innerHTML = `
      <div id="app" ${SHELL_ATTRIBUTE}>
        <div class="panel" ${PANEL_ATTRIBUTE}="cii"><span class="panel-title">CII</span></div>
      </div>`;
  });

  it('tells the model the panel is in alert', () => {
    // So "what is happening" during an alert is answered by an assistant that
    // knows the display is already shouting.
    expect(buildSnapshot().alert).toBeUndefined();
    setAlert(true);
    expect(buildSnapshot().alert).toBe(true);
    setAlert(false);
    expect(buildSnapshot().alert).toBeUndefined();
  });
});

describe('alert over the socket', () => {
  beforeEach(() => {
    resetVoiceForTests();
    FakeSocket.latest = null;
    document.documentElement.removeAttribute(ALERT_ATTRIBUTE);
    document.body.innerHTML = `<div id="app" ${SHELL_ATTRIBUTE}></div>`;
  });

  it('raises the display when the sidecar says so', () => {
    const played: string[] = [];
    bootVoice({ ...transport, playSound: (slot) => played.push(slot) });
    FakeSocket.latest!.open();
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    FakeSocket.latest!.receive({ type: 'alert', active: true, region: 'Sudan', score: 87 });

    expect(isAlert()).toBe(true);
    expect(played).toEqual(['alert']);
  });

  it('clears it again', () => {
    bootVoice({ ...transport });
    FakeSocket.latest!.open();

    FakeSocket.latest!.receive({ type: 'alert', active: true, region: 'Sudan', score: 87 });
    FakeSocket.latest!.receive({ type: 'alert', active: false });

    expect(document.documentElement.hasAttribute(ALERT_ATTRIBUTE)).toBe(false);
  });

  it('does not re-evaluate the threshold itself', () => {
    // The dashboard has no readings and no thresholds. A second opinion here
    // would mean a copy of the rules to drift out of step with the ones that
    // actually fire — unlike an action, where the second validation guards a
    // language model's output.
    const seen: boolean[] = [];
    bootVoice({ ...transport, setAlertState: (active) => seen.push(active) });
    FakeSocket.latest!.open();

    FakeSocket.latest!.receive({ type: 'alert', active: true, score: 12 });
    FakeSocket.latest!.receive({ type: 'alert', active: false, score: 99 });

    expect(seen).toEqual([true, false]);
  });

  it('drops a malformed alert frame', () => {
    const seen: boolean[] = [];
    bootVoice({ ...transport, setAlertState: (active) => seen.push(active) });
    FakeSocket.latest!.open();

    FakeSocket.latest!.receive({ type: 'alert' });
    FakeSocket.latest!.receive({ type: 'alert', active: 'yes' });

    expect(seen).toEqual([]);
    expect(isAlert()).toBe(false);
  });

  it('survives a display handler that throws', () => {
    // An unattended panel must not lose its voice connection because the
    // alert renderer failed.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    bootVoice({
      ...transport,
      setAlertState: () => {
        throw new Error('no document');
      },
    });
    FakeSocket.latest!.open();

    expect(() =>
      FakeSocket.latest!.receive({ type: 'alert', active: true, region: 'Sudan' }),
    ).not.toThrow();
  });
});
