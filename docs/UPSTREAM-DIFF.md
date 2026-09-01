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
| `louh/lcars` | GPL-3.0 | `src/themes/lcars/chrome.ts` | Frame composition (rail / elbow / content well), decorative four-digit control codes |
| `louh/lcars` | GPL-3.0 | `public/sounds/*.ogg` | Six UI sounds. Licence at `public/sounds/LCARS-SOUNDS-LICENSE.txt` |
| Antonio | OFL-1.1 | `public/fonts/antonio-*.woff2` | Self-hosted display face. Licence at `public/fonts/Antonio-OFL.txt` |

GPL-3.0 is compatible with this fork's AGPL-3.0 via AGPLv3 §13; the combined
work is AGPL. Attribution is carried in a header comment on each file above and
recorded here. Full review in `docs/LCARS-ASSETS.md`.

The sound files' origin is unstated in the source repo and they are likely
show-sourced. Acceptable for a personal LAN kiosk; **they must be replaced
before any public distribution.** The slot indirection in
`src/themes/sounds.ts` means that replacement is a change of file, not of any
call site.

---

## Deliberate couplings to upstream internals

Neither of these modifies an upstream file, but both read upstream's internals
and so must be re-checked after a merge.

### The header degradation ladder

`src/themes/lcars/lcars.css` re-runs upstream's own header ladder at shifted
breakpoints.

Upstream drops least-essential header items as the **viewport** narrows
(`main.css:1094-1115`), each one "still reachable elsewhere — footer links, the
mobile hamburger menu, or the map's own controls". The LCARS frame narrows the
**container**, not the viewport, so that ladder never fires and upstream's
right-hand controls (Sign In, Create account) ran off the edge of the content
well. `.main-content` has `overflow-x: hidden`, so the failure was silent
clipping rather than a scrollbar.

Our rules fire at the viewport width where the content well crosses each of
upstream's thresholds — upstream's number plus the 148px frame inset (rail +
frame padding + body gap, recorded as `--wm-frame-inset`).

If upstream retunes its ladder, these must be re-derived. The e2e assertion
"upstream header fits the content well instead of being clipped" measures
`.header` `scrollWidth` against `clientWidth` and fails if it regresses.

### The 12-column panel grid

`src/themes/lcars/lcars.css` restyles `.panels-grid` into a twelve-column
module and assigns each `.panel` a whole-column span.

The span ladder exists for a measured reason. `.panels-grid` does not get the
whole content well: `.main-content` is itself a grid, and in the map-right
layout the pinned map takes ~680px of the 1137px well, leaving the panel grid
~449px. Twelve columns there are ~32px each, so a naive "plain panel = 3
columns" lands at 106px and panel titles ellipsis to a single letter. The
spans therefore adapt to the grid's own width through a container query, and
an e2e assertion fails if any panel drops below 270px.

This reads three upstream classes — `.panel`, `.span-2`, `.panel-wide` — and
upstream's own `--dashboard-panel-row-*` tokens. It deliberately does NOT
touch `--map-col-width`: that split is user-resizable and persisted, and
snapping it to the module would fight a feature for a notional gain.

### Killing transitions inside the frame

`src/themes/lcars/lcars.css` sets `transition: none !important` on everything
inside `.lcars-frame`.

"LCARS cuts, it does not fade" is a design rule, but enforcing it needs a rule
that reaches upstream's markup, because upstream ships transitions and skeleton
shimmer of its own and the dashboard now renders *inside* our frame. Inheriting
them is the most theme-breaking thing that can happen without anyone editing a
file. Scoped to the frame and to the LCARS theme, so `default` is untouched.

### `data-theme` is upstream's, not ours

Our attribute is `data-wm-theme`. `data-theme` belongs to upstream: it is set
before first paint by the prepaint script in `index.html` and read across
`main.css` for light/dark. An early draft of the engine wrote the theme id into
`data-theme`, which would have silently clobbered upstream's colour scheme on
every theme switch.

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
