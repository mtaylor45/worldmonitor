# LCARS World Monitor

A self-hosted, always-on situational-awareness dashboard with an LCARS interface,
built for a two-panel kiosk — a 2U display for the data, a 1U console for
navigation — and controlled by a local voice assistant.

It is a personal fork of **[koala73/worldmonitor](https://github.com/koala73/worldmonitor)**,
extending the upstream dashboard with a theme architecture, the LCARS visual
system, a two-display kiosk deployment, and fully local voice interaction.

The whole project follows from one idea:

> A situational-awareness display should be something you **glance at** — and
> something you can **talk to** — rather than another application you have to sit
> down and operate.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Fork of](https://img.shields.io/badge/fork_of-koala73%2Fworldmonitor-informational)](https://github.com/koala73/worldmonitor)
[![Upstream code surface](https://img.shields.io/badge/upstream_files_touched-2-success)](docs/UPSTREAM-DIFF.md)
[![Target](https://img.shields.io/badge/target-2U_%2B_1U_kiosk-9999ff)](#kiosk-hardware)

> **This is a personal fork.** For the upstream project — its hosted variants,
> npm/PyPI packages, MCP server, API and commercial licensing — go to
> [koala73/worldmonitor](https://github.com/koala73/worldmonitor). Nothing here
> replaces it, and everything upstream does still works.

---

## Status

| Area | Status |
|---|---|
| Upstream World Monitor integration | 🟢 Active |
| Theme engine | 🟢 Complete |
| Default theme compatibility | 🟢 Verified pixel-for-pixel |
| LCARS theme | 🟢 Implemented |
| LCARS bright palette | 🟢 Implemented |
| Self-hosted fonts | 🟢 Implemented |
| LCARS sound system | 🟢 Implemented |
| 12-column panel mapping | 🟢 Implemented |
| Design-system conformance | 🟢 Asserted in CI |
| Two-display layout (2U + 1U) | 🟢 Built, verified at both resolutions |
| Dashboard pagination | 🟢 Built, derived from upstream's categories |
| Upstream chrome suppression | 🟢 201px of a 400px display reclaimed, at the theme layer |
| Multi-touch interaction | 🟡 Built / needs a real touchscreen |
| Kiosk deployment configuration | 🟡 Written / hardware verification pending |
| Install runbook | 🟡 Written / never executed — [`deploy/INSTALL.md`](deploy/INSTALL.md) |
| Palette choice | 🟡 Awaiting the physical panel |
| Local voice assistant | 🟡 Built / hardware verification pending |
| Voice commands | 🟡 Built / hardware verification pending |
| Wake word — "Computer" | 🟡 Detector built / model needs training |
| Proactive alerts | 🟡 Built / thresholds need calibration |
| Home-lab telemetry | ⚪ Planned |

**P0 — Foundation** and **P1 — LCARS Theme** are complete and verified. **P2**,
**P3**, **P4-1** and the **two-panel split** are built and tested; what remains
for each is a measurement, a training run or a panel — not a feature. See
*[What is left](#what-is-left)*. See
**[SCOPE.md](SCOPE.md)** for the authoritative roadmap and acceptance
criteria.

---

## What this project adds

The upstream World Monitor application is kept intact wherever possible. The
fork adds layers *around* it.

### 🎨 Theme system

A dedicated theme engine, providing an abstraction for visual themes without
coupling the project to upstream's own variant system. A theme may change design
tokens, typography, colour, borders, panels, navigation, structural chrome,
sounds, and other presentation behaviour.

The architecture is deliberately capable of supporting **structurally different**
themes, rather than limiting themes to recolouring.

### 🖥️ LCARS interface

The first major theme recreates the visual language of the Library Computer
Access and Retrieval System from *Star Trek: The Next Generation*. The
implementation emphasises the underlying design language rather than applying a
collection of familiar colours:

- Strong horizontal and vertical instrumentation
- Squared blocks separated by a black gutter
- Large rounded structural elements, and the elbow that joins them
- Compact technical typography, all capitals
- High information density
- Distinct semantic alert states
- Instrument-panel rather than application-window composition

### 🖥️ Dedicated two-panel kiosk

The deployment target is **two displays driven by one machine**: a 2U 1280×400
panel carrying the data, and a 1U 1424×280 console carrying navigation, actions
and voice. Both are multi-touch. Chromium runs under `sway` on Wayland on Ubuntu
Server — automatic startup, no browser chrome, no scrollbars, pixel-specific
layout per surface.

Splitting them is what makes the data panel readable. A 400px-tall display has
no room for both a control column and the map, so **the 2U panel is for viewing
and the 1U console is for control** — the rail, the layer toggles and the time
slider all move off the display they were obscuring. The original 1280×720
single-panel layout survives as `panel`, which is the fallback and the target
you develop against.

Initial hardware is an Intel NUC6i7KYK "Skull Canyon".

### 🎙️ Local voice assistant

The voice system runs entirely on local infrastructure:

```
Microphone → openWakeWord → faster-whisper → llama.cpp
           → Action / Context System → Text-to-Speech → Audio Output
```

No cloud AI service is in the runtime path. The voice system understands a
structured representation of the dashboard rather than scraping the rendered DOM.

The wake word is **"Computer"**, which is the hard case: openWakeWord ships no
pretrained model for it, and because the word occurs in ordinary speech the
false-accept rate is the design problem rather than the miss rate. See
*[The wake word](#the-wake-word)*.

### 🚨 Proactive alerts

When the Composite Instability Index crosses a threshold the panel stops being
something you have to look at. The frame goes to alert colours, the alert tone
sounds, and the assistant speaks unprompted:

> "Alert. Instability index for Sudan has risen to eighty-seven."

**This is the feature that changes what the product is.** A dashboard you have
to look at competes with everything else in the room; one that speaks when
something changes is a monitor in the real sense.

---

## The LCARS UI

The theme is not a recolour. It replaces the dashboard's structural chrome —
rail, header elbow, content well, footer — and re-parents upstream's markup
inside it, while leaving upstream's own files almost entirely alone.

### Design and style guides

Three documents govern it. They are the reference, not a description written
after the fact, and the theme is tested against them.

| Guide | What it is | When to open it |
|---|---|---|
| **[`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md)** | The rules, as a terse checklist: geometry, colour, type, components, page archetypes, motion. | Before changing anything in `src/themes/lcars/`. |
| **[`preview/lcars-style-guide.html`](preview/lcars-style-guide.html)** | The same system *rendered* — elbow anatomy with measured ticks, both palettes as swatches, the type scale, a component gallery, page archetypes, and live motion demos. | When a decision needs to be **seen** rather than read. |
| **[`preview/lcars-preview.html`](preview/lcars-preview.html)** | The frame at exactly 1280×720 with a palette toggle, the full type scale, and the signal ramp shown alongside. | On the panel, from 2.5 m, to settle the palette. |

Both HTML files are self-contained: no build step, no network, no CDN. Open them
straight off the filesystem — including on the kiosk, which is the one machine
where a legibility decision can actually be made.

Supporting documents: **[`docs/LCARS-ASSETS.md`](docs/LCARS-ASSETS.md)** (the
`louh/lcars` review, take/skip with rationale, licence obligations) and
**[`docs/VOICE-CHARACTER.md`](docs/VOICE-CHARACTER.md)** (phrasing table, prosody
parameters, signal chain, engine comparison — P2).

### The rules that matter most

Five, from `docs/DESIGN-SYSTEM.md`, because they are the ones easiest to break
by accident:

- **The elbow is one block and one carve.** A field-coloured `::after` with its
  own smaller radius cuts the inner corner. Outer 72px, inner 30px — exactly
  **2.40 : 1**. The ratio carries the form: closer together reads as a plain
  rounded corner, further apart reads as a bubble. A plain rounded corner is not
  an elbow, and this is the single shape that identifies the language.
- **The gutter is 5px and absolute.** Two coloured blocks never touch, and a
  block never takes a border or a shadow — the gutter is the separation.
- **The field is `#090909`, never pure black.** One step of lift stops an
  emissive panel reading as a dead region.
- **Salmon `#cc6666` and critical red `#ff3300` are status only.** The colour
  contract's one non-negotiable. The moment either appears as ornament, an alert
  stops meaning anything.
- **LCARS cuts, it does not fade.** The originals were backlit physical panels;
  a state change was a lamp switching. No easing, no transforms, no cross-fades,
  no hover transitions.

Type is Antonio, one family, all capitals, with a **13px hard floor** — below
that an ultra-condensed face loses stroke definition at 163 PPI, and the numerals
go first.

### Design principles

1. **Instrumentation, not decoration.** LCARS elements should communicate
   structure or state. Decorative use of semantic colour weakens the interface —
   which is why salmon and red are reserved for alert conditions rather than
   treated as a generic accent.
2. **The 5px gutter matters.** The black separation gutter is a major part of the
   visual language. The interface should read as a collection of independent
   instrument modules rather than a conventional web page.
3. **Information density is intentional.** The target is a glance from ~2.5 m: no
   unnecessarily small text, no excessive whitespace, strong visual hierarchy,
   high-contrast state changes, clear panel boundaries, and minimal interaction
   for common information.
4. **Structural themes must be possible.** The theme engine must support more
   than `--primary-color` and `--background-color`. A future theme should be able
   to replace the entire visual chrome while consuming the same application.

### Conformance is asserted, not reviewed

`e2e/theme-engine-p0.spec.ts` checks the field lift, the elbow's ratio and the
presence of its carve, the type scale, the rail's bottom-left code and
bottom-right label, square status tags, the absence of transitions inside the
frame, and that salmon and red appear nowhere in the chrome at rest.

---

## Themes

| id | Name | Notes |
|---|---|---|
| `default` | World Monitor | Upstream, untouched. Declares nothing at all — see below. |
| `lcars` | LCARS | Drexler palette. Screen-accurate, muted. |
| `lcars-bright` | LCARS (bright) | Broadcast palette. Higher contrast. |

Both LCARS palettes ship because choosing between them is a **legibility test at
2.5 m on a 163-PPI panel**, not a taste decision, and it cannot be settled before
the hardware exists. A display that looks excellent in a browser development
window is not necessarily the one that performs best at a distance.

Switch from the rail's `DISPLAY` button, pin one with `?wm-theme=lcars`, or set
`WM_KIOSK_THEME` in the kiosk profile. The choice persists in `localStorage`; a
URL pin deliberately does not, so a debugging query string never becomes sticky.

**`default` declares nothing.** It is an identity theme that contributes zero
declarations to the cascade, so it renders unmodified upstream pixel-for-pixel by
construction rather than by transcription — and if the LCARS frame ever breaks,
switching back restores a working dashboard. The reasoning, and the extraction
procedure it replaces, are in **[`docs/P0-PORT.md`](docs/P0-PORT.md)**.

The LCARS theme currently provides the structural frame, left navigation rail,
header elbow, footer voice indicator, LCARS typography with a self-hosted font,
sound effects, both palettes, theme switching and persistence, the action bus,
and dashboard re-parenting into the LCARS content well.

---

## Architecture

Four layers, added as new directories so upstream merges stay cheap.

```
┌─────────────────────────────────────────────────────┐
│               Chromium — one profile                │
│                                                     │
│   ┌──────────────────┐        ┌─────────────────┐   │
│   │  2U dashboard    │        │  1U nav console │   │
│   │  1280×400        │◀──────▶│  1424×280       │   │
│   │                  │ Broad- │                 │   │
│   │  Theme + chrome  │  cast  │  Pages, actions │   │
│   │  Globe / panels  │Channel │  Voice, status  │   │
│   └──────────────────┘        └─────────────────┘   │
│        ▲         │                                  │
│        │         ▼                                  │
│        │   Context Snapshot                         │
│        │         │                                  │
└────────┼─────────┼──────────────────────────────────┘
         │         │
         │WebSocket│ HTTP
         │         │
┌────────┴─────────┴──────────────────────────────────┐
│                Local Voice Sidecar                  │
│                                                     │
│    Wake Word → STT → Local LLM → Actions → TTS      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Three architectural decisions carry most of the design.

**The browser does not own the audio pipeline.** Microphone capture, wake-word
detection, speech recognition and text-to-speech belong in the voice sidecar.
This avoids making Chromium responsible for the hardware and audio lifecycle, and
lets the voice system operate independently of browser permissions. The frontend
receives voice-state events over WebSocket.

**The two displays talk to each other, not through the sidecar.** The sidecar
already fans out to every client and would have worked, but routing page
selection through it would mean the console goes dead whenever the voice backend
is down. `BroadcastChannel` needs no server: same origin, same Chromium profile.
`localStorage` carries the fallback and doubles as the last-known page, so a
panel powering on second joins the page its sibling is already showing.

**The LLM does not read the DOM.** It consumes a structured context snapshot —
current theme, visible panels, panel state, selected region, alert state,
relevant metrics, available actions. Scraping rendered markup would couple the
voice layer to upstream's HTML and break on every merge.

### Theme architecture

The fork maintains its own theme mechanism alongside upstream's variant system,
and the distinction is intentional. Upstream's variants are token-only and
coupled to an enumerated list that `/api/download` also consumes; LCARS needs to
replace structural chrome and introduce behaviour that CSS custom properties
cannot express.

```
Upstream variants
        │
        └── Continue working normally

LCARS Theme Engine
        │
        ├── Tokens
        ├── Structural chrome
        ├── Navigation
        ├── Sounds
        └── Theme behaviour
```

The default World Monitor experience remains the baseline compatibility target.

### Action system

Interactive operations go through a centralised action bus. Actions take the form
`namespace.verb`, optionally with a colon-suffixed argument:

```
theme.set          theme.cycle
voice.ptt          panel.focus:cii
```

One registry in `src/themes/actions.ts` is the single source of truth, and the
P3 voice tool schema is **generated** from it by `toolSchema()` rather than
maintained beside it. That is what makes "every rail button action is also
reachable by voice" structural rather than aspirational, and it prevents the
voice system and the graphical UI from developing separate command
implementations.

Because the console is a control surface for a *different window*, each action
also declares where it belongs — `local`, `dashboard` or `both` — and
`installActions` does the forwarding once. A different window is a different
DOM, so an action run on the console would otherwise act on its own parked copy
of the dashboard and do nothing anyone could see. `theme.*` is `both`: the theme
is per-window state, and a console that cycled only its own would leave the two
panels wearing different skins.

The forwarding runs in one direction. The dashboard performs what arrives
through the same registry a button press uses and has no remote port of its own,
so the two cannot volley.

---

## Quick start

```bash
git clone https://github.com/mtaylor45/worldmonitor.git
cd worldmonitor
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000) — override with `DEV_PORT` in
`.env.local`. The app runs with no environment variables; feature-specific data
sources may want credentials, and `.env.example` lists them.

Then try the theme:

```
http://localhost:3000/?wm-theme=lcars
http://localhost:3000/?wm-theme=lcars-bright
```

Each kiosk surface can be opened on its own, which is how you develop against
them without the hardware:

```
?wm-theme=lcars&wm-surface=dashboard    2U data panel,  1280×400
?wm-theme=lcars&wm-surface=nav          1U console,     1424×280
?wm-theme=lcars&wm-surface=panel        single-display fallback, 1280×720
```

Open the first two in separate windows of the *same* browser profile and they
will find each other over `BroadcastChannel` — press a page button on the
console and the dashboard changes page. Surface identity comes from the URL
rather than storage, for the same reason the theme does: a kiosk display has no
keyboard, so identity must not depend on something that could wedge. Viewport
height is the fallback, so dragging a window between panels during development
does the right thing.

Upstream's own variants (`npm run dev:tech`, `dev:finance`, `dev:commodity`,
`dev:happy`, `dev:energy`) are unaffected — the theme layer is deliberately
independent of them.

---

## Project structure

The fork is deliberately organised so that most new functionality lives outside
upstream files.

```
worldmonitor/
│
├── src/
│   ├── surface/
│   │   └── index.ts         which display this is; the cross-display bus
│   │
│   ├── pages/
│   │   ├── index.ts         pages derived from upstream's category map
│   │   └── controller.ts    keeps both displays on the same page
│   │
│   ├── themes/
│   │   ├── engine.ts        registry, tokens, chrome lifecycle
│   │   ├── actions.ts       action registry — rail and voice, one source
│   │   ├── sounds.ts        slot-based UI sound playback
│   │   ├── tokens.ts        upstream token contract (drift-checked)
│   │   ├── default/         identity theme
│   │   └── lcars/           tokens, chrome, nav console, stylesheet
│   │
│   ├── voice/
│   │   ├── protocol.ts      wire protocol (twin of the sidecar's)
│   │   ├── client.ts        WebSocket client, reconnect, degradation
│   │   └── index.ts         indicator, transcript, chirp wiring
│   │
│   ├── context/
│   │   └── snapshot.ts      structured dashboard state for the model
│   │
│   └── alert/
│       └── index.ts         the data-wm-alert attribute and its tone
│
├── public/
│   ├── fonts/               self-hosted Antonio + OFL
│   └── sounds/              LCARS UI sounds + licence
│
├── deploy/
│   ├── INSTALL.md           hardware bring-up runbook, first light onward
│   ├── Makefile             bring-up: dashboard, models, up, doctor, kiosk*
│   ├── models.conf          weights + verified sha256
│   ├── fetch-models.sh      fetch and verify, idempotent
│   └── kiosk/               dashboard unit, sway (two panels), cage (one)
│
├── preview/
│   ├── lcars-style-guide.html   the design system, rendered
│   └── lcars-preview.html       1280×720 mock, palette toggle
│
├── voice-sidecar/           local voice assistant (container)
│   ├── wm_voice/
│   │   ├── phrasing.py      the register: validator, templates, numerals
│   │   ├── audio.py         one microphone, fanned out; pre-roll buffer
│   │   ├── wake.py          "Computer": threshold, streak, refractory
│   │   ├── alerts.py        thresholds, hysteresis, quiet hours, wording
│   │   ├── pipeline.py      turn orchestration and the latency budget
│   │   ├── protocol.py      wire protocol, mirrored in src/voice/
│   │   ├── commands.py      the P3 boundary: contract and validator
│   │   ├── router.py        intent tiers; tier 0 answers with no model
│   │   ├── tools.py         UI tools dispatched, data tools fetched
│   │   ├── doctor.py        preflight: what is broken, and the remedy
│   │   ├── server.py        WebSocket fan-out, wake loop, alert poller
│   │   ├── adapters.py      STT / LLM / TTS / audio out
│   │   └── signal_chain.py  post-TTS ffmpeg chain
│   └── tests/
│
├── e2e/                     theme and acceptance tests
│
├── docs/
│   ├── DESIGN-SYSTEM.md
│   ├── LCARS-ASSETS.md
│   ├── P0-PORT.md
│   ├── SPRINT-PLAN.md
│   ├── UPSTREAM-DIFF.md
│   ├── VOICE-CHARACTER.md
│   └── WORKING-BRIEF.md
│
└── SCOPE.md
```

Every directory above is populated. What remains is hardware verification.

---

## Kiosk

Two displays, one machine:

| Surface | Panel | Carries |
|---|---|---|
| `dashboard` | 2U, 1280×400 | The data. No rail — navigation moved off it |
| `nav` | 1U, 1424×280 | The console: pages, actions, voice, status |
| `panel` | 1280×720 | Single-display fallback, and the development target |

```bash
sudo make -C deploy dashboard      # the dashboard server itself
make -C deploy models && make -C deploy up && make -C deploy doctor
sudo make -C deploy kiosk-dual     # two displays (sway)
sudo make -C deploy kiosk          # one display  (cage)
```

**[`deploy/INSTALL.md`](deploy/INSTALL.md) is the runbook** — what to check
before mounting anything, how to find the output and touch identifiers, and the
four acceptance criteria that exist only on hardware. Enable one kiosk unit, not
both: they want the same screens and the dual unit declares `Conflicts=` for
that reason.

`wm-dashboard.service` runs the app itself, as an unprivileged no-login `wm`
user. It
runs the Vite dev server rather than serving a static build, deliberately:
upstream serves its 92 API routes through dev-server plugins, so a built client
would paint the frame and then fail every fetch behind it.

`cage` runs exactly one fullscreen client by design, which is right for a
single panel and useless for two, so the dual profile uses **sway** — still no
desktop, still nothing that can steal focus, but able to assign each window to
an output by `--class`. Output names are machine-specific
(`swaymsg -t get_outputs`) and the unit **refuses to start until they are set**
rather than coming up with the panels swapped.

The two windows share one Chromium profile, and that is load-bearing.
`BroadcastChannel` reaches every same-origin context in the same browser
instance and no further, so one profile is what lets page selection cross
between the panels with no server in the middle. Two profiles, or two
origins, and the console goes quiet without erroring — which is exactly how
that failure presents.

`doctor` is the one to run before trusting a panel: every dependency the
sidecar has fails silently, so it checks each and names a remedy rather than a
verdict.

### Pages

Upstream can render **189 panels across 23 categories**. A 1280×400 display
holds four or five. Pagination is not a convenience here — it is the only way
the dashboard fits the hardware at all, and `docs/DESIGN-SYSTEM.md` specified it
in the "Page archetypes" table before it existed.

| Page | Tone | Draws from |
|---|---|---|
| `OPS` | tan | Core situational panels |
| `SCAN` | lilac | Intelligence, correlation |
| `COMMS` | periwinkle | Regional, topical and positive news |
| `ENGINEERING` | ice | Markets, commodities, crypto, central banks |
| `LIBRARY` | cream | Data tracking, tech, startups, security policy |

Each page carries one tone from the structural ramp, so **a page is
identifiable from the doorway before any label resolves**. SCAN diverges from
the design system deliberately: its archetype table gives LONG RANGE SCAN a
peach/salmon frame, but salmon is status-only in this fork — a page permanently
wearing the alert colour would make an actual alert mean nothing.

Three rules make this safe to leave running unattended:

- **Pages are derived from `PANEL_CATEGORY_MAP`, never duplicated.** Importing
  upstream's map read-only means a panel upstream adds lands on a page with no
  edit here, and a rename breaks the build rather than the display. Duplicating
  the list would fail the other way — silently, months later, with a panel
  nobody can reach.
- **Panels are hidden by a class, never removed.** Upstream owns that markup.
  Hiding keeps a chart's state across a page switch instead of re-fetching, and
  a resize is dispatched afterwards because a chart rendered at zero width does
  not recover on its own.
- **Only pages with rendered panels are offered.** Most of the 189 panels are
  disabled on any given install. An unavailable page is *dimmed* rather than
  removed, because a console whose buttons move defeats the muscle memory a wall
  panel runs on.

`panel.focus` switches page first. A panel on another page is not reachable by
scrolling, so without that the command would scroll to a hidden element and
appear to do nothing.

### What the console reports back

A control that cannot say what it controls is half a control, and on a wall
panel the missing half is the one you read from across a room. The display that
owns the map reports which layers are lit — on request, after performing a
forwarded toggle, and when the map changes them itself. The console asks on
boot, since the two panels start independently and either can come up second.

The live block keeps its colour and **the row dims around it**. Recolouring the
selected button was the obvious approach and was wrong twice over: every colour
bright enough to read as "lit" is already one of the five structural tones, so
OPS-when-selected rendered identical to ENGINEERING at rest — and overwriting
the tone destroys the archetype information that makes a page identifiable at
distance. Dimming costs no token, survives a palette swap, and says the same
thing for pages and layers.

Upstream chrome the kiosk does not want — the Pro banner, the dashboard tab bar,
the site header and footer, the map's own layer toggles and time slider — is
suppressed **in the theme, never in upstream**. A CSS rule in our own stylesheet
costs nothing at merge time; deleting the components upstream would be a
conflict on every release forever. Together that is 201px of a 400px display
reclaimed: the map measured **106px** before and **306px** after. `default` is
deliberately unaffected — it is the identity theme and the safety net, so
switching to it restores upstream exactly, including the parts of upstream we
would rather not look at.

Ubuntu **Server** rather than Desktop under either compositor: a desktop
session with the panel hidden has more surface area, more update churn, and more
things that can steal focus at 3am on a display nobody is sitting in front of.

The theme and the surface are both pinned in the launch URL rather than left to
`localStorage`, so a panel with no keyboard cannot be wedged by a bad stored
value.

**A touchscreen left unmapped sends whole-layout coordinates**, so a touch on
the lower panel lands on the upper one. `map_to_output` per device is what makes
touch work at all on a multi-output kiosk, and it is the most common thing to
get wrong. Device identifiers come from `swaymsg -t get_inputs`.

Operational notes are in **[`deploy/kiosk/README.md`](deploy/kiosk/README.md)**.

**Not yet verified on hardware.** Expect `--ozone-platform`, the `WLR_*`
environment and the output modes to need adjustment against real panels.

### Kiosk hardware

| | |
|---|---|
| Machine | Intel NUC6i7KYK "Skull Canyon" |
| CPU | Intel Core i7-6770HQ — 4 cores, 8 threads |
| GPU | Intel Iris Pro 580 |
| Memory | 32 GB |
| Data panel | 2U rack-mount LCD, 1280×400, multi-touch |
| Console panel | 1U rack-mount LCD, 1424×280, multi-touch |
| OS | Ubuntu Server 26.04 LTS |
| Compositor | `sway` / Wayland — `cage` for the single-panel profile |
| Browser | Chromium, one profile, one window per output |

The fixed resolutions are intentional. This is not meant to become another
responsive web application — the primary interface is a dedicated physical
instrument, and each surface is laid out for the panel it runs on.

---

## Local-first philosophy

The project runs on infrastructure controlled by the operator. The long-term
architecture avoids cloud dependencies for wake-word detection, speech
recognition, LLM inference, text-to-speech and dashboard control.

Network access may still be required by the underlying World Monitor data
sources, but the assistant and the kiosk control plane remain local. That buys
privacy, predictable operation, no subscription requirement for inference,
independence from external AI APIs, better control over latency, and continued
operation when external services are unavailable.

---

## How this fork stays cheap to merge

Upstream is 6,000+ commits and actively maintained. **Merge cost is the primary
non-functional constraint on this project**, and it is easy to destroy by
accident.

Current code surface: **2 files, 3 insertions, 1 deletion.**

| File | Change |
|---|---|
| `src/main.ts` | `import { bootApp }` and one call before `new App('app')` |
| `index.html` | `data-wm-shell` on `<div id="app">` |

Plus this README, which is rewritten for the fork and deliberately not kept
mergeable — when upstream edits its own, take ours.

Everything else lives in new directories, which never conflict. The rules:

1. New functionality lives in new directories whenever possible.
2. Changes to upstream files are limited to small, deliberate integration seams.
3. Upstream files are never reformatted merely for style.
4. DOM attributes and hooks are preferred over invasive upstream modifications.
5. Every upstream file touched is documented in `docs/UPSTREAM-DIFF.md`.

Rule 4 is the one that does the work: *before editing an upstream file, ask
whether a DOM attribute hook plus code in our own directory would do instead.* It
usually will. That question saved a third seam (upstream already marks panels
with `data-panel`) and a fourth (chrome re-mounts via a `MutationObserver` rather
than a post-render callback).

Every upstream file touched, every deliberate coupling to upstream internals, and
every seam considered and rejected is logged in
**[`docs/UPSTREAM-DIFF.md`](docs/UPSTREAM-DIFF.md)**. When a merge conflicts,
that file is the map.

```bash
git remote add upstream https://github.com/koala73/worldmonitor.git
git fetch upstream
git merge upstream/main
```

Conflicts should only appear in the files listed above. If a merge touches
anything else, something has drifted — stop and reconcile before resolving.

---

## Testing

```bash
# Engine behaviour, cycle stability, chrome re-mount
npx vitest run --config vitest.dom.config.mts tests/dom/theme-engine.test.mts

# Extraction still matches upstream's main.css
npx vitest run --config vitest.dom.config.mts tests/dom/theme-token-contract.test.mts

# Acceptance: pixel fidelity, cycle stability, persistence, assets,
# 12-column grid, kiosk geometry, design-system conformance, voice wiring,
# and that the alert state really repaints the frame
npx playwright test e2e/theme-engine-p0.spec.ts

# Both kiosk surfaces at their real resolutions, and the bus between them
npx playwright test e2e/two-display.spec.ts

# Voice sidecar - standard library only, no pytest to install
cd voice-sidecar && python3 -m unittest discover -s tests -t .
```

Current counts: **230** sidecar tests, **834** DOM tests across 96 files, and
**69** fork-owned end-to-end tests — 36 acceptance, 33 across the two
displays. Upstream's own e2e suites run unchanged alongside them.

Run all three after every upstream merge. The token test catches upstream
retuning a value our extraction records; the e2e catches upstream changing the
shell or panel markup the engine depends on.

**When the token drift test fails, re-run the extraction procedure in
`docs/P0-PORT.md`. Do not edit the expectation to match.**

The acceptance suite verifies default rendering, theme switching and persistence,
repeated theme cycling, DOM stability, asset self-hosting, the 12-column grid,
kiosk geometry and design-system conformance. Visual regressions are treated
seriously because the target is a fixed physical display rather than an arbitrary
collection of browser viewports.

Future hardware acceptance testing will additionally verify readability at
distance, audio behaviour, wake-word reliability, CPU utilisation, end-to-end
voice latency, and long-duration kiosk stability.

---

## Roadmap

### P0 — Foundation · complete

Established the theme architecture and demonstrated it could coexist with the
upstream application without altering the default experience: theme engine,
default identity theme, switching, persistence, URL selection, action bus, kiosk
configuration, acceptance tests, upstream compatibility verification.

The central acceptance criterion was that the default experience remain visually
and structurally equivalent to upstream. It is verified three ways — no
declarations emitted, byte-identical screenshots, and every computed property of
every element matching across ~1.7M pairs.

### P1 — LCARS theme · complete

LCARS chrome, navigation rail, header and footer, typography with a self-hosted
font, sound integration, both palettes, rail actions bound to real panel keys,
dashboard content integration, the 12-column panel mapping, and 1280×720
composition with no overflow in either direction.

### P2 — Voice, read-only · built, pending hardware

```
openWakeWord → faster-whisper → llama.cpp → TTS
```

Wake word, push-to-talk, live transcript, voice-state indicator, local
inference, LCARS audio feedback, structured dashboard questions.

The sidecar and the frontend client are written and tested: `voice-sidecar/`
holds the pipeline, the phrasing layer and the container; `src/voice/` holds
the WebSocket client, the state indicator and the transcript. The rail's LISTEN
button drives real push-to-talk, and refuses audibly when no sidecar answers.

**Three acceptance criteria are hardware measurements and remain open:** under
3 seconds from end-of-speech to first audio on CPU, the wake word surviving the
assistant's own TTS playback (the AEC test), and no false wake in 24 hours of
room noise. See `voice-sidecar/README.md`.

#### The wake word

The wake word is **"Computer"**, and two facts about it shape the whole
detector.

**openWakeWord ships no pretrained model for it.** The bundled set is `alexa`,
`hey_jarvis`, `hey_mycroft`, `hey_rhasspy`. "Computer" has to be trained —
openWakeWord's own pipeline does this from synthetic speech with no recordings
required, and `docs/VOICE-CHARACTER.md` carries the procedure. Until that model
exists, `WM_WAKE_MODEL` is empty, the detector reports itself unavailable and
**says so loudly at startup** rather than sitting silent and looking like a
system that is listening. Push-to-talk is unaffected.

**"Computer" is a single common word, so false accepts are the design problem,
not misses.** It occurs in ordinary speech in a way "hey jarvis" never does.
Three filters, all tunable, all tuned by the 24-hour test and nothing else:

| Control | Default | What it removes |
|---|---|---|
| `WM_WAKE_THRESHOLD` | `0.7` | Low-confidence matches — openWakeWord's own default is 0.5 |
| `WM_WAKE_CONSECUTIVE` | `2` | Single-frame spikes, which is what most false accepts look like |
| `WM_WAKE_REFRACTORY` | `2.0` | The tail of one word firing a second turn |

Two supporting pieces matter as much as the detector. **One microphone, opened
once**: the detector listens continuously while capture records on demand, and
two components opening an input stream independently is how you get "device
busy" on the machine nobody is sitting at. And **pre-roll** — detection only
fires once the whole word has been heard, so without a ring buffer of recent
audio "Computer, show the map" reaches recognition as "ow the map".

### P3 — Voice commands · built, pending hardware

Turns the assistant into an actual control interface. Commands map onto the same
action registry the graphical interface uses:

> "Computer, change the theme."
> "Computer, show the Pacific."
> "Computer, focus the market panel."

The LLM never directly manipulates application state. Instead:

```
User speech → LLM → Validated action → wm:action → Application
```

That is a deterministic boundary between natural-language interpretation and
application control — and it is validated **twice**: the sidecar checks the
model's JSON against the registry and the panel list, then the dashboard checks
it again before dispatching. One validation is a single point of trust in a
language model's output.

`src/context/` builds the structured snapshot the model reasons over. It reads
the DOM, but that coupling is confined to one versioned file; the model never
sees markup.

**The model is Qwen3 8B Q4_K_M on llama.cpp, non-thinking.** Q4_K_M because CPU
decode here is memory-bandwidth bound; non-thinking because a chain of thought
the user never hears is latency spent on nothing.

Tool calling is used where the model has it — but a native call and a
constrained-JSON object are normalised into the same shape and checked against
the same registry, so the boundary does not depend on how the model was asked.

**The three-second target applies to tier 0, not to everything.** Pattern-matched
commands ("show the map", "focus markets") answer in under a second with no
model at all; questions and briefings take 8–12 s, because at ~4 tok/s an 8B
cannot do better and pretending otherwise would ship a missed target. The
arithmetic and the tier table are in `voice-sidecar/README.md`.

### P4-1 — Proactive alerts · built, pending calibration

The feature that changes what the product is. A dashboard that merely displays
information still requires attention; one that recognises significant changes
and speaks is an actual monitoring system.

```text
GET /api/intelligence/v1/get-risk-scores
      → AlertWatcher      thresholds, hysteresis, quiet hours
      → alert frame       frame goes red, alert tone sounds once
      → templated speech  "Alert. Instability index for Sudan has risen to eighty-seven."
```

**The sidecar decides; the dashboard renders.** Thresholds, hysteresis, quiet
hours and the readings all live in `voice-sidecar/wm_voice/alerts.py`. The
dashboard receives one boolean and sets `data-wm-alert`.

That is deliberately unlike an *action*, which both sides validate. An action is
a language model's claim about what the user wanted, so it is checked twice; an
alert is arithmetic on a number the sidecar fetched, and a second opinion in the
browser would mean a copy of the thresholds drifting out of step with the ones
that actually fire.

**The failure mode is not "it did not fire".** It is "it fires often enough that
you stop looking", and four guards exist for that and nothing else:

| Guard | Why |
|---|---|
| **Hysteresis** (`WM_ALERT_CLEAR_MARGIN`) | A score oscillating around 85 against a threshold of 85 fires, clears, fires and clears |
| **A floor between *spoken* alerts** (`WM_ALERT_MIN_INTERVAL`) | Several regions cross at once. The display carries all of them; the voice speaks the most severe |
| **Quiet hours** (`WM_ALERT_QUIET_HOURS`) | Silences the voice, **never the display**. An alert raised at 3am is still on the panel at 3am |
| **Trustworthiness** | A `degraded` or `stale` reading raises nothing — and clears nothing. Dropping a live alert because the upstream cache hiccuped is the failure a monitor exists to prevent |

**No model runs on this path.** The wording is templated: a model would cost
eight to twelve seconds on this CPU to produce a sentence that was always going
to be one of two shapes, drift out of register over a long session, and
eventually read the number back wrong. The phrasing layer still runs, because it
runs on every spoken line.

Thresholds are user-editable and forgiving — `WM_ALERT_RULES="*>85, Sudan>75,
Taiwan+12"`, where a named region beats the catch-all, `>` is a level and `+` is
a 24-hour rise (a jump from 40 to 55 is news even though 55 clears no level
line). A malformed entry is logged and skipped: turning a typo in an environment
variable into a panel that will not start is strictly worse than running the
rules that parsed.

### Two-panel kiosk · built, pending hardware

Tracked as sprints rather than a phase number — see
[`docs/SPRINT-PLAN.md`](docs/SPRINT-PLAN.md).

The layout split across a 2U data panel and a 1U navigation console: surface
identity from the launch URL, `BroadcastChannel` between the windows, action
forwarding by `target`, pages derived from upstream's category map, the console
reporting map-layer state back, and the sway kiosk profile with per-device touch
mapping. Upstream chrome the kiosk does not want is suppressed at the theme
layer, which took the map from 106px to 306px of a 400px display.

Verified at both resolutions in Playwright. What it has not met is a panel.

### P4 — Remaining candidates

Scheduled spoken briefings · presence-aware attract mode · conversational
follow-up · voice-driven map control · panel focus brackets · home-lab telemetry
· PADD companion interface · historical time-scrubbing · a second structurally
different theme.

<a id="what-is-left"></a>

### What is left

Every phase is built. What remains is measurement, a training run, and a panel:

| | Blocked on |
|---|---|
| Sub-3s voice latency on CPU | The NUC. `voice-sidecar/bench_latency.py` measures it |
| Wake word surviving TTS playback | The audio hardware. Responds = real full-duplex AEC; ignores you until playback ends = ducking, and the device is the wrong category |
| No false wake in 24 hours | A day in the room the panel lives in |
| A trained "Computer" model | A training run, not code |
| Alert thresholds | A week of real readings. `*>85` is a guess, as are the margin, the poll interval and the spoken-alert floor |
| The palette choice | A legibility test at 2.5 m. `preview/lcars-preview.html` exists to settle it |
| The kiosk profile | Bring-up on the real panels: output modes, per-device touch mapping, and whether each panel reports its native timing at all. [`deploy/INSTALL.md`](deploy/INSTALL.md) is the runbook, and has never been executed |
| The cap-height factor (1.36) | Recorded as a token, not yet applied — it is calibrated for Swiss 911, and Antonio has different vertical metrics |

None of these is a missing feature. Each is a number that can only be taken off
the physical panel, in the room it lives in.

### Home-lab integration

A future version integrates with the surrounding self-hosted infrastructure —
Docker Swarm node health, Harbor registry status, NAS capacity, media services,
application health, infrastructure alerts. That evolves the system from a
world-news dashboard into a broader personal operations console, where

> "Computer, status of the compute swarm."

produces a concise spoken response from live telemetry.

---

## Contributing

Primarily a personal self-hosted project, but contributions and technical
discussion are welcome.

- **Keep upstream changes small.** Prefer adding functionality under
  `src/themes/`, `src/voice/` or `src/context/` rather than modifying upstream
  components.
- **Preserve the default experience.** Changes to theme infrastructure must not
  unintentionally alter the standard World Monitor experience.
- **Avoid unnecessary churn.** Do not reformat or reorganise upstream files
  unless the change is required.
- **Document integration seams.** If an upstream file must change, record it in
  `docs/UPSTREAM-DIFF.md`.
- **Test at the actual target resolutions.** A feature that looks correct on a
  2560×1440 monitor but fails at **1280×400**, **1424×280** or **1280×720** is
  not complete. All three are asserted in `e2e/`, and the two kiosk surfaces are
  reachable with `?wm-surface=dashboard` and `?wm-surface=nav`.

Upstream's own contributor docs — `AGENTS.md`, `CONTRIBUTING.md`,
`ARCHITECTURE.md`, `CONCEPTS.md`, `SELF_HOSTING.md` — still apply and are not
superseded by anything here.

---

## Documentation

| Doc | Contents |
|---|---|
| [`SCOPE.md`](SCOPE.md) | Authoritative roadmap, architecture, constraints, assets, BOM, risks |
| [`docs/WORKING-BRIEF.md`](docs/WORKING-BRIEF.md) | Conventions and fork rules you need before editing |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | LCARS visual and implementation specification — the rules as a checklist |
| [`preview/lcars-style-guide.html`](preview/lcars-style-guide.html) | The design system rendered: elbow anatomy, both palettes, type scale, component gallery, motion demos |
| [`preview/lcars-preview.html`](preview/lcars-preview.html) | The frame at 1280×720 with a palette toggle, for the on-panel decision |
| [`docs/LCARS-ASSETS.md`](docs/LCARS-ASSETS.md) | Asset research, take/skip rationale, licensing |
| [`docs/VOICE-CHARACTER.md`](docs/VOICE-CHARACTER.md) | Phrasing, prosody, signal chain, engine comparison, and how to train the "Computer" wake model |
| [`docs/P0-PORT.md`](docs/P0-PORT.md) | Default-theme extraction and acceptance criteria |
| [`docs/UPSTREAM-DIFF.md`](docs/UPSTREAM-DIFF.md) | Every upstream file touched, and why |
| [`docs/SPRINT-PLAN.md`](docs/SPRINT-PLAN.md) | Current priorities and the sprint they belong to |
| [`deploy/INSTALL.md`](deploy/INSTALL.md) | Hardware bring-up runbook: base OS, the two panels, touch mapping, and the acceptance tests that need hardware |
| [`deploy/kiosk/README.md`](deploy/kiosk/README.md) | Kiosk operational notes |
| [`voice-sidecar/README.md`](voice-sidecar/README.md) | Voice sidecar: run, configure, and what only hardware can verify |
| [`docs/wiki/`](docs/wiki/) | Source of the [project wiki](https://github.com/mtaylor45/worldmonitor/wiki) — configuration reference, merge routine, wake-word training, alert tuning, troubleshooting |

---

## Licence and attribution

This fork is **AGPL-3.0-only**, inherited from upstream. Self-hosting on a LAN
imposes nothing further; distributing it does.

| Source | Licence | Obligation |
|---|---|---|
| [koala73/worldmonitor](https://github.com/koala73/worldmonitor) | AGPL-3.0 | Fork stays AGPL. Copyright (C) 2024-2026 Elie Habib. |
| [louh/lcars](https://github.com/louh/lcars) | GPL-3.0 | Compatible via AGPLv3 §13. Attributed per file; licence at `public/sounds/LCARS-SOUNDS-LICENSE.txt`. |
| [Antonio](https://fonts.google.com/specimen/Antonio) | OFL-1.1 | Licence retained at `public/fonts/Antonio-OFL.txt`. |

**Do not ship:** Helvetica LT Std Ultra Compressed — a commercial Monotype face
that appears in `louh/lcars` without an apparent redistribution licence. It is
not in this repository and must not be added. More generally: commercially
licensed Trek fonts and proprietary franchise assets must not be copied here
merely because they resemble the aesthetic.

**Do not distribute publicly without replacing:** the `.ogg` sound assets. Their
origin is unstated upstream and they are likely show-sourced. Acceptable for a
personal LAN kiosk; not for anything public. The theme's sound slots mean
replacing them is a change of file, not of any call site.

The goal is an LCARS interface implemented with legally redistributable assets
and original code.

Star Trek and LCARS are Paramount IP. This is an independent fan/technical
project, not affiliated with or endorsed by Paramount, CBS, or the Star Trek
franchise. Personal self-hosted use is ordinary fan territory; public
distribution of an LCARS-branded product is a different question and outside this
project's scope.

### Credit

Upstream World Monitor is built by **Elie Habib**
([@koala73](https://github.com/koala73)) — the entire dashboard, all of its data
pipelines, and every panel this fork reframes. If you want the product rather
than the experiment, use [worldmonitor.app](https://www.worldmonitor.app).

The LCARS visual language is Michael Okuda's, designed for *Star Trek: The Next
Generation*. The Drexler palette is attributed to scenic artist Doug Drexler.

---

## Project philosophy

The finished system should feel less like a website and more like a piece of
equipment. It should be always available, quiet when nothing matters, visually
informative at a glance, audible when something important changes, controllable
without a keyboard, locally operated, deterministic where actions matter, easy to
maintain, and easy to synchronise with upstream.

The ideal interaction is not:

> Open browser → find dashboard → inspect panels → click around.

It is:

> **Look at the computer.**

And:

> **"Computer, status."**
