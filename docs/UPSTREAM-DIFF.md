# Upstream diff register

Every upstream file this fork touches, and why. Required by SCOPE.md §4.5.

Upstream is `koala73/worldmonitor`, 6,000+ commits and actively maintained.
Merge cost is the primary non-functional constraint on this project, so this
register exists to keep the surface small enough to audit before every merge.

**Baseline:** `cd91e63` (2026-08-31).

---

## Files modified

| File | Lines | Change | Phase |
|---|---|---|---|
| `src/main.ts` | +2, -0 | `import { bootThemes }` and one call before `new App('app')` | P0 |
| `index.html` | +1, -1 | `data-wm-shell` attribute added to `<div id="app">` | P0 |

**Total: 2 files, 3 insertions, 1 deletion.** No file is reformatted,
reorganized, or otherwise cleaned up (§4.3) — a whitespace-only change to a
file upstream also touches converts a clean merge into a manual one.

### `src/main.ts`

```diff
 import { App } from './App';
+import { bootThemes } from './themes';

   markLcpDebug('wm:boot:app-construct');
+  bootThemes();
   const app = new App('app');
```

Placed immediately before app construction so the theme attribute and token
stylesheet are in the document before the dashboard renders. `bootThemes()` is
idempotent and never throws — on an unattended kiosk, an exception here would
cost the whole dashboard for the sake of its colour scheme.

Import added on its own line after the existing `App` import rather than merged
into a sorted block, so a merge conflict here is a one-line resolution.

### `index.html`

```diff
-    <div id="app">
+    <div id="app" data-wm-shell>
```

Marks the element theme chrome mounts into. A bare attribute with no value:
nothing upstream selects on it, and it cannot change layout or specificity.

---

## Seams considered and NOT taken

### `data-wm-panel` on panel hosts

SCOPE.md §4.2 budgeted a third seam to stamp `data-wm-panel` onto each panel.
**Not taken.** Upstream already marks every panel with `data-panel="<key>"` and
reads it back in fourteen places (`src/app/panel-layout.ts`,
`src/components/MobilePanelNav.ts`, `src/components/PanelTabBar.ts`,
`src/services/tv-mode.ts`, `src/app/search-selection-dispatcher.ts`, ...).

Fork rule §4.4 — prefer a DOM hook over an upstream edit — applies directly, so
the theme layer consumes the existing attribute. The constant lives at
`src/themes/engine.ts:PANEL_ATTRIBUTE`, so if upstream ever renames it the fix
is one line in our tree rather than a search across it.

Its value doubles as the panel key, which is what the P3 context snapshot needs
in order to name a panel to the LLM.

### A post-render hook for chrome mounting

`bootThemes()` runs before `new App('app')`, so chrome mounted at boot is wiped
by upstream's first render — and again whenever the dashboard rebuilds panel
markup by assigning `innerHTML`. The obvious fix is a fourth seam calling back
into the theme layer after render.

**Not taken.** The engine watches the shell with a `MutationObserver` and
re-mounts instead (`ThemeEngine.watchChrome`). `ThemeChrome.mount` is required
to be idempotent, so the watch cannot feed back on itself. This costs no
upstream lines and does not depend on upstream's render timing, which is not a
contract anyone has promised us.

### Un-ignoring `CLAUDE.md`

Upstream's `.gitignore:52` ignores a root `CLAUDE.md`. **Not taken** — editing
`.gitignore` would spend an upstream seam on a documentation file. The working
brief is tracked at `docs/WORKING-BRIEF.md` instead; a root `CLAUDE.md` can be
kept locally as an ignored copy.

---

## Third-party code lifted into this fork

| Source | Licence | Where | What |
|---|---|---|---|
| `louh/lcars` | GPL-3.0 | `src/themes/lcars/tokens.ts` | Drexler palette custom properties |
| `louh/lcars` | GPL-3.0 | `src/themes/lcars/lcars.css` | Pill-cap radius, cap-height factor, `user-select` technique |

GPL-3.0 is compatible with this fork's AGPL-3.0 via AGPLv3 §13; the combined
work is AGPL. Attribution is carried in a header comment on each file above and
recorded here. Full review in `docs/LCARS-ASSETS.md`.

Sound assets (`public/sounds/*.ogg`) are **not yet vendored** — the slots are
declared in `src/themes/lcars/index.ts` and the files land in P1. Their origin
is unstated and they are likely show-sourced: acceptable for a personal LAN
kiosk, and to be replaced before any public distribution.

---

## Merge procedure

```bash
git remote add upstream https://github.com/koala73/worldmonitor.git
git fetch upstream
git merge upstream/main
```

Conflicts should only ever appear in the two files listed above. If a merge
touches anything else, something has drifted from this register — stop and
reconcile before resolving.

After every merge, re-run the checks that detect silent divergence:

```bash
npx vitest run --config vitest.dom.config.mts tests/dom/theme-token-contract.test.mts
npx playwright test e2e/theme-engine-p0.spec.ts
```

The first catches upstream retuning a token our extraction records; the second
catches upstream changing the shell or panel markup the engine depends on.
