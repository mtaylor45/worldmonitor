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

async function load(page: Page, surface: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto(`/?wm-theme=lcars&wm-surface=${surface}`, {
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
