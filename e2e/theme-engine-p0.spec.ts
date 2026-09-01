import { expect, test, type Page } from '@playwright/test';

/**
 * P0 acceptance for the theme engine (SCOPE.md §5).
 *
 *   1. `default` renders unmodified upstream pixel-for-pixel.
 *   2. Twenty theme-cycle iterations leave the DOM structurally identical.
 *
 * Runs at the kiosk's fixed 1280x720 (playwright.config.ts `use.viewport`).
 *
 * How criterion 1 is proved without a pre-fork golden image: the `default`
 * theme is a passthrough that emits no declarations, so "unmodified upstream"
 * is reproducible inside a single page — neutralise the engine (drop its
 * attribute, empty its style element) and the result IS upstream. Comparing
 * the two states in one page, back to back, also removes the whole class of
 * flake a stored baseline would carry: live feed data, clocks and deploy-time
 * asset hashes are identical on both sides of the comparison because they are
 * literally the same page.
 */

const SHELL = '[data-wm-shell]';
const TOKEN_STYLE = '#wm-theme-tokens';

async function loadDashboard(page: Page, themeQuery = ''): Promise<void> {
  await page.goto(`/${themeQuery}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.documentElement.dataset.wmEventHandlersReady === 'true',
    undefined,
    { timeout: 60_000 },
  );
  await page.locator(SHELL).waitFor({ timeout: 30_000 });
}

/**
 * Removes everything the engine contributes to the cascade, leaving the page
 * in the state it would be in if `bootThemes()` had never been called.
 */
async function neutraliseEngine(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-wm-theme');
    const style = document.getElementById('wm-theme-tokens');
    if (style) style.textContent = '';
  });
}

/**
 * Diffs every computed declaration of every element, themed vs un-themed.
 *
 * The comparison runs ENTIRELY in the page and returns only a bounded summary.
 * A dashboard of this size has roughly 1.7M (element, property) pairs, and
 * shipping those across the CDP bridge to compare them in Node does not
 * complete — the first cut of this test hung until the suite timeout. Counting
 * and diffing in-page costs milliseconds and sends back a few hundred bytes.
 */
async function computedStyleDiff(
  page: Page,
): Promise<{ compared: number; diffs: string[] }> {
  return page.evaluate(() => {
    const capture = (): string[] => {
      const rows: string[] = [];
      document.querySelectorAll<HTMLElement>('*').forEach((el, index) => {
        const style = getComputedStyle(el);
        // cssText is empty for computed styles in Chromium, so walk the
        // indexed property list instead.
        for (let i = 0; i < style.length; i += 1) {
          const prop = style.item(i);
          rows.push(`${index}|${el.tagName}|${prop}|${style.getPropertyValue(prop)}`);
        }
      });
      return rows;
    };

    const themed = capture();

    document.documentElement.removeAttribute('data-wm-theme');
    const tokenStyle = document.getElementById('wm-theme-tokens');
    if (tokenStyle) tokenStyle.textContent = '';

    const upstream = capture();

    const diffs: string[] = [];
    const limit = Math.min(themed.length, upstream.length);
    for (let i = 0; i < limit && diffs.length < 20; i += 1) {
      if (themed[i] !== upstream[i]) diffs.push(`${themed[i]} != ${upstream[i]}`);
    }
    if (themed.length !== upstream.length) {
      diffs.push(`element/property count changed: ${themed.length} -> ${upstream.length}`);
    }
    return { compared: themed.length, diffs };
  });
}

function shot(page: Page): Promise<Buffer> {
  return page.screenshot({ animations: 'disabled', caret: 'hide' });
}

/**
 * Screenshots the page repeatedly until two consecutive captures are byte
 * identical, and returns that stable image.
 *
 * This is what makes a pixel-exact assertion possible against a dashboard that
 * is still loading: it establishes that the page has stopped repainting of its
 * own accord, so any subsequent difference is attributable to the change under
 * test. Fails loudly rather than silently degrading to a tolerance if the page
 * never settles.
 */
async function waitForVisualStability(page: Page, attempts = 12): Promise<Buffer> {
  let previous = await shot(page);
  for (let i = 0; i < attempts; i += 1) {
    await page.waitForTimeout(1000);
    const next = await shot(page);
    if (Buffer.compare(previous, next) === 0) return next;
    previous = next;
  }
  throw new Error('dashboard never stopped repainting; cannot make a pixel-exact comparison');
}

test.describe('P0 — default theme is upstream, unmodified', () => {
  test('contributes no declarations to the cascade', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=default');

    await expect(page.locator('html')).toHaveAttribute('data-wm-theme', 'default');
    // The engine owns exactly one style element, and under `default` it is empty.
    await expect(page.locator(TOKEN_STYLE)).toHaveCount(1);
    expect(await page.locator(TOKEN_STYLE).textContent()).toBe('');
    // No theme chrome, and no stray shell class or inline custom property.
    await expect(page.locator('.lcars-frame')).toHaveCount(0);
  });

  test('computes identically to a page with no theme engine at all', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=default');

    const { compared, diffs } = await computedStyleDiff(page);

    // Deterministic, and strictly stronger than a screenshot: this compares
    // every computed property of every element, including ones a screenshot
    // cannot see (scroll behaviour, off-screen colours, print styles).
    expect(compared).toBeGreaterThan(1000);
    expect(diffs).toEqual([]);
  });

  test('renders pixel-for-pixel identically to upstream', async ({ page }) => {
    // Timers are installed before navigation and paused once the dashboard is
    // up. Disabling CSS animation is not enough on this page: clocks, relative
    // timestamps and feed polling repaint from JS, so there is no naturally
    // byte-stable window to screenshot in. Pausing the clock creates one.
    // Fixed start, then pause at a later fixed instant: `pauseAt` only moves
    // forward, so both values have to come from the same synthetic timeline
    // rather than from the real clock, which advances underneath the test.
    const start = new Date('2026-01-01T00:00:00Z');
    const paused = new Date('2026-01-01T00:05:00Z');
    await page.clock.install({ time: start });
    await loadDashboard(page, '?wm-theme=default');
    await page.clock.pauseAt(paused);

    // Kill animation and caret motion so the only thing that could differ
    // between the two captures is the theme layer under test.
    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }`,
    });

    // The dashboard keeps painting as feeds arrive, so two screenshots taken a
    // moment apart differ for reasons that have nothing to do with theming.
    // Wait for the page to stop changing on its own first — otherwise this
    // test measures upstream's load schedule, not the theme layer.
    const settled = await waitForVisualStability(page);

    await neutraliseEngine(page);
    const withoutEngine = await shot(page);

    // Byte equality. `default` emits nothing, so anything short of an exact
    // match means the engine has leaked into the render.
    expect(Buffer.compare(settled, withoutEngine)).toBe(0);
  });
});

