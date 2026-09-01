import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TOKEN_CONTRACT } from '@/themes/tokens';

/**
 * Guards the extraction in `src/themes/tokens.ts` against upstream drift.
 *
 * `src/themes/tokens.ts` is a transcription of upstream's `:root` blocks, and a
 * transcription rots. The `default` theme is deliberately a passthrough, so a
 * stale value here cannot cause a rendering bug — but it CAN mislead the next
 * theme author into designing against a colour upstream no longer ships. When
 * this test fails, re-run the extraction procedure in docs/P0-PORT.md; do not
 * edit the expectation to match.
 */

// Resolved from cwd, not `import.meta.url`: under the happy-dom environment
// `import.meta.url` is an http: URL and cannot be converted to a path.
const MAIN_CSS = resolve(process.cwd(), 'src/styles/main.css');

/** Custom properties declared in top-level `:root { ... }` blocks. */
function upstreamRootTokens(): Map<string, string> {
  const css = readFileSync(MAIN_CSS, 'utf8');
  const tokens = new Map<string, string>();

  // Anchored to the line start so `[data-theme="light"]` and other qualified
  // selectors — which legitimately hold different values — are not collected.
  const blocks = css.matchAll(/^:root \{\n([\s\S]*?)^\}/gm);
  for (const block of blocks) {
    const body = block[1] ?? '';
    for (const decl of body.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)) {
      const name = decl[1];
      const value = decl[2];
      if (name && value) tokens.set(name, value.trim());
    }
  }
  return tokens;
}

describe('default token contract', () => {
  it('matches the values upstream actually declares', () => {
    const upstream = upstreamRootTokens();
    // Sanity-check the parser before trusting a comparison against it: a regex
    // that silently matched nothing would make every assertion below vacuous.
    expect(upstream.size).toBeGreaterThan(50);

    const drifted: string[] = [];
    for (const [name, recorded] of Object.entries(DEFAULT_TOKEN_CONTRACT)) {
      const actual = upstream.get(name);
      if (actual === undefined) {
        drifted.push(`--${name}: recorded "${recorded}", no longer declared upstream`);
      } else if (actual !== recorded) {
        drifted.push(`--${name}: recorded "${recorded}", upstream now "${actual}"`);
      }
    }

    expect(drifted).toEqual([]);
  });
});
