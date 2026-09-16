import { expect, test, type Page } from '@playwright/test';

/**
 * The two-display kiosk, at its real resolutions.
 *
 *   dashboard   2U   1280x400
 *   nav         1U   1424x280
 *
 * Everything here is pixels, which is exactly why it is an end-to-end test and
 * not a unit one. The point of the split is that the dashboard fits a display
 * 55% of the height the frame was drawn for, and nothing but a browser at that
 * size can tell you whether it does.
 */

const SHELL = '[data-wm-shell]';

const DASHBOARD = { width: 1280, height: 400 };
const NAV = { width: 1424, height: 280 };

async function load(
  page: Page,
  surface: string,
  size: { width: number; height: number },
  theme = 'lcars',
) {
  await page.setViewportSize(size);
  await page.goto(`/?wm-theme=${theme}&wm-surface=${surface}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.wmEventHandlersReady === 'true',
    undefined,
    { timeout: 60_000 },
  );
  await page.locator(SHELL).waitFor({ timeout: 30_000 });
}

async function overflow(page: Page) {
  return page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
}

test.describe('2U dashboard — 1280x400', () => {
  test('fits the panel in both directions', async ({ page }) => {
    await load(page, 'dashboard', DASHBOARD);
    const over = await overflow(page);
    expect(over.x, 'overflows horizontally').toBeLessThanOrEqual(1);
    expect(over.y, 'overflows vertically').toBeLessThanOrEqual(1);
  });

  test('drops the rail and gives the width back to the content well', async ({ page }) => {
    // The rail was costing 148px of 1280. At 400px tall every pixel of the
    // well is needed, and navigation now lives on the other display.
    await load(page, 'dashboard', DASHBOARD);

    await expect(page.locator('.lcars-rail')).toHaveCount(0);
    const well = await page.locator('[data-wm-content]').evaluate((el) => el.clientWidth);
    expect(well).toBeGreaterThan(1200);
  });

  test('spends less than a third of its height on frame', async ({ page }) => {
    // At 720px the frame cost 112px — 16%. The same frame at 400px would be
    // 28% before the content got a pixel, which is why header and footer scale.
    await load(page, 'dashboard', DASHBOARD);

    const wellHeight = await page
      .locator('[data-wm-content]')
      .evaluate((el) => el.clientHeight);
    expect(wellHeight / DASHBOARD.height).toBeGreaterThan(0.7);
  });

  test('the elbow still renders at 2.40 : 1 rather than clamping flat', async ({ page }) => {
    // The trap this surface exists to avoid. `border-radius` clamps to the
    // box, so a 72px radius on a 40px header renders at 40 — and the carve,
    // a separate box, clamps independently. The declared ratio would still
    // pass a naive check while the rendered form had become a plain corner.
    await load(page, 'dashboard', DASHBOARD);

    const elbow = await page.locator('.lcars-elbow').evaluate((el) => {
      const own = getComputedStyle(el);
      const carve = getComputedStyle(el, '::after');
      return {
        outer: Number.parseFloat(own.borderTopLeftRadius),
        inner: Number.parseFloat(carve.borderTopLeftRadius),
        height: el.getBoundingClientRect().height,
      };
    });

    expect(elbow.outer / elbow.inner).toBeCloseTo(2.4, 2);
    // Neither radius exceeds the block, so neither is clamped.
    expect(elbow.outer).toBeLessThanOrEqual(elbow.height);
  });

  test('holds the 13px type floor across the shrunken chrome', async ({ page }) => {
    // The floor is a rule about CHROME. Upstream's panels inside the content
    // well keep their own 12px body type, which is the 12-column mapping's
    // decision to make and not the frame's — so the well is excluded rather
    // than the threshold lowered.
    await load(page, 'dashboard', DASHBOARD);

    const offenders = await page.evaluate(() => {
      const well = document.querySelector('[data-wm-content]');
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.lcars-frame *')) {
        if (well?.contains(el)) continue;
        if (!el.textContent?.trim()) continue;
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (size < 13) bad.push(`${el.className || el.tagName}: ${size}px`);
      }
      return bad;
    });

    expect(offenders).toEqual([]);
  });
});

test.describe('1U navigation console — 1424x280', () => {
  test('fits the strip in both directions', async ({ page }) => {
    await load(page, 'nav', NAV);
    const over = await overflow(page);
    expect(over.x, 'overflows horizontally').toBeLessThanOrEqual(1);
    expect(over.y, 'overflows vertically').toBeLessThanOrEqual(1);
  });

  test('renders page buttons and no dashboard content', async ({ page }) => {
    await load(page, 'nav', NAV);

    await expect(page.locator('[data-wm-page-btn]').first()).toBeVisible();
    // The console carries no data. Upstream's markup is parked, not destroyed,
    // so teardown can still put it back exactly as found.
    const parked = await page.locator('.lcars-parked').count();
    expect(parked).toBe(1);
    await expect(page.locator('.lcars-parked')).toBeHidden();
  });

  test('every touch target clears the 44px floor with room to spare', async ({ page }) => {
    // Touched at arm's length, by someone not looking closely, on a panel
    // with no cursor to aim with.
    await load(page, 'nav', NAV);

    const boxes = await page.locator('.lcars-nav-btn').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    );

    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.h, 'button too short to touch').toBeGreaterThanOrEqual(44);
      expect(box.w, 'button too narrow to touch').toBeGreaterThanOrEqual(44);
    }
  });

  test('press feedback is a cut, not a fade', async ({ page }) => {
    // "LCARS cuts, it does not fade" — and on touch the press has to register
    // before the finger lifts or it registers as nothing at all.
    await load(page, 'nav', NAV);
    const transition = await page
      .locator('.lcars-nav-btn')
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(transition.split(', ').every((d) => d === '0s')).toBe(true);
  });

  test('a touch on a page button selects it', async ({ page }) => {
    await load(page, 'nav', NAV);

    const scan = page.locator('[data-wm-page-btn="scan"]');
    await scan.tap({ timeout: 5_000 }).catch(async () => scan.click());

    await expect(scan).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the console tells the truth about state', () => {
  test('the active page stays lit through upstream re-mounts', async ({ page }) => {
    // Measured before the fix: OPS lit at 924ms and was dark again by 990ms.
    // Upstream rebuilds the dashboard by assigning `innerHTML`, the shell
    // observer re-mounts the chrome, and the fresh buttons came back unlit
    // because the only hook was a theme change — and a re-mount is not one.
    await load(page, 'nav', NAV);
    // Well past the rebuild that used to eat it.
    await page.waitForTimeout(6_000);

    const lit = await page.$$eval('[data-wm-page-btn].is-active', (els) =>
      els.map((el) => el.getAttribute('data-wm-page-btn')),
    );
    expect(lit, 'the console is not showing which page is up').toHaveLength(1);
  });

  test('an alert is visible on the console, not just the dashboard', async ({ page }) => {
    // The console has no elbow, stub, foot or rail button, so every selector
    // the alert state painted missed it entirely: `data-wm-alert` was set and
    // nothing changed. That is the worse half of the failure — the console is
    // at hand height and is the panel being looked at.
    await load(page, 'nav', NAV);

    const animation = () =>
      page.$eval('.lcars-nav-cap', (el) => getComputedStyle(el).animationName);

    expect(await animation()).toBe('none');
    await page.evaluate(async () => {
      const { setAlert } = await import('/src/alert/index.ts');
      setAlert(true);
    });
    expect(await animation(), 'the console stayed calm through an alert').toBe(
      'wm-lcars-alert-pulse',
    );
  });

  test('the page tones are not overwritten by the alert', async ({ page }) => {
    // They are what make a page identifiable from the doorway. Pulsing five of
    // them at 1Hz would trade one piece of information for another rather than
    // adding any.
    await load(page, 'nav', NAV);
    await page.evaluate(async () => {
      const { setAlert } = await import('/src/alert/index.ts');
      setAlert(true);
    });

    const pulsing = await page.$$eval('[data-wm-page-btn]', (els) =>
      els.filter((el) => getComputedStyle(el).animationName !== 'none').length,
    );
    expect(pulsing).toBe(0);
  });

  test('no surface warns that it is off-target', async ({ page }) => {
    // The theme declared one target while the kiosk has three, so every
    // correctly configured display logged a warning at boot — which trains the
    // operator to ignore a console that also carries `doctor` and the
    // wake-word diagnostics.
    const warnings: string[] = [];
    page.on('console', (message) => {
      // Playwright's type is 'warning', not 'warn'. Matching on the text
      // alone would also pass if the warning stopped being a warning.
      if (message.type() === 'warning' && /off-target/.test(message.text())) {
        warnings.push(message.text());
      }
    });

    for (const [surface, size] of [
      ['dashboard', DASHBOARD],
      ['nav', NAV],
      ['panel', { width: 1280, height: 720 }],
    ] as const) {
      await load(page, surface, size);
    }

    expect(warnings).toEqual([]);
  });
});

test.describe('the console actually reaches the dashboard', () => {
  test('map.focus resolves a real element', async ({ page }) => {
    // It queried `#mapPanel, .map-panel, #map` and upstream renders
    // `#mapSection`, so it returned false on every surface since P1: the
    // rail's GLOBE button, the console's, and the voice command all sounded
    // the refusal tone and moved nothing. It survived because no test asserted
    // the action SUCCEEDS — only that an unknown one fails.
    await load(page, 'dashboard', DASHBOARD);

    const handled = await page.evaluate(async () => {
      const { getActionRouter } = await import('/src/themes/index.ts');
      return getActionRouter()?.handle('map.focus') ?? null;
    });

    expect(handled, 'map.focus is a no-op again').toBe(true);
  });

  test('a layer touched on the console toggles it on the dashboard', async ({ browser }) => {
    // The console is a control surface for a DIFFERENT window, so an action
    // run locally acts on its own parked copy and does nothing anyone can see.
    const context = await browser.newContext();

    const nav = await context.newPage();
    await load(nav, 'nav', NAV);
    const dash = await context.newPage();
    await load(dash, 'dashboard', DASHBOARD);
    // The map renders its layer controls seconds after chrome mounts.
    await nav.waitForTimeout(9_000);

    const key = await dash.$$eval('.layer-toggle[data-layer]', (els) => {
      const usable = els.find((el) => !(el as HTMLButtonElement).disabled);
      return usable?.getAttribute('data-layer') ?? null;
    });
    expect(key, 'no enabled layer to exercise').not.toBeNull();

    await dash.evaluate((layer) => {
      (window as unknown as { __clicks: number }).__clicks = 0;
      document
        .querySelector(`.layer-toggle[data-layer="${layer}"]`)
        ?.addEventListener('click', () => {
          (window as unknown as { __clicks: number }).__clicks += 1;
        });
    }, key);

    await nav.evaluate((layer) => {
      const btn = [...document.querySelectorAll<HTMLElement>('.lcars-nav-layers .lcars-nav-btn')]
        .find((el) => el.dataset.wmAction === `map.layer:${layer}`);
      btn?.click();
    }, key);

    await expect
      .poll(
        () => dash.evaluate(() => (window as unknown as { __clicks: number }).__clicks),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);

    await context.close();
  });

  test('the console offers only layers the map actually rendered', async ({ page }) => {
    // Same rule as a rail button naming a real panel: a button for a layer the
    // map does not have would silently do nothing.
    await load(page, 'nav', NAV);
    await page.waitForTimeout(9_000);

    const mismatched = await page.$$eval('.lcars-nav-layers .lcars-nav-btn', (btns) =>
      btns
        .map((b) => (b as HTMLElement).dataset.wmAction?.replace('map.layer:', '') ?? '')
        .filter((key) => !document.querySelector(`.layer-toggle[data-layer="${key}"]`)),
    );

    expect(mismatched).toEqual([]);
  });
});

