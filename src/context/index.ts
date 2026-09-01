/**
 * Dashboard context for the voice layer (P3).
 *
 * Publishes a structured snapshot to the sidecar on a slow timer. The LLM
 * reads that snapshot and never the DOM, which is what keeps the voice layer
 * independent of upstream's markup.
 */

import { buildSnapshot, snapshotsDiffer, type DashboardSnapshot } from './snapshot';

export * from './snapshot';

/**
 * How often the snapshot is rebuilt.
 *
 * Four seconds, not on mutation: the dashboard repaints several times a second
 * from clocks and feed polling, and a snapshot per mutation would saturate the
 * socket to tell the model that a relative timestamp moved. Four seconds is
 * well inside the time it takes a user to press LISTEN and finish a sentence.
 */
const PUBLISH_INTERVAL_MS = 4_000;

export interface ContextPublisherOptions {
  /** Sends a snapshot. Returns false when there is no sidecar connected. */
  send(snapshot: DashboardSnapshot): boolean;
  /** Action names the model may return. Read lazily; the registry outlives this. */
  actions(): string[];
  doc?: Document;
  intervalMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => number;
  clearIntervalFn?: (handle: number) => void;
}

export interface ContextPublisher {
  /** Builds and sends immediately, regardless of the timer. */
  publish(): boolean;
  stop(): void;
}

/**
 * Starts publishing.
 *
 * Never throws. An unattended panel must not lose its dashboard because the
 * snapshot builder met markup it did not expect.
 */
export function startContextPublisher(options: ContextPublisherOptions): ContextPublisher {
  const doc = options.doc ?? document;
  const setIntervalFn = options.setIntervalFn ?? ((fn, ms) => window.setInterval(fn, ms));
  const clearIntervalFn = options.clearIntervalFn ?? ((h) => window.clearInterval(h));

  let last: DashboardSnapshot | null = null;

  const publish = (): boolean => {
    try {
      const snapshot = buildSnapshot({ doc, actions: options.actions() });
      // Unchanged snapshots are not re-sent: the model gains nothing and the
      // socket carries a few KB for it.
      if (!snapshotsDiffer(last, snapshot)) return false;
      const sent = options.send(snapshot);
      // Only remember it once it actually left. Otherwise a snapshot dropped
      // because the sidecar was down would never be retried, and the model
      // would reason about the dashboard as it was at boot.
      if (sent) last = snapshot;
      return sent;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[wm-context] publish failed:', error);
      return false;
    }
  };

  const handle = setIntervalFn(publish, options.intervalMs ?? PUBLISH_INTERVAL_MS);

  return {
    publish,
    stop: () => clearIntervalFn(handle),
  };
}
