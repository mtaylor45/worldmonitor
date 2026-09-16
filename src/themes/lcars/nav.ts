/**
 * The navigation console — the 1U 1424x280 secondary display.
 *
 * This display carries no data. It is the control surface: pages, voice,
 * system state. Moving it off the dashboard is what makes a 400-pixel-tall
 * primary display viable at all — the vertical rail was costing 148px of the
 * 1280 width, and at 400px tall every pixel of the well is needed for panels.
 *
 * Layout, at 1424x280:
 *
 *   ┌────────┬──────────────────────────────────────────┬────────────┐
 *   │ elbow  │  page buttons — one row, touch-sized     │  voice     │
 *   │  cap   ├──────────────────────────────────────────┤  status    │
 *   │        │  action buttons — globe, listen, display │  tag       │
 *   └────────┴──────────────────────────────────────────┴────────────┘
 *
 * **Touch, not pointer.** Both displays are multi-touch and neither has a
 * cursor, which changes three things. Hover states are meaningless, so there
 * are none — no loss, since the design system forbids hover transitions
 * anyway. Targets are sized for a fingertip rather than a mouse: the shortest
 * button here is 96px, well past the 44px floor, because a wall panel is
 * touched at arm's length by someone not looking closely. And feedback on
 * press has to be instant and hard-edged — `:active` swaps the block to its
 * field colour with no transition, which is a lamp switching rather than a
 * button animating.
 */

import type { ChromeContext } from '../types';
import { layerKeys } from '../actions';
import { dispatchAction } from '../engine';
import { PAGES } from '../../pages';

/** Marks the page-button row so the page state can light the right one. */
export const PAGE_BUTTON_ATTRIBUTE = 'data-wm-page-btn';

/**
 * How many map layers the console offers.
 *
 * Upstream renders nineteen. Ten is what fits across the stack at a size that
 * can be hit with a fingertip, and the row keeps a fixed geometry rather than
 * reflowing as layers come and go — a console whose buttons move defeats the
 * muscle memory a wall panel runs on. The remainder stay reachable by voice,
 * which enumerates the full list from the registry.
 */
const MAX_LAYER_BUTTONS = 10;

/** Marks the layer row, so it can be filled after the map has rendered. */
export const LAYER_ROW_CLASS = 'lcars-nav-layers';