test.describe('P0 — theme cycling is lossless', () => {
  test('twenty iterations leave the DOM structurally identical to boot', async ({ page }) => {
    const start = new Date('2026-01-01T00:00:00Z');
    await page.clock.install({ time: start });
    await loadDashboard(page, '?wm-theme=default');
    await page.clock.pauseAt(new Date('2026-01-01T00:05:00Z'));
    // Pausing the clock stops upstream scheduling new work, but a response
    // already in flight can still land and rewrite a panel body. Applying a
    // theme now awaits its stylesheet, which yields to the event loop far more
    // than the old synchronous path did, so that window is real. Wait for the
    // page to go quiet before capturing; tolerate never settling rather than
    // failing here, since the assertion below is the actual subject.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    // Applying a theme is async (its stylesheet is fetched on demand), so the
    // sixty switches cannot run in one synchronous block and upstream is free
    // to interleave a render. Pausing the clock stops the timers that drive
    // those renders, which is what makes a before/after DOM comparison mean
    // "the theme layer changed something" rather than "a feed arrived".
    const { before, after } = await page.evaluate(async () => {
      const { themes } = await import('/src/themes/index.ts');
      const shell = () => document.querySelector('[data-wm-shell]')?.outerHTML ?? '';

      const captured = shell();
      for (let i = 0; i < 20; i += 1) {
        await themes.apply('lcars');
        await themes.apply('lcars-bright');
        await themes.apply('default');
      }
      return { before: captured, after: shell() };
    });

    expect(after).toBe(before);
    await expect(page.locator(TOKEN_STYLE)).toHaveCount(1);
    await expect(page.locator('.lcars-frame')).toHaveCount(0);
  });
});

