/**
 * The dashboard's state, as structured data.
 *
 * SCOPE.md §3: **the LLM reads this, never the DOM.** Scraping rendered markup
 * would couple the voice layer to upstream's HTML and break on every merge —
 * and it would hand a small model a page of chrome to find two numbers in,
 * which is the surest way to make it answer about the wrong panel.
 *
 * This module does read the DOM, because that is where upstream's state lives
 * and there is no API for it. The difference that matters is that the coupling
 * is confined to *this file*, behind a versioned schema. When upstream changes
 * its markup, one selector here moves; nothing downstream notices.
 */

import { PANEL_ATTRIBUTE, THEME_ATTRIBUTE } from '../themes/engine';
import { SNAPSHOT_VERSION, type DashboardSnapshot, type PanelSnapshot } from '../voice/protocol';

export { SNAPSHOT_VERSION };
export type { DashboardSnapshot, PanelSnapshot };

/**
 * How many panels go into a snapshot.
 *
 * The dashboard renders forty. Sending all of them costs prompt tokens the
 * three-second budget cannot spare on a CPU, and a small model asked to pick
 * one of forty does measurably worse than one asked to pick from a dozen.
 * Visible panels come first, so the cut falls on what is off-screen.
 */
const MAX_PANELS = 12;

/** How many readings are lifted from a single panel. */
const MAX_READINGS = 6;

/** Longest reading text kept. Anything longer is prose, not a reading. */
const MAX_READING_CHARS = 80;

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Is this panel on screen?
 *
 * Used only for ordering, not filtering: a question about a panel scrolled out
 * of view is still a fair question, and dropping it would make the assistant
 * inexplicably ignorant of something the user can see by scrolling.
 */
function isVisible(panel: HTMLElement): boolean {
  const box = panel.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return false;
  const view = panel.ownerDocument.defaultView;
  const height = view?.innerHeight ?? 720;
  const width = view?.innerWidth ?? 1280;
  return box.top < height && box.bottom > 0 && box.left < width && box.right > 0;
}

/**
 * Lifts the headline readings out of one panel.
 *
 * Upstream marks its numbers with `.panel-count`, `.metric-value` and friends;
 * where a label sits beside a value the pair is kept, otherwise the value is
 * indexed. This is heuristic by necessity — upstream has no reading API — and
 * it is the one part of this file expected to need attention after a merge.
 */
function readingsFor(panel: HTMLElement): Record<string, string> | undefined {
  const readings: Record<string, string> = {};
  const nodes = panel.querySelectorAll<HTMLElement>(
    '.panel-count, .metric-value, .stat-value, [data-value], .cii-score, .panel-data-badge',
  );

  let index = 0;
  for (const node of nodes) {
    if (index >= MAX_READINGS) break;
    const value = text(node);
    if (!value || value.length > MAX_READING_CHARS) continue;

    const labelNode =
      node.closest('[data-label]') ??
      node.parentElement?.querySelector('.metric-label, .stat-label, .panel-title');
    const label = text(labelNode) || `value-${index + 1}`;
    if (label in readings) continue;

    readings[label] = value;
    index += 1;
  }

  return index > 0 ? readings : undefined;
}

export interface SnapshotOptions {
  doc?: Document;
  /** Action names the model may return. Generated from the registry. */
  actions?: string[];
  maxPanels?: number;
}

/**
 * Builds the snapshot handed to the model.
 *
 * Never throws: this runs on a timer on an unattended panel, and a snapshot
 * that fails should cost one turn's context, not the dashboard.
 */
export function buildSnapshot(options: SnapshotOptions = {}): DashboardSnapshot {
  const doc = options.doc ?? document;
  const limit = options.maxPanels ?? MAX_PANELS;

  const snapshot: DashboardSnapshot = {
    version: SNAPSHOT_VERSION,
    theme: doc.documentElement.getAttribute(THEME_ATTRIBUTE) ?? 'default',
    panels: [],
    actions: options.actions ?? [],
  };

  try {
    const hosts = [...doc.querySelectorAll<HTMLElement>(`[${PANEL_ATTRIBUTE}]`)];

    // Visible first, original order preserved within each group, so the cut at
    // `limit` falls on what is off-screen rather than on whatever the DOM
    // happened to list last.
    const ordered = [
      ...hosts.filter((panel) => isVisible(panel)),
      ...hosts.filter((panel) => !isVisible(panel)),
    ];

    for (const host of ordered.slice(0, limit)) {
      const key = host.getAttribute(PANEL_ATTRIBUTE);
      if (!key) continue;
      const panel: PanelSnapshot = {
        key,
        title: text(host.querySelector('.panel-title')) || key,
      };
      const readings = readingsFor(host);
      if (readings) panel.readings = readings;
      snapshot.panels.push(panel);
    }

    if (doc.documentElement.getAttribute('data-wm-alert') === 'true') {
      snapshot.alert = true;
    }
  } catch (error) {
    // A snapshot that fails costs this turn's context, not the dashboard.
    // eslint-disable-next-line no-console
    console.warn('[wm-context] snapshot failed:', error);
  }

  return snapshot;
}

/**
 * Have the readings changed enough to be worth re-sending?
 *
 * The dashboard repaints constantly — clocks, relative timestamps, feed polling
 * — so a snapshot on every mutation would push a payload across the socket
 * several times a second for no benefit. Comparing the serialised form is
 * cheap and catches exactly the changes the model would notice.
 */
export function snapshotsDiffer(a: DashboardSnapshot | null, b: DashboardSnapshot): boolean {
  if (!a) return true;
  return JSON.stringify(a) !== JSON.stringify(b);
}
