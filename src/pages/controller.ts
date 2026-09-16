/**
 * Keeps both displays on the same page.
 *
 * The dashboard shows a page; the console lights the button for it. Either can
 * change it — a touch on the console, a voice command, or `panel.focus` for a
 * panel that is not on the current page — and whichever does broadcasts, so
 * the other follows.
 *
 * Two things make this harder than it reads.
 *
 * **Upstream rebuilds the panel grid by assigning `innerHTML`.** Page classes
 * are wiped when it does, exactly as chrome is, so the current page has to be
 * re-applied. The observer is disconnected across its own writes, because
 * re-applying classes is itself a mutation and would otherwise loop.
 *
 * **A display can boot second.** The page is read from the bus's last write at
 * startup, so a panel powering on late joins the page its sibling is already
 * showing rather than resetting both to the first one.
 */

import {
  PAGES,
  availablePages,
  clearPages,
  pageById,
  panelKeysFor,
  showPage,
  type PageDefinition,
} from './index';
import { PANEL_ATTRIBUTE } from '../themes/engine';
import { currentSurface, lastKnownPage, openBus, type SurfaceBus } from '../surface';

export interface PageController {
  /** Current page id. */
  current(): string;
  /** Switches page. Returns false for an id no page claims. */
  set(id: string, options?: { broadcast?: boolean }): boolean;
  /** Advances to the next available page. */
  next(): boolean;
  /** The page a panel key lives on, or null. */
  pageFor(key: string): PageDefinition | null;
  dispose(): void;
}

export interface PageOptions {
  doc?: Document;
  win?: Window;
  bus?: SurfaceBus;
  /** Called after every change, on both surfaces. */
  onChange?: (id: string, available: string[]) => void;
}

export function startPages(options: PageOptions = {}): PageController {
  const doc = options.doc ?? document;
  const win = options.win ?? doc.defaultView ?? window;
  const bus = options.bus ?? openBus({ win });
  const surface = currentSurface(doc);

  // The console renders no panels, so it must not hide any: `showPage` there
  // would find the parked dashboard and filter it for nothing.
  const filters = surface !== 'nav';

  let active = lastKnownPage(win) ?? PAGES[0]?.id ?? '';
  let observer: MutationObserver | null = null;

  function apply(id: string): void {
    // Disconnected across our own writes: toggling a class is a mutation, and
    // reacting to it would re-enter here forever.
    observer?.disconnect();
    try {
      if (filters) showPage(id, doc);
      options.onChange?.(id, availablePages(doc).map((p) => p.id));
    } finally {
      observe();
    }
  }

  function observe(): void {
    if (!filters || !observer) return;
    const root = doc.querySelector('[data-wm-content]') ?? doc.body;
    if (root) observer.observe(root, { childList: true, subtree: true });
  }

  const controller: PageController = {
    current: () => active,

    set(id, { broadcast = true } = {}) {
      if (!pageById(id)) return false;
      active = id;
      apply(id);
      // Posted even when the id did not change: the other display may have
      // booted since and be showing something else.
      if (broadcast) bus.post({ type: 'page', id });
      return true;
    },

    next() {
      const ids = (availablePages(doc).length ? availablePages(doc) : PAGES).map((p) => p.id);
      if (ids.length === 0) return false;
      const at = ids.indexOf(active);
      return controller.set(ids[(at + 1) % ids.length] ?? ids[0]!);
    },

    pageFor(key) {
      if (!key) return null;
      // Resolved through the same helper the filter uses, so "which page is
      // this panel on" can never disagree with "what does this page show".
      return PAGES.find((page) => keysFor(page).has(key)) ?? null;
    },

    dispose() {
      observer?.disconnect();
      observer = null;
      unsubscribe();
      if (filters) clearPages(doc);
    },
  };

  // A page change from the other display is applied but not re-broadcast,
  // or the two would volley one message back and forth forever.
  const unsubscribe = bus.subscribe((message) => {
    if (message.type !== 'page' || message.id === active) return;
    controller.set(message.id, { broadcast: false });
  });

  if (filters && typeof MutationObserver === 'function') {
    observer = new MutationObserver((records) => {
      // Only when panels actually came or went. Upstream repaints readings
      // several times a second, and re-filtering on every text change would
      // be work for nothing.
      const structural = records.some((r) =>
        [...r.addedNodes, ...r.removedNodes].some(
          (n) => n instanceof HTMLElement && (n.hasAttribute(PANEL_ATTRIBUTE) || n.querySelector(`[${PANEL_ATTRIBUTE}]`)),
        ),
      );
      if (structural) apply(active);
    });
  }

  apply(active);
  return controller;
}

/**
 * Memoised panel keys per page.
 *
 * `pageFor` runs on every `panel.focus`, and the page definitions are frozen
 * for the life of the process, so rebuilding the sets each time is work with a
 * known answer.
 */
const keyCache = new WeakMap<PageDefinition, Set<string>>();

function keysFor(page: PageDefinition): Set<string> {
  let keys = keyCache.get(page);
  if (!keys) {
    keys = panelKeysFor(page);
    keyCache.set(page, keys);
  }
  return keys;
}