test.describe('P0 — switching and persistence', () => {
  test('a chosen theme survives a reload', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(async () => {
      const { themes } = await import('/src/themes/index.ts');
      await themes.apply('lcars');
    });
    await expect(page.locator('html')).toHaveAttribute('data-wm-theme', 'lcars');

    await loadDashboard(page);
    await expect(page.locator('html')).toHaveAttribute('data-wm-theme', 'lcars');
    await expect(page.locator('.lcars-frame')).toHaveCount(1);
  });

  test('a URL pin overrides storage without becoming sticky', async ({ page }) => {
    await loadDashboard(page);
    await page.evaluate(async () => {
      const { themes } = await import('/src/themes/index.ts');
      await themes.apply('lcars');
    });

    // The kiosk unit pins a theme in its launch URL; a debugging query string
    // must not silently rewrite what the panel boots into next time.
    await loadDashboard(page, '?wm-theme=default');
    await expect(page.locator('html')).toHaveAttribute('data-wm-theme', 'default');
    expect(await page.evaluate(() => localStorage.getItem('wm-theme'))).toBe('lcars');
  });

  test('an unknown persisted theme degrades to default rather than a blank kiosk', async ({
    page,
  }) => {
    await loadDashboard(page);
    await page.evaluate(() => localStorage.setItem('wm-theme', 'theme-that-was-removed'));

    await loadDashboard(page);
    await expect(page.locator('html')).toHaveAttribute('data-wm-theme', 'default');
    await expect(page.locator(SHELL)).toBeVisible();
  });
});

test.describe('P1 — LCARS frame', () => {
  test('re-parents the dashboard into the content well without losing it', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    // The frame is only correct if the real dashboard ends up inside it. A
    // frame that renders beside upstream's markup, or replaces it, would still
    // look right in a screenshot of the chrome alone.
    await expect(page.locator('.lcars-frame')).toHaveCount(1);
    await expect(page.locator('[data-wm-content] .main-content')).toHaveCount(1);
    await expect(page.locator('[data-wm-content] [data-panel]').first()).toBeVisible();

    // Header, rail and footer are all present and carry their live parts.
    await expect(page.locator('.lcars-rail .lcars-rail-btn')).toHaveCount(8);
    await expect(page.locator('.lcars-header-title')).toHaveText('WORLD MONITOR');
    await expect(page.locator('.lcars-voice')).toHaveAttribute('data-voice-state', 'idle');
  });

  test('the panel slot reaches every upstream panel host', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const panels = await page.locator('[data-wm-content] [data-panel]').count();
    expect(panels).toBeGreaterThan(0);
    await expect(page.locator('[data-panel].lcars-panel')).toHaveCount(panels);
  });

  test('a rail button drives a real theme change through the action bus', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    // DISPLAY dispatches `theme.cycle`, which bootThemes() wires to the engine.
    // Rail button and voice command must resolve to the same code path, so
    // exercising the button here is also the P3 contract under test.
    await page.locator('[data-wm-action="theme.cycle"]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-wm-theme', 'lcars');
  });

  test('upstream header fits the content well instead of being clipped', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    // The frame narrows the container, not the viewport, so upstream's own
    // "drop least-essential items" ladder (main.css:1094-1115) never fires on
    // its own and its right-hand controls run off the edge. `.main-content`
    // has overflow-x: hidden, so nothing scrolls and nothing errors — the
    // controls just vanish. Only measuring catches it.
    const fit = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.header');
      if (!header) return null;
      return { scroll: header.scrollWidth, client: header.clientWidth };
    });

    expect(fit).not.toBeNull();
    expect(fit!.scroll, 'upstream header overflows the LCARS content well').toBeLessThanOrEqual(
      fit!.client + 1,
    );
  });

  test('no text in the chrome falls below the 13px floor', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    // SCOPE.md §5 P1: legible at 2.5 m, nothing below 13px.
    //
    // Scoped to the CHROME, not `.lcars-frame *` — the dashboard now lives
    // inside the frame, and upstream's own type scale is not this theme's to
    // answer for yet. Bringing upstream panels up to the floor is part of the
    // 12-column mapping still outstanding in P1.
    const tooSmall = await page.evaluate(() => {
      const offenders: string[] = [];
      const chrome = document.querySelectorAll<HTMLElement>(
        '.lcars-header *, .lcars-rail *, .lcars-footer *',
      );
      chrome.forEach((el) => {
        if (!el.textContent?.trim()) return;
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (Number.isFinite(size) && size < 13) offenders.push(`${el.className}: ${size}px`);
      });
      return offenders;
    });

    expect(tooSmall).toEqual([]);
  });
});

