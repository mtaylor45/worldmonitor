import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SURFACE,
  SURFACE_ATTRIBUTE,
  applySurface,
  currentSurface,
  detectSurface,
  lastKnownPage,
  openBus,
} from '@/surface';
import {
  HIDDEN_CLASS,
  PAGES,
  availablePages,
  clearPages,
  panelKeysFor,
  showPage,
} from '@/pages';
import { startPages } from '@/pages/controller';
import { createActions, installActions } from '@/themes/actions';
import { PANEL_ATTRIBUTE } from '@/themes/engine';

/**
 * Two displays: a 2U 1280x400 dashboard and a 1U 1424x280 console.
 *
 * What is worth testing is the seam between them — surface identity, the page
 * filter, and the bus that keeps them agreeing — rather than the geometry,
 * which is pixels and belongs in the e2e suite.
 */

const theme = { set: () => undefined, cycle: () => undefined, ids: () => ['lcars'] };

function dashboard(keys: string[] = ['map', 'cii', 'markets']): void {
  document.body.innerHTML = `<div id="app"><div class="panels-grid">${keys
    .map((k) => `<div class="panel" ${PANEL_ATTRIBUTE}="${k}"></div>`)
    .join('')}</div></div>`;
}

/** A bus that delivers synchronously to its peers, like two windows would. */
function pairedBus() {
  const peers: ((m: unknown) => void)[] = [];
  const make = (id: string) =>
    openBus({
      id,
      channelFactory: () => {
        const channel = {
          onmessage: null as ((e: MessageEvent) => void) | null,
          postMessage: (data: unknown) => {
            for (const peer of peers) peer(data);
          },
          close: () => undefined,
        };
        peers.push((data) => channel.onmessage?.({ data } as MessageEvent));
        return channel as unknown as BroadcastChannel;
      },
    });
  return { make };
}

describe('surface identity', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(SURFACE_ATTRIBUTE);
  });

  it('takes a URL pin, as the theme does', () => {
    // A kiosk display has no keyboard: its identity comes from how it was
    // launched, never from storage that could wedge.
    const win = { location: { search: '?wm-surface=nav' }, innerHeight: 720 };
    expect(detectSurface(win as unknown as Window)).toBe('nav');
  });

  it('falls back to the viewport when nothing is pinned', () => {
    const at = (h: number) =>
      detectSurface({ location: { search: '' }, innerHeight: h } as unknown as Window);
    expect(at(280)).toBe('nav');
    expect(at(400)).toBe('dashboard');
    expect(at(720)).toBe('panel');
  });

  it('ignores a pin that names no surface', () => {
    const win = { location: { search: '?wm-surface=bridge' }, innerHeight: 720 };
    expect(detectSurface(win as unknown as Window)).toBe(DEFAULT_SURFACE);
  });

  it('stamps the attribute the stylesheet keys off', () => {
    applySurface('dashboard');
    expect(document.documentElement.getAttribute(SURFACE_ATTRIBUTE)).toBe('dashboard');
    expect(currentSurface()).toBe('dashboard');
  });

  it('reports the default when nothing is stamped', () => {
    expect(currentSurface()).toBe(DEFAULT_SURFACE);
  });
});

