# LCARS World Monitor

A self-hosted, always-on situational-awareness dashboard with an LCARS interface,
built for a dedicated 1280×720 kiosk display and — eventually — controlled by a
local voice assistant.

It is a personal fork of **[koala73/worldmonitor](https://github.com/koala73/worldmonitor)**,
extending the upstream dashboard with a theme architecture, the LCARS visual
system, kiosk deployment, and a roadmap toward fully local voice interaction.

The whole project follows from one idea:

> A situational-awareness display should be something you **glance at** — and
> eventually something you can **talk to** — rather than another application you
> have to sit down and operate.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Fork of](https://img.shields.io/badge/fork_of-koala73%2Fworldmonitor-informational)](https://github.com/koala73/worldmonitor)
[![Upstream code surface](https://img.shields.io/badge/upstream_files_touched-2-success)](docs/UPSTREAM-DIFF.md)
[![Target](https://img.shields.io/badge/target-1280%C3%97720_kiosk-9999ff)](#kiosk-hardware)

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
| Kiosk deployment configuration | 🟡 Written / hardware verification pending |
| Palette choice | 🟡 Awaiting the physical panel |
| Local voice assistant | 🟡 Built / hardware verification pending |
| Voice commands | ⚪ Planned |
| Proactive alerts | ⚪ Planned |
| Home-lab telemetry | ⚪ Planned |

**P0 — Foundation** and **P1 — LCARS Theme** are complete and verified. P2 has
not started. See **[SCOPE.md](SCOPE.md)** for the authoritative roadmap and
acceptance criteria.

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

### 🖥️ Dedicated kiosk

The deployment target is a fixed 1280×720 display running Chromium under `cage`
on Wayland, on Ubuntu Server — automatic startup, no browser chrome, no
scrollbars, pixel-specific layout. Initial hardware is an Intel NUC6i7KYK
"Skull Canyon".

### 🎙️ Local voice assistant

The eventual voice system runs entirely on local infrastructure:

```
Microphone → openWakeWord → faster-whisper → Ollama
           → Action / Context System → Text-to-Speech → Audio Output
```

No cloud AI service is in the runtime path. The voice system understands a
structured representation of the dashboard rather than scraping the rendered DOM.

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
│                  Chromium Kiosk                     │
│                                                     │
│   ┌─────────────────┐     ┌─────────────────────┐   │
│   │  Theme Engine   │     │  World Monitor      │   │
│   │                 │────▶│  Dashboard          │   │
│   │  Tokens         │     │  Globe / Feeds      │   │
│   │  Chrome         │     │  Panels / Data      │   │
│   └─────────────────┘     └─────────────────────┘   │
│             ▲                     │                 │
│             │                     ▼                 │
│             │              Context Snapshot         │
│             │                     │                 │
└─────────────┼─────────────────────┼─────────────────┘
              │                     │
              │ WebSocket           │ HTTP
              │                     │
┌─────────────┴─────────────────────┴─────────────────┐
│                Local Voice Sidecar                  │
│                                                     │
│    Wake Word → STT → Local LLM → Actions → TTS      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

Two architectural decisions carry most of the design.

**The browser does not own the audio pipeline.** Microphone capture, wake-word
detection, speech recognition and text-to-speech belong in the voice sidecar.
This avoids making Chromium responsible for the hardware and audio lifecycle, and
lets the voice system operate independently of browser permissions. The frontend
receives voice-state events over WebSocket.

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
│   ├── themes/
│   │   ├── engine.ts        registry, tokens, chrome lifecycle
│   │   ├── actions.ts       action registry — rail and voice, one source
│   │   ├── sounds.ts        slot-based UI sound playback
│   │   ├── tokens.ts        upstream token contract (drift-checked)
│   │   ├── default/         identity theme
│   │   └── lcars/           tokens, chrome, stylesheet
│   │
│   ├── voice/
│   │   ├── protocol.ts      wire protocol (twin of the sidecar's)
│   │   ├── client.ts        WebSocket client, reconnect, degradation
│   │   └── index.ts         indicator, transcript, chirp wiring
│   │
│   └── context/             structured dashboard context       (P3)
│
├── public/
│   ├── fonts/               self-hosted Antonio + OFL
│   └── sounds/              LCARS UI sounds + licence
│
├── deploy/
│   └── kiosk/               cage + Chromium + systemd unit
│
├── preview/
│   ├── lcars-style-guide.html   the design system, rendered
│   └── lcars-preview.html       1280×720 mock, palette toggle
│
├── voice-sidecar/           local voice assistant (container)
│   ├── wm_voice/
│   │   ├── phrasing.py      the register: validator, templates, numerals
│   │   ├── pipeline.py      turn orchestration and the latency budget
│   │   ├── protocol.py      wire protocol, mirrored in src/voice/
│   │   ├── server.py        WebSocket fan-out, push-to-talk
│   │   ├── adapters.py      wake / STT / LLM / TTS / audio
│   │   └── signal_chain.py  post-TTS ffmpeg chain
│   └── tests/
│
├── e2e/                     theme and acceptance tests
│
├── docs/
│   ├── DESIGN-SYSTEM.md
│   ├── LCARS-ASSETS.md
│   ├── P0-PORT.md
│   ├── UPSTREAM-DIFF.md
│   ├── VOICE-CHARACTER.md
│   └── WORKING-BRIEF.md
│
└── SCOPE.md
```

`src/context/` represents planned P3 architecture and is not yet populated.

---

## Kiosk

`deploy/kiosk/` holds a `cage` + Chromium profile for Ubuntu Server: a systemd
unit, a launch script, and an env template. Install steps and operational notes
are in **[`deploy/kiosk/README.md`](deploy/kiosk/README.md)**.

Server rather than Desktop, then `cage`: a desktop session with the panel hidden
has more surface area, more update churn, and more things that can steal focus at
3am on a display nobody is sitting in front of.

The theme is pinned in the launch URL rather than left to `localStorage`, so a
panel with no keyboard cannot be wedged by a bad stored value.

**Not yet verified on hardware.** Expect `--ozone-platform` and the `WLR_*`
environment to need adjustment against a real display and input device.

### Kiosk hardware

| | |
|---|---|
| Machine | Intel NUC6i7KYK "Skull Canyon" |
| CPU | Intel Core i7-6770HQ — 4 cores, 8 threads |
| GPU | Intel Iris Pro 580 |
| Memory | 32 GB |
| Display | 1280×720, 9-inch, ~163 PPI |
| OS | Ubuntu Server 26.04 LTS |
| Compositor | `cage` / Wayland |
| Browser | Chromium |

The fixed display resolution is intentional. This is not meant to become another
responsive web application — the primary interface is a dedicated physical
instrument.

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
| `src/main.ts` | `import { bootThemes }` and one call before `new App('app')` |
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
# 12-column grid, kiosk geometry, design-system conformance, voice wiring
npx playwright test e2e/theme-engine-p0.spec.ts

# Voice sidecar - standard library only, no pytest to install
cd voice-sidecar && python3 -m unittest discover -s tests -t .
```

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
openWakeWord → faster-whisper → Ollama → TTS
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

### P3 — Voice commands · planned

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
application control.

### P4 — Future features

Proactive alert states · scheduled spoken briefings · presence-aware attract mode
· conversational follow-up · voice-driven map control · panel focus brackets ·
home-lab telemetry · PADD companion interface · historical time-scrubbing · a
second structurally different theme.

The most strategically interesting is **proactive alerting**. A dashboard that
merely displays information still requires attention. A dashboard that recognises
significant changes and speaks becomes an actual monitoring system.

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
- **Test at the actual target resolution.** A feature that looks correct on a
  2560×1440 monitor but fails at **1280×720** is not complete.

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
| [`docs/VOICE-CHARACTER.md`](docs/VOICE-CHARACTER.md) | Phrasing, prosody, signal chain, engine comparison |
| [`docs/P0-PORT.md`](docs/P0-PORT.md) | Default-theme extraction and acceptance criteria |
| [`docs/UPSTREAM-DIFF.md`](docs/UPSTREAM-DIFF.md) | Every upstream file touched, and why |
| [`deploy/kiosk/README.md`](deploy/kiosk/README.md) | Kiosk install and operational notes |
| [`voice-sidecar/README.md`](voice-sidecar/README.md) | Voice sidecar: run, configure, and what only hardware can verify |

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

And eventually:

> **"Computer, status."**