/** Actions the console offers beside page selection. */
const CONSOLE_ACTIONS: { id: string; label: string; tone: string; action: string }[] = [
  { id: 'globe', label: 'GLOBE', tone: 'periwinkle', action: 'map.focus' },
  { id: 'listen', label: 'LISTEN', tone: 'cream', action: 'voice.ptt' },
  { id: 'display', label: 'DISPLAY', tone: 'tan', action: 'theme.cycle' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** Four-digit Okudagram codes, derived from the id so they hold still. */
function code(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return String((h % 9000) + 1000);
}

function button(
  id: string,
  label: string,
  tone: string,
  action: string,
  ctx: ChromeContext,
): HTMLButtonElement {
  const btn = el('button', `lcars-nav-btn lcars-tone-${tone}`);
  btn.type = 'button';
  btn.dataset.wmAction = action;
  btn.appendChild(el('span', 'lcars-nav-code', code(id)));
  btn.appendChild(el('span', 'lcars-nav-label', label));
  // `click` rather than `pointerdown`: a touch that starts on a button and
  // slides off should not fire, and `click` is the only event that already
  // knows that. The press *feedback* is CSS `:active`, which is immediate, so
  // nothing is lost to the small delay.
  btn.addEventListener('click', () => ctx.dispatch(action));
  return btn;
}

/**
 * Builds the console.
 *
 * Every page in `PAGES` gets a button, not just the ones with rendered panels:
 * the console boots before upstream has finished rendering, and a row that
 * changes width a second later reads as a glitch. `src/pages/` marks the
 * unavailable ones once the dashboard reports in.
 */
export function buildNavConsole(ctx: ChromeContext): HTMLElement {
  const console_ = el('div', 'lcars-nav');

  // Elbow cap: the console's one piece of frame, so it reads as the same
  // system as the dashboard rather than as a separate toolbar.
  const cap = el('div', 'lcars-nav-cap');
  cap.appendChild(el('span', 'lcars-nav-cap-label', 'LCARS'));
  cap.appendChild(el('span', 'lcars-nav-cap-code', code('console')));
  console_.appendChild(cap);

  // Rows are added in order; the stack sizes itself to however many there are,
  // so a build with no map layers is two rows rather than two and a gap.
  const stack = el('div', 'lcars-nav-stack');

  const pages = el('nav', 'lcars-nav-row lcars-nav-pages');
  pages.setAttribute('aria-label', 'Pages');
  for (const page of PAGES) {
    const btn = button(page.id, page.label, page.tone, `page.set:${page.id}`, ctx);
    btn.setAttribute(PAGE_BUTTON_ATTRIBUTE, page.id);
    btn.setAttribute('aria-pressed', 'false');
    pages.appendChild(btn);
  }
  stack.appendChild(pages);

  // Built EMPTY. The map renders its layer controls long after chrome mounts —
  // measured at four seconds against nine hundred milliseconds — so reading
  // them here returns nothing. `syncNavLayers` fills the row once they exist.
  const layerRow = el('div', `lcars-nav-row ${LAYER_ROW_CLASS}`);
  layerRow.setAttribute('aria-label', 'Map layers');
  layerRow.hidden = true;
  stack.appendChild(layerRow);

  const actions = el('div', 'lcars-nav-row lcars-nav-actions');
  for (const item of CONSOLE_ACTIONS) {
    actions.appendChild(button(item.id, item.label, item.tone, item.action, ctx));
  }
  // The interrupt tab, breaking the run of action blocks. On a horizontal
  // console it does the same job it does on a vertical rail: gives the eye an
  // anchor so a row of equal blocks does not read as undifferentiated.
  actions.appendChild(el('div', 'lcars-interrupt', code('nav-tab').slice(0, 2)));
  stack.appendChild(actions);

  console_.appendChild(stack);

  // Status column: voice state and the live transcript, mirroring the
  // dashboard footer so a glance at either display answers "is it listening".
  const status = el('div', 'lcars-nav-status');
  const voice = el('div', 'lcars-voice');
  voice.dataset.voiceState = 'idle';
  voice.appendChild(el('span', 'lcars-voice-text', 'STANDING BY'));
  status.appendChild(voice);

  const transcript = el('span', 'lcars-transcript');
  transcript.setAttribute('data-wm-transcript', '');
  transcript.hidden = true;
  status.appendChild(transcript);
  console_.appendChild(status);

  return console_;
}

/**
 * Fills the layer row from the controls the map has actually rendered.
 *
 * Idempotent and cheap: it compares the keys it would render against the ones
 * already there and returns untouched when they agree, so it is safe to call
 * from a poll.
 *
 * Reading the real `data-layer` values rather than keeping a list here is the
 * same rule as a rail button naming a real panel — a button for a layer the
 * map does not have would silently do nothing, and on a wall panel that is
 * indistinguishable from a broken display.
 *
 * Returns true once the row has been populated.
 */
export function syncNavLayers(doc: Document = document): boolean {
  const row = doc.querySelector<HTMLElement>(`.${LAYER_ROW_CLASS}`);
  if (!row) return false;

  const keys = layerKeys(doc).slice(0, MAX_LAYER_BUTTONS);
  if (!keys.length) return false;

  const rendered = [...row.querySelectorAll<HTMLElement>('[data-wm-action]')].map((btn) =>
    (btn.dataset.wmAction ?? '').replace('map.layer:', ''),
  );
  if (rendered.length === keys.length && rendered.every((k, i) => k === keys[i])) return true;

  row.textContent = '';
  const tones = ['periwinkle', 'ice', 'lilac', 'cream', 'tan'];
  keys.forEach((key, index) => {
    const btn = button(
      `layer-${key}`,
      key.replace(/[-_]/g, ' '),
      tones[index % tones.length] ?? 'tan',
      `map.layer:${key}`,
      // Dispatched on the global action bus rather than through a captured
      // chrome context: this runs long after the mount that built the row,
      // and holding the context alive just to reach `dispatch` would keep a
      // whole torn-down chrome in memory.
      { dispatch: (action: string) => dispatchAction(action) } as ChromeContext,
    );
    btn.classList.add('lcars-nav-btn-compact');
    row.appendChild(btn);
  });
  row.hidden = false;
  return true;
}

/** Lights the button for the active page. Called on every page change. */
export function markActivePage(id: string, doc: Document = document): void {
  for (const btn of doc.querySelectorAll<HTMLElement>(`[${PAGE_BUTTON_ATTRIBUTE}]`)) {
    const active = btn.getAttribute(PAGE_BUTTON_ATTRIBUTE) === id;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

/**
 * Dims the pages the dashboard is not rendering any panels for.
 *
 * Dimmed rather than removed: a console whose buttons move as feeds come and
 * go is worse than one with a button that reads as unavailable, and the row
 * keeping its geometry is what lets muscle memory work on a wall panel.
 */
export function markAvailablePages(ids: string[], doc: Document = document): void {
  const available = new Set(ids);
  for (const btn of doc.querySelectorAll<HTMLElement>(`[${PAGE_BUTTON_ATTRIBUTE}]`)) {
    const id = btn.getAttribute(PAGE_BUTTON_ATTRIBUTE) ?? '';
    const ok = available.size === 0 || available.has(id);
    btn.classList.toggle('is-unavailable', !ok);
    if (btn instanceof HTMLButtonElement) btn.disabled = !ok;
  }
}
