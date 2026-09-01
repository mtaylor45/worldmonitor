import { CONTENT_ATTRIBUTE } from '../engine';
import type { ChromeContext, ThemeChrome } from '../types';

/**
 * LCARS frame construction.
 *
 * The frame is not decoration — it's the navigation. The left rail carries the
 * panel switcher, the header carries system state, the footer carries the
 * voice indicator. Everything the dashboard renders goes inside the content
 * well bounded by the elbow.
 *
 * Structure:
 *
 *   ┌──────┐╭──────────────────────────────────╮
 *   │ rail ││  header bar          WORLD MONITOR│
 *   │  ╭───╯╰──────────────────────────────────╯
 *   │  │
 *   │  │     [data-wm-content]
 *   │  │
 *   ╰──┴───────────────────────────────────────╯
 */

interface RailItem {
  id: string;
  label: string;
  /** Token name from the theme palette. */
  tone: 'tan' | 'lilac' | 'periwinkle' | 'ice' | 'cream';
  action: string;
}

/**
 * Rail bindings. Every `panel.focus` target is a real upstream `data-panel`
 * key, verified against a running dashboard — a rail button pointing at a
 * panel that does not exist would silently do nothing, which on a wall panel
 * is indistinguishable from a broken display.
 */
const RAIL: RailItem[] = [
  { id: 'brief', label: 'BRIEF', tone: 'tan', action: 'panel.focus:latest-brief' },
  { id: 'globe', label: 'GLOBE', tone: 'periwinkle', action: 'map.focus' },
  { id: 'feeds', label: 'FEEDS', tone: 'tan', action: 'panel.focus:live-news' },
  { id: 'cii', label: 'STRESS', tone: 'lilac', action: 'panel.focus:cii' },
  { id: 'markets', label: 'MARKETS', tone: 'periwinkle', action: 'panel.focus:markets' },
  { id: 'energy', label: 'ENERGY', tone: 'ice', action: 'panel.focus:energy' },
  { id: 'listen', label: 'LISTEN', tone: 'cream', action: 'voice.ptt' },
  { id: 'theme', label: 'DISPLAY', tone: 'tan', action: 'theme.cycle' },
];

const FRAME_CLASS = 'lcars-frame';

/**
 * LCARS screens carry four-digit codes beside every control. They're
 * decorative in canon, so we derive them from the id — stable across reloads,
 * which matters more than authenticity here. A code that reshuffles on every
 * repaint reads as noise.
 */