test.describe('P1 — LCARS assets and grid', () => {
  test('renders its chrome with zero network dependency', async ({ page }) => {
    // SCOPE.md §5 P1 acceptance. A kiosk on a LAN must not need Google Fonts
    // to draw its own frame, and a font that silently falls back to Arial
    // Narrow changes every cap height in the rail.
    const external: string[] = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (/fonts\.(googleapis|gstatic)\.com/.test(url)) external.push(url);
      return route.continue();
    });

    await loadDashboard(page, '?wm-theme=lcars');
    await page.evaluate(() => document.fonts.ready);

    expect(external, 'chrome reached out to Google Fonts').toEqual([]);
    const loaded = await page.evaluate(() => document.fonts.check('16px Antonio'));
    expect(loaded, 'self-hosted Antonio did not load').toBe(true);

    const family = await page.locator('.lcars-rail-label').first().evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(family).toContain('Antonio');
  });

  test('serves every sound the theme declares', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const urls = await page.evaluate(async () => {
      const { themes } = await import('/src/themes/index.ts');
      return Object.values(themes.current?.sounds ?? {}) as string[];
    });
    expect(urls.length).toBeGreaterThan(0);

    for (const url of urls) {
      const res = await page.request.get(url);
      expect(res.status(), `${url} is not served`).toBe(200);
      // Ogg container magic. A 200 that returns the SPA's index.html would
      // otherwise pass a status-only check and fail silently at playback.
      const body = await res.body();
      expect(body.subarray(0, 4).toString('latin1'), `${url} is not Ogg`).toBe('OggS');
    }
  });

  test('the rail is a column of squared blocks, not pills', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const radii = await page.locator('.lcars-rail-btn').evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).borderRadius),
    );
    expect(radii.length).toBe(8);
    // Every individual block is square; only the column's caps terminate in a
    // curve where it meets the header elbow and the footer.
    for (const radius of radii) expect(radius).toBe('0px');
  });

  test('maps upstream panels onto whole numbers of twelve columns', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const grid = await page.evaluate(() => {
      const g = document.querySelector<HTMLElement>('#panelsGrid');
      if (!g) return null;
      const columns = getComputedStyle(g).gridTemplateColumns.split(' ').length;
      const spans = [...g.querySelectorAll<HTMLElement>(':scope > .panel')].map(
        (el) => getComputedStyle(el).gridColumn,
      );
      const widths = [...g.querySelectorAll<HTMLElement>(':scope > .panel')].map((el) =>
        Math.round(el.getBoundingClientRect().width),
      );
      return { columns, spans, widths };
    });

    expect(grid).not.toBeNull();
    expect(grid!.columns, 'panels grid is not twelve columns').toBe(12);
    expect(grid!.spans.length).toBeGreaterThan(0);
    for (const span of grid!.spans) {
      expect(span, `"${span}" is not a whole-column span`).toMatch(/^span \d+( \/ span \d+)?$/);
    }
    // No panel squeezed under the 280px upstream itself declares it needs —
    // the failure mode that made panel titles ellipsis to a single letter.
    for (const width of grid!.widths) expect(width).toBeGreaterThanOrEqual(270);
  });

  test('a rail button focuses the real upstream panel it names', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    // STRESS is bound to panel.focus:cii. The binding is only meaningful if
    // `cii` is a key upstream actually renders.
    await page.locator('[data-wm-action="panel.focus:cii"]').click();
    await expect(page.locator('[data-panel="cii"][data-wm-focus="true"]')).toHaveCount(1);
  });

  test('generates the P3 tool schema from the action registry', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const schema = await page.evaluate(async () => {
      const { getActionRouter } = await import('/src/themes/index.ts');
      return getActionRouter()?.toolSchema() ?? [];
    });

    // Every rail action must be reachable by the voice layer — that is P3's
    // acceptance criterion, and generating the schema is what guarantees it
    // rather than a second hand-maintained list drifting out of step.
    const names = schema.map((t) => t.name);
    expect(names).toContain('panel_focus');
    expect(names).toContain('theme_set');
    expect(names).toContain('voice_ptt');

    const focus = schema.find((t) => t.name === 'panel_focus');
    expect(focus?.parameters.properties.panel?.enum ?? []).toContain('cii');
  });
});

