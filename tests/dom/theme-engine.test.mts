import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeEngine, PANEL_ATTRIBUTE, SHELL_ATTRIBUTE, THEME_ATTRIBUTE } from '@/themes/engine';
import { THEME_CHANGE_EVENT, type ThemeChangeDetail, type ThemeDefinition } from '@/themes/types';

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

const passthrough: ThemeDefinition = { id: 'default', label: 'Default' };

function tokenTheme(id: string, tokens: Record<string, string>): ThemeDefinition {
  return { id, label: id, tokens };
}

describe('ThemeEngine', () => {
  beforeEach(() => {
    shellFixture();
    localStorage.clear();
  });

  it('leaves the cascade untouched for a theme that declares no tokens', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.apply('default');

    // The pixel-for-pixel P0 criterion rests on this: the identity theme must
    // emit no declarations at all, not a re-transcription of upstream's values.
    expect(document.getElementById('wm-theme-tokens')?.textContent).toBe('');
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('default');
  });

  it('scopes token overrides to the active theme attribute', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(tokenTheme('lcars', { bg: '#090909', 'lcars-1': '#ec943a' }));
    engine.apply('lcars');

    const css = document.getElementById('wm-theme-tokens')?.textContent ?? '';
    expect(css).toContain(`:root[${THEME_ATTRIBUTE}="lcars"]`);
    expect(css).toContain('--bg: #090909;');
    expect(css).toContain('--lcars-1: #ec943a;');
  });

  it('falls back to the default theme for an unknown id instead of throwing', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);

    // A stale persisted value or a mis-heard voice command must degrade to a
    // readable dashboard, never to a blank kiosk nobody is present to reboot.
    expect(engine.apply('does-not-exist')).toBe('default');
    expect(engine.current()).toBe('default');
  });

  it('persists the applied theme, and honours persist:false for URL pins', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(tokenTheme('lcars', { bg: '#090909' }));

    engine.apply('lcars');
    expect(localStorage.getItem('wm-theme')).toBe('lcars');

    engine.apply('default', { persist: false });
    expect(localStorage.getItem('wm-theme')).toBe('lcars');
  });

  it('survives localStorage throwing on write', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(tokenTheme('lcars', { bg: '#090909' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => engine.apply('lcars')).not.toThrow();
    expect(engine.current()).toBe('lcars');
  });

  it('emits a change event carrying both ends of the transition', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(tokenTheme('lcars', { bg: '#090909' }));

    const seen: ThemeChangeDetail[] = [];
    document.addEventListener(THEME_CHANGE_EVENT, (event) => {
      seen.push((event as CustomEvent<ThemeChangeDetail>).detail);
    });

    engine.apply('lcars');
    engine.apply('default');

    expect(seen).toEqual([
      { previous: null, current: 'lcars' },
      { previous: 'lcars', current: 'default' },
    ]);
  });

  it('does not re-apply or re-emit when the theme is already active', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    const listener = vi.fn();
    document.addEventListener(THEME_CHANGE_EVENT, listener);

    engine.apply('default');
    engine.apply('default');

    expect(listener).toHaveBeenCalledOnce();
  });

  it('keeps the dashboard alive when a theme cannot mount its chrome', () => {
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register({
      id: 'broken',
      label: 'broken',
      tokens: { bg: '#111' },
      chrome: {
        mount() {
          throw new Error('chrome exploded');
        },
        unmount() {},
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => engine.apply('broken')).not.toThrow();
    // Tokens still landed: only the structural layer was lost.
    expect(document.getElementById('wm-theme-tokens')?.textContent).toContain('--bg: #111;');
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
    // actual theme's mount/unmount pair is a true inverse.
    const { lcarsTheme, lcarsBrightTheme } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(lcarsTheme);
    engine.register(lcarsBrightTheme);
    engine.apply('default');

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    const before = shell.outerHTML;

    for (let i = 0; i < 20; i += 1) {
      engine.apply('lcars');
      engine.apply('lcars-bright');
      engine.apply('default');
    }

    expect(shell.outerHTML).toBe(before);
    // And exactly one engine-owned style element, not twenty.
    expect(document.querySelectorAll('#wm-theme-tokens')).toHaveLength(1);
  });

  it('restores chrome after upstream rebuilds the shell', async () => {
    // Regression: `bootThemes()` runs before `new App('app')`, so chrome
    // mounted at boot was wiped by upstream's first render and the theme came
    // up bare after every reload. The engine watches the shell instead of
    // spending a fourth upstream seam on a post-render hook.
    const { lcarsTheme } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(lcarsTheme);
    engine.apply('lcars');

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    expect(document.getElementById('wm-lcars-chrome')).not.toBeNull();

    // Exactly what upstream does when it renders the dashboard over the
    // pre-render skeleton.
    shell.innerHTML = '<div class="panels-grid"></div>';
    expect(document.getElementById('wm-lcars-chrome')).toBeNull();

    // MutationObserver callbacks are microtasks; yield once so it can run.
    await Promise.resolve();
    expect(document.getElementById('wm-lcars-chrome')).not.toBeNull();
  });

  it('stops restoring chrome once its theme is no longer active', async () => {
    const { lcarsTheme } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(lcarsTheme);
    engine.apply('lcars');
    engine.apply('default');

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    shell.innerHTML = '<div class="panels-grid"></div>';
    await Promise.resolve();

    // A stale observer re-mounting LCARS chrome under the default theme is
    // exactly the leak the twenty-cycle criterion exists to catch.
    expect(document.getElementById('wm-lcars-chrome')).toBeNull();
  });

  it('mounts chrome once even if a re-render races the theme change', async () => {
    const { lcarsTheme } = await import('@/themes/lcars');
    const engine = new ThemeEngine();
    engine.register(passthrough);
    engine.register(lcarsTheme);

    const shell = document.querySelector<HTMLElement>(`[${SHELL_ATTRIBUTE}]`)!;
    engine.apply('lcars');
    lcarsTheme.chrome?.mount(shell);

    expect(document.querySelectorAll('#wm-lcars-chrome')).toHaveLength(1);
  });
});