test.describe('the two displays together', () => {
  test('a page selected on the console reaches the dashboard', async ({ browser }) => {
    // The whole point of the split. Same origin, same profile, so the two
    // windows share a BroadcastChannel without any server between them.
    const context = await browser.newContext();

    const nav = await context.newPage();
    await load(nav, 'nav', NAV);

    const dash = await context.newPage();
    await load(dash, 'dashboard', DASHBOARD);

    const button = nav.locator('[data-wm-page-btn="engineering"]');
    await button.tap({ timeout: 5_000 }).catch(async () => button.click());

    await expect
      .poll(
        async () =>
          dash.evaluate(() => {
            const w = window as unknown as { localStorage: Storage };
            return JSON.parse(w.localStorage.getItem('wm-surface-bus') ?? '{}').id ?? null;
          }),
        { timeout: 5_000 },
      )
      .toBe('engineering');

    await context.close();
  });
});

test.describe('upstream chrome the kiosk does not want', () => {
  /** Rendered height of a selector, 0 when it is absent or hidden. */
  async function heights(page: Page) {
    return page.evaluate(() => {
      const h = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().height) : 0;
      };
      return {
        banner: h('.pro-banner-slot'),
        tabs: h('.dashboard-tabs-mount'),
        header: h('.header'),
        footer: h('.site-footer'),
        legend: h('.map-legend'),
        map: h('#mapSection'),
      };
    });
  }

  test('the Pro banner and tab bar take no space under LCARS', async ({ page }) => {
    // Between them they cost 104px of a 400px display — a quarter of the
    // screen, taken from the map.
    await load(page, 'dashboard', DASHBOARD);
    const measured = await heights(page);

    expect(measured.banner, 'Pro banner still occupies space').toBe(0);
    expect(measured.tabs, 'tab bar still occupies space').toBe(0);
  });

  test('hiding them frees real estate rather than leaving a gap', async ({ page }) => {
    // The trap: both elements have a height reserved by a PARENT that
    // survives the child being hidden — .pro-banner-slot carries a 40px
    // min-height and .dashboard-tabs-mount a 36px one. Hiding the banner
    // alone leaves a band of empty surface, which is the same space and none
    // of the information. This asserts the map actually grew.
    await load(page, 'dashboard', DASHBOARD);
    const suppressed = await heights(page);

    // Put them back exactly as upstream would have them.
    await page.addStyleTag({
      content: `
        :root[data-wm-theme^="lcars"] .pro-banner-slot,
        :root[data-wm-theme^="lcars"] .pro-banner,
        :root[data-wm-theme^="lcars"] .dashboard-tabs-mount,
        :root[data-wm-theme^="lcars"] .dashboard-tabs-bar { display: revert !important; }
        :root[data-wm-theme^="lcars"] { --wm-pro-banner-slot-height: 40px; }`,
    });
    await page.waitForTimeout(800);
    const restored = await heights(page);

    expect(restored.banner, 'the override did not restore the banner').toBeGreaterThan(0);
    expect(suppressed.map - restored.map, 'the map did not gain the space').toBeGreaterThan(60);
  });

  test('the site header and footer take no space either', async ({ page }) => {
    // Upstream's navigation: search, settings, sign-in, and a footer of
    // marketing links. There is no pointer to click them with, no account to
    // sign into, and nowhere to navigate to. 97px of a 400px display.
    await load(page, 'dashboard', DASHBOARD);
    const measured = await heights(page);

    expect(measured.header, 'site header still occupies space').toBe(0);
    expect(measured.footer, 'site footer still occupies space').toBe(0);
  });

  test('the skip link is kept, because it costs nothing', async ({ page }) => {
    // `position: fixed`, so it takes no layout at all. A keyboard is unlikely
    // on a kiosk, but free accessibility should not be thrown away to save
    // zero pixels — and the temptation to sweep it up with the rest of the
    // site furniture is exactly why this is pinned.
    await load(page, 'dashboard', DASHBOARD);

    const skip = await page.locator('.skip-link').evaluate((el) => ({
      display: getComputedStyle(el).display,
      position: getComputedStyle(el).position,
    }));

    expect(skip.display).not.toBe('none');
    expect(skip.position, 'a static skip link would cost real layout').toBe('fixed');
  });

  test('map controls move off the viewing panel, but the legend stays', async ({ page }) => {
    // The split the two-display build exists to make: the 2U panel is for
    // viewing, the 1U console is for control. The layer toggles covered 30% of
    // the map and the time slider another 5% — a third of the view, taken by
    // the furniture describing it.
    await load(page, 'dashboard', DASHBOARD);

    const covered = await page.evaluate(() => {
      const map = document.querySelector('#mapSection')!.getBoundingClientRect();
      let area = 0;
      for (const sel of ['.layer-toggles', '.time-slider']) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 10) area += r.width * r.height;
      }
      return Math.round((100 * area) / (map.width * map.height));
    });

    expect(covered, 'controls still sitting on the map').toBe(0);

    // The legend is NOT a control. It is the key to reading the colours, so
    // removing it in the name of making the map more readable would be
    // exactly backwards.
    //
    // Polled: the map draws its legend well after the shell is ready, so
    // asserting immediately races the render rather than testing anything.
    await expect
      .poll(async () => (await heights(page)).legend, { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('the 1280x720 fallback keeps its map controls', async ({ page }) => {
    // Scoped to `dashboard` on purpose: at 720px the panel surface has the
    // height to carry them, and it is the layout you develop against.
    await load(page, 'panel', { width: 1280, height: 720 });

    await expect(page.locator('.layer-toggles')).toBeVisible();
  });

  test('the suppression does not leak into the default theme', async ({ page }) => {
    // The safety net the whole engine rests on: `default` declares nothing, so
    // switching to it restores upstream exactly — including the parts of
    // upstream we would rather not look at.
    //
    // Asserted against a probe element rather than the real banner. Whether
    // upstream MOUNTS the banner depends on auth hydration, entitlement and
    // whether it was dismissed (`pro-banner-policy.ts` can return 'defer' or
    // 'suppress' on its own), so measuring the live one would be asserting
    // upstream's business logic and would flake whenever it legitimately chose
    // not to show. What is ours, and what is worth pinning, is the scope of
    // the rule.
    const probe = () =>
      page.evaluate(() => {
        const make = (cls: string) => {
          const el = document.createElement('div');
          el.className = cls;
          document.body.appendChild(el);
          return el;
        };
        const slot = make('pro-banner-slot');
        const tabs = make('dashboard-tabs-mount');
        const header = make('header');
        const footer = make('site-footer');
        const result = {
          slot: getComputedStyle(slot).display,
          tabs: getComputedStyle(tabs).display,
          header: getComputedStyle(header).display,
          footer: getComputedStyle(footer).display,
        };
        for (const el of [slot, tabs, header, footer]) el.remove();
        return result;
      });

    await load(page, 'dashboard', DASHBOARD);
    expect(await probe(), 'LCARS is not suppressing them').toEqual({
      slot: 'none',
      tabs: 'none',
      header: 'none',
      footer: 'none',
    });

    // Surface stays `dashboard`; only the THEME changes. Passing 'default' as
    // the surface would leave the page on LCARS and quietly assert nothing.
    await load(page, 'dashboard', DASHBOARD, 'default');
    const underDefault = await probe();
    for (const [name, display] of Object.entries(underDefault)) {
      expect(display, `default theme is no longer an identity theme (${name})`).not.toBe('none');
    }
  });
});

test.describe('the single-display fallback still works', () => {
  test('1280x720 is unchanged, rail and all', async ({ page }) => {
    // The original layout is the fallback when one output is connected, and
    // the target you develop against on a laptop. It must not have moved.
    await load(page, 'panel', { width: 1280, height: 720 });

    await expect(page.locator('.lcars-rail')).toHaveCount(1);
    const over = await overflow(page);
    expect(over.x).toBeLessThanOrEqual(1);
    expect(over.y).toBeLessThanOrEqual(1);
  });
});
