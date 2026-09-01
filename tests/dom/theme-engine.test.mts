import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeEngine, CONTENT_ATTRIBUTE, PANEL_ATTRIBUTE, SHELL_ATTRIBUTE, THEME_ATTRIBUTE } from '@/themes/engine';
import { ACTION_EVENT, THEME_CHANGE_EVENT, type ActionDetail, type ThemeChangeDetail, type Theme } from '@/themes/types';

function shellFixture(): HTMLElement {
  document.head.innerHTML = '';
  document.body.innerHTML = `
    <div id="app" ${SHELL_ATTRIBUTE}>
      <div class="panels-grid">
        <div class="panel" ${PANEL_ATTRIBUTE}="conflicts"></div>
        <div class="panel" ${PANEL_ATTRIBUTE}="markets"></div>
      </div>
    </div>`;
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  return document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
}

const EMPTY = { color: {}, font: {}, space: {}, radius: {} };
const passthrough: Theme = { id: 'default', name: 'World Monitor', tokens: EMPTY };

function tokenTheme(id: string, tokens: Partial<Theme['tokens']>): Theme {
  return { id, name: id, tokens: { ...EMPTY, ...tokens } };
}

describe('ThemeEngine', () => {
  beforeEach(() => {
    shellFixture();
    localStorage.clear();
  });

  it('leaves the cascade untouched for a theme that declares no tokens', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    await engine.apply('default');

    // The pixel-for-pixel P0 criterion rests on this: the identity theme must
    // emit no declarations at all, not a re-transcription of upstream's values.
    expect(document.getElementById('wm-theme-tokens')?.textContent).toBe('');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('default');
  });

  it('namespaces the semantic groups and emits upstream tokens verbatim', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(
      tokenTheme('lcars', {
        color: { tan: '#ec943a' },
        space: { gutter: '5px' },
        extra: { 'rail-open': '1' },
        upstream: { bg: 'var(--wm-color-tan)' },
      }),
    );
    await engine.apply('lcars');

    const css = document.getElementById('wm-theme-tokens')?.textContent ?? '';
    expect(css).toContain(`:root[${THEME_ATTRIBUTE}="lcars"]`);
    expect(css).toContain('--wm-color-tan: #ec943a;');
    expect(css).toContain('--wm-space-gutter: 5px;');
    expect(css).toContain('--wm-rail-open: 1;');
    // The bridge onto upstream's own property, unprefixed. This is what makes
    // unmodified upstream panels inherit the theme.
    expect(css).toContain('--bg: var(--wm-color-tan);');
    expect(css).not.toContain('--wm-bg:');
  });

  it('falls back to the default theme for an unknown id instead of throwing', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);

    // A stale persisted value or a mis-heard voice command must degrade to a
    // readable dashboard, never to a blank kiosk nobody is present to reboot.
    expect(await engine.apply('does-not-exist')).toBe('default');
    expect(engine.current?.id).toBe('default');
  });

  it('persists the applied theme, and honours persist:false for URL pins', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough, tokenTheme('lcars', { color: { tan: '#ec943a' } }));

    await engine.apply('lcars');
    expect(localStorage.getItem('wm-theme')).toBe('lcars');

    await engine.apply('default', { persist: false });
    expect(localStorage.getItem('wm-theme')).toBe('lcars');
  });

  it('survives localStorage throwing on write', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough, tokenTheme('lcars', { color: { tan: '#ec943a' } }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    await expect(engine.apply('lcars')).resolves.toBe('lcars');
    expect(engine.current?.id).toBe('lcars');
  });

  it('emits a change event carrying both ends of the transition', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough, tokenTheme('lcars', { color: { tan: '#ec943a' } }));

    const seen: ThemeChangeDetail[] = [];
    document.addEventListener(THEME_CHANGE_EVENT, (event) => {
      seen.push((event as CustomEvent<ThemeChangeDetail>).detail);
    });

    await engine.apply('lcars');
    await engine.apply('default');

    expect(seen).toEqual([
      { previous: null, current: 'lcars' },
      { previous: 'lcars', current: 'default' },
    ]);
  });

  it('does not re-apply or re-emit when the theme is already active', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    const listener = vi.fn();
    document.addEventListener(THEME_CHANGE_EVENT, listener);

    await engine.apply('default');
    await engine.apply('default');

    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps the dashboard alive when a theme cannot mount its chrome', async () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register({
      id: 'broken',
      name: 'broken',
      tokens: { ...EMPTY, upstream: { bg: '#111' } },
      chrome: {
        shell() {
          throw new Error('chrome exploded');
        },
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(engine.apply('broken')).resolves.toBe('broken');
    // Tokens still landed: only the structural layer was lost.
    expect(document.getElementById('wm-theme-tokens')?.textContent).toContain('--bg: #111;');
  });
});