function code(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return String((h % 9000) + 1000);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

function buildRail(ctx: ChromeContext): HTMLElement {
  const rail = el('nav', 'lcars-rail');
  rail.setAttribute('aria-label', 'Panels');

  // Stub — the short block that starts the column under the header elbow.
  rail.appendChild(el('div', 'lcars-stub'));

  RAIL.forEach((item, index) => {
    const btn = el('button', `lcars-rail-btn lcars-tone-${item.tone}`);
    btn.type = 'button';
    btn.dataset.wmAction = item.action;
    // Code bottom-LEFT, label bottom-RIGHT, both on the block floor. The
    // design system is specific about this and it is what makes a rail read
    // as instrumentation rather than a list of buttons.
    btn.appendChild(el('span', 'lcars-rail-code', code(item.id)));
    btn.appendChild(el('span', 'lcars-rail-label', item.label));
    btn.addEventListener('click', () => ctx.dispatch(item.action));
    rail.appendChild(btn);

    // Interrupt tab: a short contrasting block breaking a continuous rail,
    // placed where the eye needs an anchor on a long vertical run. Eight
    // buttons is long enough to warrant exactly one, at the midpoint.
    if (index === Math.floor(RAIL.length / 2) - 1) {
      const tab = el('div', 'lcars-interrupt', code(`${item.id}-tab`).slice(0, 2));
      rail.appendChild(tab);
    }
  });

  // Foot — fills the remainder of the column and carries the lower elbow
  // sweep, so the rail terminates into the frame rather than just stopping.
  rail.appendChild(el('div', 'lcars-foot'));
  return rail;
}

function buildHeader(): HTMLElement {
  const header = el('header', 'lcars-header');

  // The elbow is one block plus one carve. The carve is a field-coloured
  // pseudo-element in CSS, so nothing here needs a clip-path or an SVG.
  header.appendChild(el('div', 'lcars-elbow'));

  // A labelled bar, not a bar with text on it. The label BLOCK carries the
  // field colour and interrupts the coloured segment, punching a hole through
  // it — the detail the design system notes most reproductions miss.
  const bar = el('div', 'lcars-header-bar');
  bar.appendChild(el('span', 'lcars-header-status', 'ONLINE'));
  bar.appendChild(el('div', 'lcars-header-seg'));
  const title = el('h1', 'lcars-header-title', 'WORLD MONITOR');
  bar.appendChild(title);
  header.appendChild(bar);

  header.appendChild(el('div', 'lcars-header-cap'));
  return header;
}

function buildFooter(): HTMLElement {
  const footer = el('footer', 'lcars-footer');
  // Mirrors the header: a rail-width block carrying the lower elbow, then the
  // sweep. The voice state is a STATUS TAG — square corners, deliberately the
  // one rectangular element, which is exactly why the eye finds it.
  footer.appendChild(el('div', 'lcars-footer-foot'));
  const bar = el('div', 'lcars-footer-bar');
  const voice = el('div', 'lcars-voice');
  voice.dataset.voiceState = 'idle';
  voice.appendChild(el('span', 'lcars-voice-text', 'STANDING BY'));
  bar.appendChild(voice);
  footer.appendChild(bar);
  return footer;
}

export const lcarsChrome: ThemeChrome = {
  shell(host, ctx) {
    // Idempotent: a double mount (a re-render racing a theme change) must not
    // produce two frames.
    const mounted = host.querySelector(`:scope > .${FRAME_CLASS}`);
    if (mounted instanceof HTMLElement) return () => unwrap(host, mounted);

    // Preserve whatever the app already rendered, then re-parent it into the
    // content well. Teardown puts it back exactly as found.
    const original = [...host.childNodes];

    const frame = el('div', FRAME_CLASS);
    const header = buildHeader();
    const body = el('div', 'lcars-body');
    const rail = buildRail(ctx);
    const content = el('main', 'lcars-content');
    content.setAttribute(CONTENT_ATTRIBUTE, '');

    for (const node of original) content.appendChild(node);

    body.appendChild(rail);
    body.appendChild(content);
    frame.appendChild(header);
    frame.appendChild(body);
    frame.appendChild(buildFooter());
    host.appendChild(frame);

    return () => unwrap(host, frame);
  },

  panel(host) {
    host.classList.add('lcars-panel');
    return () => {
      host.classList.remove('lcars-panel');
      // An empty `class` attribute is still an attribute, and the cycle test
      // compares attributes.
      if (host.getAttribute('class') === '') host.removeAttribute('class');
    };
  },
};

/**
 * Reverses a shell mount: whatever is in the content well goes back to the
 * host, in order, and the frame is removed.
 *
 * Reads the content well at teardown time rather than closing over the node
 * list captured at mount. Upstream re-renders the dashboard by assigning
 * innerHTML, so the nodes present at mount are frequently not the nodes
 * present now — restoring the captured list would re-attach detached markup
 * and drop everything the dashboard has rendered since.
 */
function unwrap(host: HTMLElement, frame: HTMLElement): void {
  const content = frame.querySelector<HTMLElement>(`[${CONTENT_ATTRIBUTE}]`);
  if (content) {
    // insertBefore(frame) rather than appendChild: the dashboard's markup goes
    // back where the frame stood, not after any sibling added since.
    while (content.firstChild) host.insertBefore(content.firstChild, frame);
  }
  frame.remove();
}
