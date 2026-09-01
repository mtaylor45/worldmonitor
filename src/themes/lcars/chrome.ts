import { PANEL_ATTRIBUTE } from '../engine';
import type { ThemeChrome } from '../types';

/**
 * LCARS structural chrome — the left rail and the elbow that frames it.
 *
 * P0 scope: prove that a theme can add and cleanly remove structure, and that
 * doing so repeatedly is lossless. The rail's buttons are inert placeholders
 * here; P1 binds them to real panel-focus actions and P3 routes them through
 * the shared `wm:action` registry so voice and rail cannot drift apart.
 *
 * Everything this mounts lives inside ONE container element, and `unmount`
 * removes exactly that element plus the marker class it set. That single-root
 * rule is what makes twenty mount/unmount cycles provably leave no residue.
 */

const ROOT_ID = 'wm-lcars-chrome';
const SHELL_CLASS = 'wm-lcars-shelled';

/** Rail entries. `action` strings follow the `namespace.verb` convention. */
const RAIL_ITEMS: readonly { label: string; action: string }[] = [
  { label: 'MONITOR', action: 'panel.focus' },
  { label: 'GLOBE', action: 'map.focus' },
  { label: 'FEEDS', action: 'panel.feeds' },
  { label: 'LISTEN', action: 'voice.ptt' },
  { label: 'THEME', action: 'theme.cycle' },
];

function buildRail(doc: Document): HTMLElement {
  const root = doc.createElement('div');
  root.id = ROOT_ID;
  root.className = 'lcars-chrome';
  // Chrome is decoration plus not-yet-wired controls; until P1 gives the
  // buttons real behaviour, exposing them to a screen reader would be
  // announcing affordances that do nothing.
  root.setAttribute('aria-hidden', 'true');

  const rail = doc.createElement('nav');
  rail.className = 'lcars-rail';

  const elbow = doc.createElement('div');
  elbow.className = 'lcars-elbow';
  rail.appendChild(elbow);

  for (const item of RAIL_ITEMS) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'lcars-rail-button';
    button.dataset.wmAction = item.action;
    button.disabled = true;
    // The label sits in its own span so P1 can apply the Okudagram technique
    // from louh/lcars: the span carries the BACKGROUND colour over a coloured
    // bar, punching the text through it rather than painting glyphs on top.
    const label = doc.createElement('span');
    label.className = 'lcars-rail-label';
    label.textContent = item.label;
    button.appendChild(label);
    rail.appendChild(button);
  }

  root.appendChild(rail);
  return root;
}

export const lcarsChrome: ThemeChrome = {
  mount(shell: HTMLElement): void {
    const doc = shell.ownerDocument;
    // Idempotent: a double mount (a re-render racing a theme change) must not
    // produce two rails.
    if (doc.getElementById(ROOT_ID)) return;
    shell.classList.add(SHELL_CLASS);
    shell.insertBefore(buildRail(doc), shell.firstChild);
    markPanels(shell);
  },

  unmount(shell: HTMLElement): void {
    shell.ownerDocument.getElementById(ROOT_ID)?.remove();
    shell.classList.remove(SHELL_CLASS);
    shell.style.removeProperty('--lcars-panel-count');
    // An empty `class`/`style` attribute is still an attribute, and the cycle
    // test compares attributes. Drop anything we emptied.
    if (shell.getAttribute('class') === '') shell.removeAttribute('class');
    if (shell.getAttribute('style') === '') shell.removeAttribute('style');
  },
};

/**
 * Counts the panel hosts the upstream seam marked.
 *
 * Read-only on purpose. The theme does not add `data-wm-panel` itself — that
 * attribute is written at the upstream seam so that BOTH the theme layer and
 * the P3 context snapshot read the same marker, rather than each maintaining
 * its own idea of what a panel is.
 */
function markPanels(shell: HTMLElement): void {
  const panels = shell.querySelectorAll(`[${PANEL_ATTRIBUTE}]`);
  shell.style.setProperty('--lcars-panel-count', String(panels.length));
}
