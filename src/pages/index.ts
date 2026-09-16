/**
 * Dashboard pages.
 *
 * Upstream can render **189 panels across 23 categories**. A 1280x400 display
 * holds four or five. Pagination is not a convenience here, it is the only way
 * the dashboard fits the hardware at all.
 *
 * `docs/DESIGN-SYSTEM.md` already specified this before it existed — the "Page
 * archetypes" table names five pages, each with its own frame colour and block
 * rhythm, and the rule that *a page should be identifiable from the doorway
 * before any label resolves*. That is what the `tone` field carries.
 *
 * **Pages are derived from `PANEL_CATEGORY_MAP`, never duplicated.** Importing
 * upstream's map read-only means a panel upstream adds lands on a page with no
 * edit here. If upstream renames the export the build breaks — loudly, at
 * compile time, which is the good kind of coupling. Duplicating the list would
 * fail the other way: silently, months later, with a panel nobody can reach.
 *
 * No upstream file is touched. Panels are hidden by a class on the host, which
 * is upstream's own mechanism for exactly this (`.mobile-cat-hidden`,
 * `main.css:27511`) — it hides rather than destroys, so a chart keeps its
 * state across a page switch instead of re-fetching.
 */

import { PANEL_CATEGORY_MAP } from '../config/panels';
import { PANEL_ATTRIBUTE } from '../themes/engine';

/** Marks a panel host the current page does not include. */
export const HIDDEN_CLASS = 'wm-page-hidden';
/** Set on the grid while a page filter is active. */
export const FILTERED_CLASS = 'wm-page-filtered';

/** Structural ramp tone, per the design system's archetype table. */
export type PageTone = 'tan' | 'lilac' | 'periwinkle' | 'ice' | 'cream';

export interface PageDefinition {
  id: string;
  /** Shown on the nav console. All capitals, per the design system. */
  label: string;
  /** Archetype from `docs/DESIGN-SYSTEM.md`. Drives the frame tone. */
  tone: PageTone;
  /** Upstream category keys this page draws from. */
  categories: string[];
}

/**
 * The page set.
 *
 * Five archetypes, mapped onto upstream's categories. The mapping is a
 * judgement about what belongs on a wall in one room rather than a derivation,
 * so it is the one thing here worth re-tuning by hand.
 *
 * **The archetype tones deliberately diverge from the design system on one
 * point.** Its table gives LONG RANGE SCAN a peach/salmon frame, but salmon
 * `#cc6666` is status-only in this fork — its sole use is the alert block, and
 * there is a test asserting it appears nowhere in the chrome at rest. A page
 * permanently wearing the alert colour would make an actual alert mean
 * nothing, so SCAN takes lilac from the structural ramp instead.
 */
export const PAGES: PageDefinition[] = [
  { id: 'ops', label: 'OPS', tone: 'tan', categories: ['core'] },
  {
    id: 'scan',
    label: 'SCAN',
    tone: 'lilac',
    categories: ['intelligence', 'correlation'],
  },
  {
    id: 'comms',
    label: 'COMMS',
    tone: 'periwinkle',
    categories: ['regionalNews', 'topical', 'happyNews', 'happyPlanet'],
  },
  {
    id: 'engineering',
    label: 'ENGINEERING',
    tone: 'ice',
    categories: [
      'marketsFinance',
      'techMarkets',
      'finMarkets',
      'commodityPrices',
      'cryptoDigital',
      'centralBanksEcon',
    ],
  },
  {
    id: 'library',
    label: 'LIBRARY',
    tone: 'cream',
    categories: ['dataTracking', 'techAi', 'startupsVc', 'securityPolicy'],
  },
];

/** Panel keys a page covers, resolved through upstream's category map. */
export function panelKeysFor(page: PageDefinition): Set<string> {
  const keys = new Set<string>();
  for (const category of page.categories) {
    for (const key of PANEL_CATEGORY_MAP[category]?.panelKeys ?? []) keys.add(key);
  }
  return keys;
}

/**
 * Pages with at least one panel the dashboard is actually rendering.
 *
 * A button that navigates to an empty page is the same failure as a rail
 * button naming a panel upstream does not render: it silently does nothing,
 * which on a wall display is indistinguishable from a broken one. Most of the
 * 189 panels are disabled on any given install, so this is the common case
 * rather than an edge.
 */
export function availablePages(doc: Document = document): PageDefinition[] {
  const rendered = new Set<string>();
  for (const host of doc.querySelectorAll<HTMLElement>(`[${PANEL_ATTRIBUTE}]`)) {
    const key = host.getAttribute(PANEL_ATTRIBUTE);
    if (key) rendered.add(key);
  }
  if (rendered.size === 0) return [];

  return PAGES.filter((page) => {
    for (const key of panelKeysFor(page)) if (rendered.has(key)) return true;
    return false;
  });
}

export function pageById(id: string): PageDefinition | null {
  return PAGES.find((page) => page.id === id) ?? null;
}

/**
 * Shows one page and hides the rest.
 *
 * Returns the panels left visible. Hidden rather than removed: upstream owns
 * this markup, and a chart rendered while `display: none` comes back at zero
 * width — which is why upstream's own filter dispatches a resize afterwards
 * and why this does too.
 */
export function showPage(id: string, doc: Document = document): number {
  const page = pageById(id);
  const hosts = [...doc.querySelectorAll<HTMLElement>(`[${PANEL_ATTRIBUTE}]`)];
  const grid = hosts[0]?.parentElement ?? null;

  if (!page) {
    for (const host of hosts) host.classList.remove(HIDDEN_CLASS);
    grid?.classList.remove(FILTERED_CLASS);
    return hosts.length;
  }

  const allowed = panelKeysFor(page);
  let visible = 0;
  for (const host of hosts) {
    const key = host.getAttribute(PANEL_ATTRIBUTE) ?? '';
    const show = allowed.has(key);
    host.classList.toggle(HIDDEN_CLASS, !show);
    if (show) visible += 1;
  }
  grid?.classList.add(FILTERED_CLASS);

  // Charts rendered while hidden come back at zero width. Upstream's own
  // category filter nudges them the same way.
  try {
    doc.defaultView?.dispatchEvent(new Event('resize'));
  } catch {
    // happy-dom in a unit test may have no defaultView. Not worth failing for.
  }
  return visible;
}

/** Clears every page class, for chrome teardown. Exactly inverse to `showPage`. */
export function clearPages(doc: Document = document): void {
  for (const host of doc.querySelectorAll<HTMLElement>(`.${HIDDEN_CLASS}`)) {
    host.classList.remove(HIDDEN_CLASS);
    if (host.getAttribute('class') === '') host.removeAttribute('class');
  }
  for (const grid of doc.querySelectorAll<HTMLElement>(`.${FILTERED_CLASS}`)) {
    grid.classList.remove(FILTERED_CLASS);
    if (grid.getAttribute('class') === '') grid.removeAttribute('class');
  }
}
