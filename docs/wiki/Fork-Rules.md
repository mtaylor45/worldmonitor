# Fork rules

Read this before editing anything. The full version is
[`docs/WORKING-BRIEF.md`](https://github.com/mtaylor45/worldmonitor/blob/main/docs/WORKING-BRIEF.md);
this page is the part you cannot skip.

---

## The one rule that matters

**Merge cost is the primary non-functional constraint.** Upstream is 6,000+
commits and actively maintained. Every upstream line we touch is a line that can
conflict, forever.

Current cost: **2 files, 3 insertions, 1 deletion** of code, plus a rewritten
`README.md`.

| File | Change | Phase |
|---|---|---|
| `src/main.ts` | `import { bootApp }` + one call before `new App('app')` | P0 |
| `index.html` | `data-wm-shell` on `<div id="app">` | P0 |
| `README.md` | Rewritten to describe this fork | — |

`README.md` is deliberately the one file we do not try to keep mergeable, and it
is the cheapest kind of conflict: `git checkout --ours README.md`.

---

## Before you edit an upstream file

Ask whether **a DOM attribute hook plus code in our own directory** would do
instead. It usually will. That question has already saved two seams:

- Upstream already marks panels with `data-panel`, so the rail and the LLM
  snapshot read that rather than needing a registry upstream would have to
  maintain.
- Chrome re-mounts via a `MutationObserver` rather than a post-render callback
  upstream would have to call.

**Never reformat, reorganise or tidy an upstream file.** A whitespace-only
change to a file upstream also touches converts a clean merge into a manual one.

Log every upstream file touched in
[`docs/UPSTREAM-DIFF.md`](https://github.com/mtaylor45/worldmonitor/blob/main/docs/UPSTREAM-DIFF.md).

---

## Attributes: whose is whose

| Attribute | Owner | Never do this |
|---|---|---|
| `data-theme` | **Upstream.** Set before first paint, read across `main.css` for light/dark | Never write it. Writing the theme id here silently clobbers upstream's colour scheme |
| `data-wm-theme` | Ours | — |
| `data-wm-alert` | Ours | Clearing it **removes** the attribute; it never sets it to `false` |
| `data-wm-shell` | Ours, on upstream's `<div id="app">` | — |
| `data-panel` | Upstream's, read-only to us | — |

---

## Rules that are easy to break by accident

**`default` declares nothing.** It is an identity theme. Do not "complete" it by
copying upstream's `:root` values in — that passes the screenshot diff on the
day it is written and silently diverges the first time upstream retunes a
colour.

**Do not repaint the signal ramp.** `--threat-*`, `--semantic-*`, `--defcon-*`
and `--status-*` carry meaning. Recolouring `--threat-low` into a warm LCARS
orange makes a calm reading look like an alarm — a correctness bug in a
situational-awareness display, not a taste difference.

**Salmon `#cc6666` and critical red `#ff3300` are status only.** Their sole use
in the whole theme is the `[data-wm-alert="true"]` block. There is a test that
they appear nowhere in the chrome at rest, and another that they *do* appear
when an alert fires.

**Chrome must be losslessly removable.** A chrome slot returns its own teardown,
and that teardown is its exact inverse — including dropping a `class` attribute
it emptied, because an empty attribute is still an attribute. Twenty theme
cycles must leave the DOM identical.

**Teardown reads the DOM, it does not replay it.** Upstream rebuilds the
dashboard by assigning `innerHTML`, so the nodes present when chrome mounted are
usually not the nodes present when it unmounts.

**A rail button must name a panel upstream actually renders.** `panel.focus`
targets are `data-panel` keys verified against a running dashboard. A button
pointing at a key that does not exist silently does nothing, which on a wall
panel is indistinguishable from a broken display.

---

## Conventions

- TypeScript strict. No `any` in our directories.
- Comments explain *why*. The code already says what.
- Vanilla TS, plain DOM factories for chrome. **Upstream's stack is not
  negotiable** — do not introduce a framework for this.
- Action strings are `namespace.verb`, optionally `namespace.verb:argument`.
  One registry in `src/themes/actions.ts`; the P3 tool schema is *generated*
  from it, never hand-maintained beside it.
- Sound callers name a **slot** (`wake`, `accept`, `change`, `deny`, `alert`),
  never a file. The active theme decides what each sounds like.