describe('pages', () => {
  beforeEach(() => dashboard());

  it('derives its panel keys from upstream\'s category map', () => {
    // Never duplicated: a panel upstream adds lands on a page with no edit
    // here, and a rename breaks the build rather than the display.
    const ops = PAGES.find((p) => p.id === 'ops')!;
    expect(panelKeysFor(ops).has('map')).toBe(true);
    expect(panelKeysFor(ops).size).toBeGreaterThan(0);
  });

  it('hides the panels a page does not include, and keeps them in the DOM', () => {
    // Hidden rather than removed: upstream owns this markup, and a chart
    // rendered at zero width does not recover on its own.
    showPage('ops');
    const cii = document.querySelector(`[${PANEL_ATTRIBUTE}="cii"]`)!;
    expect(cii.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(document.querySelectorAll(`[${PANEL_ATTRIBUTE}]`)).toHaveLength(3);
  });

  it('only offers pages the dashboard is actually rendering', () => {
    // A button navigating to an empty page is the same failure as a rail
    // button naming a panel that does not exist: it silently does nothing.
    dashboard(['map']);
    const ids = availablePages().map((p) => p.id);
    expect(ids).toContain('ops');
    expect(ids).not.toContain('engineering');
  });

  it('offers nothing before upstream has rendered', () => {
    document.body.innerHTML = '';
    expect(availablePages()).toEqual([]);
  });

  it('clears losslessly', () => {
    // Same rule chrome and the alert attribute hold to: an empty class
    // attribute is still an attribute.
    const before = document.body.innerHTML;
    showPage('ops');
    clearPages();
    expect(document.body.innerHTML).toBe(before);
  });

  it('an unknown page shows everything rather than nothing', () => {
    // Failing open: a blank dashboard is worse than an unfiltered one.
    showPage('warp-core');
    expect(document.querySelectorAll(`.${HIDDEN_CLASS}`)).toHaveLength(0);
  });
});

describe('two displays agreeing', () => {
  beforeEach(() => {
    dashboard();
    try {
      window.localStorage.clear();
    } catch {
      /* not every environment has it */
    }
  });

  it('a page selected on the console reaches the dashboard', () => {
    const { make } = pairedBus();
    const nav = startPages({ bus: make('nav') });
    const main = startPages({ bus: make('dashboard') });

    nav.set('engineering');

    expect(main.current()).toBe('engineering');
    nav.dispose();
    main.dispose();
  });

  it('does not volley a change back and forth forever', () => {
    // Each display applies what it receives without re-broadcasting, or the
    // two would keep answering each other.
    const { make } = pairedBus();
    const posts: string[] = [];
    const busA = make('a');
    const original = busA.post.bind(busA);
    busA.post = (m) => {
      posts.push(m.id);
      return original(m);
    };
    const a = startPages({ bus: busA });
    const b = startPages({ bus: make('b') });

    b.set('scan');

    expect(a.current()).toBe('scan');
    expect(posts).toEqual([]);
    a.dispose();
    b.dispose();
  });

  it('a display that boots second joins the page already showing', () => {
    // The normal case: one panel powers on before the other.
    const { make } = pairedBus();
    const first = startPages({ bus: make('first') });
    first.set('library');

    const second = startPages({ bus: make('second') });
    expect(second.current()).toBe('library');
    expect(lastKnownPage()).toBe('library');
    first.dispose();
    second.dispose();
  });

  it('refuses a page id no page claims', () => {
    const pages = startPages({ bus: pairedBus().make('x') });
    expect(pages.set('warp-core')).toBe(false);
    pages.dispose();
  });

  it('survives a browser with no BroadcastChannel at all', () => {
    // Policy can disable it. The panel must still work on its own.
    const bus = openBus({ channelFactory: () => null });
    expect(() => bus.post({ type: 'page', id: 'ops' })).not.toThrow();
    bus.close();
  });
});

describe('page actions', () => {
  beforeEach(() => dashboard());

  function wire(pages = startPages({ bus: pairedBus().make('t') })) {
    const router = installActions(
      createActions(theme, undefined, {
        set: (id) => pages.set(id),
        next: () => pages.next(),
        current: () => pages.current(),
        ids: () => PAGES.map((p) => p.id),
        pageFor: (key) => pages.pageFor(key),
      }),
    );
    return { router, pages };
  }

  it('exposes page.set and page.next to voice and touch alike', () => {
    const { router, pages } = wire();
    expect(router.actionNames()).toContain('page.set');
    expect(router.handle('page.set', 'scan')).toBe(true);
    expect(pages.current()).toBe('scan');
    router.dispose();
    pages.dispose();
  });

  it('focusing a panel on another page switches to it first', () => {
    // Without this the command scrolls to a hidden element and silently does
    // nothing — indistinguishable from a broken display on a wall panel.
    const { router, pages } = wire();
    pages.set('ops');

    expect(router.handle('panel.focus', 'cii')).toBe(true);
    expect(pages.current()).toBe('scan');
    router.dispose();
    pages.dispose();
  });

  it('omits page actions entirely when no controller is wired', () => {
    // Not registered-and-failing: `actionNames()` feeds the model's snapshot,
    // so a dead action would be offered to the assistant and then refused.
    const router = installActions(createActions(theme));
    expect(router.actionNames()).not.toContain('page.set');
    expect(router.toolSchema().map((t) => t.name)).not.toContain('page_set');
    expect(router.handle('page.set', 'ops')).toBe(false);
    router.dispose();
  });
});