test.describe('Design system conformance', () => {
  test('the field is lifted, never pure black', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars-bright');
    // "A single step of lift stops an emissive panel reading as a dead region,
    // and it gives the gutter a faint presence rather than a void."
    const field = await page.locator('.lcars-frame').evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(field).toBe('rgb(9, 9, 9)');
  });

  test('the elbow is one block and one carve, at 2.40 : 1', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const elbow = await page.locator('.lcars-elbow').evaluate((el) => {
      const own = getComputedStyle(el);
      const carve = getComputedStyle(el, '::after');
      return {
        outer: Number.parseFloat(own.borderTopLeftRadius),
        carveRadius: Number.parseFloat(carve.borderTopLeftRadius),
        carveWidth: Number.parseFloat(carve.width),
        carveColour: carve.backgroundColor,
        carveContent: carve.content,
        field: getComputedStyle(document.querySelector('.lcars-frame')!).backgroundColor,
      };
    });

    // The carve exists at all — this is the form that identifies the language,
    // and a plain rounded corner would pass every other assertion here.
    expect(elbow.carveContent).not.toBe('none');
    expect(elbow.carveWidth).toBeGreaterThan(0);
    // It is filled with the FIELD colour, which is what makes it read as cut
    // out of the block rather than drawn on top of it.
    expect(elbow.carveColour).toBe(elbow.field);
    // Ratio, not absolutes: closer reads as a plain corner, wider as a bubble.
    expect(elbow.outer / elbow.carveRadius).toBeCloseTo(2.4, 2);
  });

  test('holds the type scale, and the 13px floor', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const sizes = await page.evaluate(() => {
      const px = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        return el ? Math.round(Number.parseFloat(getComputedStyle(el).fontSize)) : null;
      };
      return {
        title: px('.lcars-header-title'),
        label: px('.lcars-rail-label'),
        micro: px('.lcars-rail-code'),
      };
    });

    expect(sizes.title).toBe(44);
    expect(sizes.label).toBe(15);
    expect(sizes.micro).toBe(13);
  });

  test('the rail label sits bottom-right and its code bottom-left', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    const geom = await page.locator('.lcars-rail-btn').first().evaluate((el) => {
      const btn = el.getBoundingClientRect();
      const code = el.querySelector('.lcars-rail-code')!.getBoundingClientRect();
      const label = el.querySelector('.lcars-rail-label')!.getBoundingClientRect();
      return {
        codeFromLeft: code.left - btn.left,
        labelFromRight: btn.right - label.right,
        codeFromFloor: btn.bottom - code.bottom,
        labelFromFloor: btn.bottom - label.bottom,
      };
    });

    // Code left, label right, both on the block floor.
    expect(geom.codeFromLeft).toBeLessThan(geom.labelFromRight + 40);
    expect(geom.labelFromRight).toBeLessThan(20);
    expect(Math.abs(geom.codeFromFloor - geom.labelFromFloor)).toBeLessThan(3);
  });

  test('the status tag stays rectangular', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');
    // "The only rectangular element, which is exactly why the eye finds it in
    // a field of pills."
    const radius = await page.locator('.lcars-voice').evaluate(
      (el) => getComputedStyle(el).borderRadius,
    );
    expect(radius).toBe('0px');
  });

  test('spends salmon and red on nothing but status', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    // The one non-negotiable rule in the colour contract. Checked against the
    // chrome at rest: the alert state is their sole legitimate use, so at
    // idle neither may appear on any frame element.
    const offenders = await page.evaluate(() => {
      const salmon = 'rgb(204, 102, 102)';
      const critical = 'rgb(255, 51, 0)';
      const bad: string[] = [];
      document.querySelectorAll<HTMLElement>('.lcars-frame > *, .lcars-frame > * > *').forEach(
        (el) => {
          const bg = getComputedStyle(el).backgroundColor;
          if (bg === salmon || bg === critical) bad.push(`${el.className}: ${bg}`);
        },
      );
      return bad;
    });

    expect(offenders).toEqual([]);
  });

  test('cuts rather than fades — no transitions inside the frame', async ({ page }) => {
    await loadDashboard(page, '?wm-theme=lcars');

    // "LCARS cuts, it does not fade." Upstream ships transitions of its own,
    // and inheriting them inside the frame is the most theme-breaking thing
    // that can happen without anyone editing the stylesheet.
    const animated = await page.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll<HTMLElement>('.lcars-frame *').forEach((el) => {
        const d = getComputedStyle(el).transitionDuration;
        if (d && d !== '0s' && !d.split(', ').every((v) => v === '0s')) {
          bad.push(`${el.tagName}.${el.className}: ${d}`);
        }
      });
      return bad.slice(0, 10);
    });

    expect(animated).toEqual([]);
  });
});

test.describe('P0 — kiosk geometry', () => {
  test('neither theme overflows the 1280x720 panel horizontally', async ({ page }) => {
    for (const theme of ['default', 'lcars', 'lcars-bright']) {
      await loadDashboard(page, `?wm-theme=${theme}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${theme} overflows horizontally`).toBeLessThanOrEqual(1);

      const vertical = await page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      );
      expect(vertical, `${theme} overflows vertically`).toBeLessThanOrEqual(1);
    }
  });
});