describe('LCARS chrome', () => {
  beforeEach(() => {
    shellFixture();
    localStorage.clear();
  });

  it('re-parents the dashboard into the content well and restores it on teardown', async () => {
    const { lcars } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough, lcars);

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    const grid = shell.querySelector('.panels-grid')!;

    await engine.apply('lcars');
    const well = shell.querySelector(`[${CONTENT_ATTRIBUTE}]`);
    expect(well).not.toBeNull();
    expect(grid.parentElement).toBe(well);

    await engine.apply('default');
    expect(shell.querySelector(`[${CONTENT_ATTRIBUTE}]`)).toBeNull();
    expect(grid.parentElement).toBe(shell);
  });

  it('restores whatever the dashboard rendered, not the nodes captured at mount', async () => {
    // Upstream rebuilds the dashboard by assigning innerHTML. A teardown that
    // replayed the node list captured at mount would re-attach detached markup
    // and drop everything rendered since.
    const { lcars } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough, lcars);
    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;

    await engine.apply('lcars');
    const well = shell.querySelector<HTMLElement>(`[${CONTENT_ATTRIBUTE}]`)!;
    well.innerHTML = '<div class="rendered-later"></div>';

    await engine.apply('default');
    expect(shell.querySelector('.rendered-later')).not.toBeNull();
    expect(shell.querySelector('.panels-grid')).toBeNull();
  });

  it('mounts the panel slot on every upstream panel host', async () => {
    const { lcars } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough, lcars);

    await engine.apply('lcars');
    expect(document.querySelectorAll('.panel.lcars-panel')).toHaveLength(2);

    await engine.apply('default');
    expect(document.querySelectorAll('.lcars-panel')).toHaveLength(0);
  });

  it('rail buttons dispatch their action on the shared bus', async () => {
    const { lcars } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough, lcars);
    await engine.apply('lcars');

    const seen: ActionDetail[] = [];
    window.addEventListener(ACTION_EVENT, (ev) => {
      seen.push((ev as CustomEvent<ActionDetail>).detail);
    });

    document.querySelector<HTMLButtonElement>('[data-wm-action="theme.cycle"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-wm-action="voice.ptt"]')?.click();

    expect(seen.map((d) => d.action)).toEqual(['theme.cycle', 'voice.ptt']);
  });

  it('restores chrome after upstream rebuilds the shell', async () => {
    // Regression: `bootThemes()` runs before `new App('app')`, so chrome
    // mounted at boot was wiped by upstream's first render and the theme came
    // up bare after every reload.
    const { lcars } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough, lcars);
    await engine.apply('lcars');

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    shell.innerHTML = '<div class="panels-grid"></div>';
    expect(shell.querySelector(`[${CONTENT_ATTRIBUTE}]`)).toBeNull();

    // MutationObserver callbacks are microtasks; yield once so it can run.
    await Promise.resolve();
    expect(shell.querySelector(`[${CONTENT_ATTRIBUTE}]`)).not.toBeNull();
    expect(shell.querySelectorAll('.lcars-frame')).toHaveLength(1);
  });

  it('stops restoring chrome once its theme is no longer active', async () => {
    const { lcars } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough, lcars);
    await engine.apply('lcars');
    await engine.apply('default');

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    shell.innerHTML = '<div class="panels-grid"></div>';
    await Promise.resolve();

    // A stale observer re-mounting LCARS chrome under the default theme is
    // exactly the leak the twenty-cycle criterion exists to catch.
    expect(shell.querySelector('.lcars-frame')).toBeNull();
  });
});

describe('theme cycling', () => {
  beforeEach(() => {
    shellFixture();
    localStorage.clear();
  });

  it('leaves the DOM structurally identical after twenty cycles', async () => {
    // The P0 acceptance criterion, asserted directly. Uses the real LCARS
    // chrome rather than a stub, because the thing under test is whether an
    // actual theme's mount/teardown pair is a true inverse.
    const { lcars, lcarsBright } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough, lcars, lcarsBright);
    await engine.apply('default');

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    const before = shell.outerHTML;

    for (let i = 0; i < 20; i += 1) {
      await engine.apply('lcars');
      await engine.apply('lcars-bright');
      await engine.apply('default');
    }

    expect(shell.outerHTML).toBe(before);
    // And exactly one engine-owned style element, not twenty.
    expect(document.querySelectorAll('#wm-theme-tokens')).toHaveLength(1);
    expect(document.querySelectorAll('link[data-wm-theme-style]')).toHaveLength(0);
  });
});
