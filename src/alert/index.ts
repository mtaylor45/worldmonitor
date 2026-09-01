/**
 * Proactive alert state.
 *
 * SCOPE.md §6 P4-1. The dashboard asserting itself: when the Composite
 * Instability Index crosses a threshold the frame goes to alert colours, the
 * alert tone sounds, and the assistant speaks unprompted. This module owns the
 * first two; the speech is the sidecar's, which is also the only side holding
 * thresholds and readings.
 *
 * **Deliberately not a second opinion.** Unlike an action — which the sidecar
 * validates and the dashboard then validates again, because the thing being
 * checked is a language model's output — an alert is arithmetic on a number
 * the sidecar fetched. There is no second opinion the dashboard could hold,
 * and inventing one would mean shipping a copy of the thresholds here to drift
 * out of step with the ones that actually fire.
 *
 * The visual half already existed: `:root[data-wm-theme^="lcars"][data-wm-alert='true']`
 * in `lcars.css` alternates the structural blocks between critical red and the
 * field at 1 Hz, on `steps(1)` so it cuts rather than breathes. This module
 * only sets the attribute. A theme with no alert styling simply shows nothing,
 * which is the same graceful-degradation property `default` has everywhere
 * else.
 */

/** Ours. Never `data-alert`, and never anywhere near upstream's `data-theme`. */
export const ALERT_ATTRIBUTE = 'data-wm-alert';

export interface AlertOptions {
  doc?: Document;
  /** Plays a themed sound by slot. Injected: this layer owns no audio assets. */
  playSound?: (slot: 'wake' | 'accept' | 'change' | 'deny' | 'alert') => void;
}

/**
 * Raises or clears the alert state.
 *
 * Returns true when the state actually changed, which is what makes the tone
 * edge-triggered: the sidecar polls every few minutes and a panel can sit in
 * alert for an hour, so sounding on every message would turn the one sound
 * that means "look now" into a metronome.
 *
 * Clearing REMOVES the attribute rather than setting it to `false`. An empty
 * or false-valued attribute is still an attribute, and the theme layer's
 * lossless-teardown rule exists precisely because that distinction is easy to
 * lose and invisible until a DOM comparison fails twenty cycles later.
 */
export function setAlert(active: boolean, options: AlertOptions = {}): boolean {
  const doc = options.doc ?? document;
  const root = doc.documentElement;
  const was = isAlert(doc);
  if (was === active) return false;

  if (active) {
    root.setAttribute(ALERT_ATTRIBUTE, 'true');
    options.playSound?.('alert');
  } else {
    root.removeAttribute(ALERT_ATTRIBUTE);
  }
  return true;
}

/** Whether the dashboard is currently in alert. Read by `src/context/`. */
export function isAlert(doc: Document = document): boolean {
  return doc.documentElement.getAttribute(ALERT_ATTRIBUTE) === 'true';
}
