# LCARS World Monitor — project scope

**Working name:** LCARS World Monitor
**Base:** fork of [koala73/worldmonitor](https://github.com/koala73/worldmonitor) (AGPL-3.0)
**Status:** P0 complete and verified. P1 not started.

---

## 1. What we're building

A self-hosted situational-awareness dashboard running as an always-on kiosk on a
9-inch panel, with two capabilities added on top of upstream World Monitor:

1. **A selectable theme system**, with an LCARS theme as the first non-default
   entry. Themes can restyle via tokens alone or replace structural chrome
   entirely.
2. **A local voice assistant** that answers questions about what's on the
   dashboard and executes commands against it. Wake word and push-to-talk, no
   cloud services in the runtime path.

The design goal is a dashboard you talk to and glance at, not one you sit and
read. Everything downstream of that — the terse voice register, the ambient
alert behaviour, the panel-at-a-glance layout — follows from it.

---

## 2. Constraints

| | |
|---|---|
| Display | 1280×720 fixed, 9-inch (~163 PPI). No responsive breakpoints. Design to the pixel. |
| Kiosk host | Intel NUC6i7KYK "Skull Canyon" — i7-6770HQ (4C/8T Skylake), 32 GB RAM, Iris Pro 580, Thunderbolt 3 |
| OS | Ubuntu Server 26.04 LTS + `cage` Wayland kiosk compositor |
| Inference | CPU-first on the NUC. GPU is a later swarm-node decision, not a kiosk one. |
| Network | LAN only. No cloud APIs in the runtime path. |
| Licensing | Fork is AGPL-3.0. Combined GPL-3.0 assets are compatible. |
| Existing infra | Two Docker Swarms, Harbor registry at compute-node-01, QNAP NAS |

**Non-goals.** Multi-user support. Public deployment. Mobile-responsive layout
(except the PADD view in P4). Commercial licensing.

---

## 3. Architecture

Four layers, added as new directories so upstream merges stay cheap.

```
┌─────────────────────────────────────────────────┐
│  Browser (Chromium kiosk, 1280×720)             │
│  ┌───────────────┐  ┌────────────────────────┐  │
│  │ Theme engine  │  │ Upstream dashboard     │  │
│  │ tokens/chrome │→ │ panels, globe, feeds   │  │
│  └───────────────┘  └────────────────────────┘  │
│         ↑                      ↓                │
│    wm:action bus  ←──── context snapshot        │
└─────────┼──────────────────────┼────────────────┘
          │ WebSocket            │ HTTP
┌─────────┴──────────────────────┴────────────────┐
│  Voice sidecar (container, native audio)        │
│  openWakeWord → faster-whisper → Ollama → TTS   │
└─────────────────────────────────────────────────┘
```

Two decisions carry most of the design:

**The audio loop runs natively in the sidecar, not through the browser.** Kiosk
Chromium makes microphone permissions painful and adds nothing. The frontend
receives WebSocket events for UI state only.

**The LLM reads a structured context snapshot, never the DOM.** Scraping
rendered markup would couple the voice layer to upstream's HTML and break on
every merge.

### 3.1 Relationship to upstream's own variant theming

Upstream ships a token-theme mechanism of its own: a prepaint inline script in
`index.html` stamps `data-variant` and `data-theme` onto the root element before
first paint, per-variant stylesheets override custom properties on
`:root[data-variant="..."]`, and the choice persists in
`localStorage['worldmonitor-variant']`.

**Our engine is deliberately independent of it.** That system is token-only, so
it cannot express LCARS's structural chrome; and its variant list is a closed
enum in `src/config/variant.ts` guarded by a drift test, because `/api/download`
consumes the same list. Adding a theme must not require editing that enum.

The cost is two theming mechanisms coexisting in one app. The benefit is that
upstream variant churn cannot break our themes, and our themes cannot break
`/api/download`. `default` participates in neither mechanism — it contributes
nothing to the cascade — so upstream's variants continue to work untouched.

---

## 4. Fork discipline

Upstream is 6,000+ commits and actively maintained. Merge cost is the primary
non-functional constraint on this project.

1. New code goes in new directories: `src/themes/`, `src/voice/`, `src/context/`.
2. Touch upstream files at a **maximum of three seams**, one or two lines each.
   P0 spends **two**:
   - app entry point calls `bootThemes()` — `src/main.ts`
   - shell root gets `data-wm-shell` — `index.html`
   - ~~panel hosts get `data-wm-panel`~~ — **not needed**; upstream already
     marks panels with `data-panel`, which the theme layer consumes instead
3. Never reformat, reorganize, or clean up an upstream file. A whitespace-only
   change to a file upstream also touches converts a clean merge into a manual one.
4. Before editing an upstream file, ask whether a DOM attribute hook plus code
   in our own directory would do instead. It usually will — this rule is what
   saved the third seam, and what avoided a fourth for chrome re-mounting.
5. Log every upstream file touched in `docs/UPSTREAM-DIFF.md`.

```bash
git remote add upstream https://github.com/koala73/worldmonitor.git
git fetch upstream
```

---

## 5. Phases

### P0 — Foundation `COMPLETE`

Prove the theme engine against a known-good baseline.

**Deliverables**

- Fork running locally, unmodified, at 1280×720 — done
- Kiosk profile: `cage` + Chromium, no scrollbars, no overflow, autostart unit —
  written (`deploy/kiosk/`), **not yet verified on hardware**
- Theme engine wired at the upstream seams — done, two seams
- `default` theme extracted from upstream CSS — done; it is an **identity
  theme** that declares nothing, and the extraction lives in
  `src/themes/tokens.ts` as a drift-checked reference (see `docs/P0-PORT.md`)
- Theme switching, persisted across reload — done, programmatic plus URL pin;
  the rail button is P1 because the rail is LCARS chrome

**Acceptance:** `default` renders unmodified upstream **pixel-for-pixel** under
screenshot diff. Twenty theme-cycle iterations leave the DOM structurally
identical to boot. **Both verified** — `e2e/theme-engine-p0.spec.ts`.

---

### P1 — LCARS theme

**Deliverables**

- Antonio self-hosted in `public/fonts/`, Google Fonts `@import` removed
- Sound assets integrated, wired to the theme's `sounds` slot
- ~~Rail buttons bound to real panel-focus actions~~ — done; they dispatch
  `panel.focus:<key>` on the `wm:action` bus, awaiting P3 handlers
- Upstream panels mapped into the 12-column content grid — **outstanding**
- Both palette variants selectable (see §7) — *shipped early as `lcars` and
  `lcars-bright`*

**Acceptance:** legible from 2.5 m. No text below 13px. No horizontal scroll.
Kiosk renders with zero network dependency for chrome.

**Notes.** The signature of LCARS is the 5px black gutter and full-pill outer
radius, not the exact hex values. Salmon `#cc6666` is alert-only — if it becomes
decorative the theme stops communicating. Full asset guidance in
`docs/LCARS-ASSETS.md`.

The frame itself is **built**: rail with working actions, header elbow, footer
voice indicator, and the dashboard re-parented into `[data-wm-content]`. It fits
1280x720 with no overflow in either direction.

What remains is the **12-column panel mapping**. The rail takes 104px and
upstream's header does not reflow, so its right-hand controls are clipped at
1280px — visible, and the single most obvious thing still wrong with the theme.

---

### P2 — Voice, read-only

**Deliverables**

- Sidecar container: openWakeWord → faster-whisper (`small.en`, int8) → Ollama → TTS
- Wake word plus push-to-talk via the rail `LISTEN` button
- WebSocket channel to frontend for `idle` / `listening` / `speaking` and live transcript
- Voice character layer: phrasing validator, prosody tuning, signal chain
  (`docs/VOICE-CHARACTER.md`)
- Wake chirp fires on detection, before STT completes

**Acceptance:** end-to-end latency from end-of-speech to first audio under 3 s on
CPU. Wake word survives the assistant's own TTS playback (validates AEC). No
false wake in 24 h of normal room noise.

**Notes.** Build the phrasing layer first and test with any default voice — if
the words are right it reads as the ship's computer before any audio tuning.
Measure on CPU before making a GPU decision.

---

### P3 — Commands

**Deliverables**

- `src/context/` — structured snapshot of panel state
- Snapshot exposed as Ollama tool definitions
- Commands returned as actions on the existing `wm:action` bus
- Action schema shared between rail buttons and voice, single source of truth

**Acceptance:** every rail button action is also reachable by voice. Tool schema
is generated from the action registry, not maintained separately.

**Notes.** Action strings are `namespace.verb` (`theme.set`, `voice.ptt`,
`panel.focus`). Keep them in one place — the voice tool schema derives from it.
The P0 rail already carries `data-wm-action` attributes in this form, and
`bootThemes()` already handles `theme.cycle` and `theme.set` on that bus, and
the rail's DISPLAY button dispatches through it — so rail and voice resolve to
one code path today.

The context snapshot reads `[data-panel]` — upstream's own attribute, whose
value is the panel key. That is what lets the snapshot name a panel to the LLM
without a parallel registry.

---

## 6. P4 — Stretch features

Ten candidates, ordered by value per unit of effort. Not a commitment; a menu.

| # | Feature | Size | Depends on |
|---|---|---|---|
| 1 | Proactive alert state | M | P3 |
| 2 | Scheduled spoken briefing | S | P2 |
| 3 | Presence-aware attract mode | S | P1 + sensor |
| 4 | Conversational follow-up | S | P3 |
| 5 | Voice-driven map control | M | P3 |
| 6 | Panel focus brackets | S | P3 |
| 7 | Home lab telemetry panel | M | P0 |
| 8 | PADD companion view | M | P1 |
| 9 | Historical time-scrub | L | P0 |
| 10 | Second theme | M | P0 |

**1. Proactive alert state**

When CII crosses a threshold or an escalation signal fires, the dashboard
asserts itself: theme shifts to alert state, `deny_beep`-family alert tone
plays, assistant speaks unprompted — "Alert. Instability index for Sudan has
risen to eighty-seven."

This is the feature that changes what the product *is*. A dashboard you have to
look at competes with everything else in the room. One that speaks when
something changes is a monitor in the real sense. LCARS red alert is canonical,
so the visual language already exists.

Needs a debounce and a quiet-hours window, or it becomes wallpaper you learn to
ignore. Thresholds must be user-editable.

*The visual half of this already has its hook:
`:root[data-wm-theme="lcars"][data-wm-alert="true"]` in `lcars.css`.*

**2. Scheduled spoken briefing**

"Computer, morning briefing." Sixty to ninety seconds synthesizing overnight
changes across feeds, CII movement, and market composite. Also fires on a
schedule if presence is detected.

Cheapest high-value voice feature in the list — it's a prompt and a cron entry
on top of the P2/P3 machinery. Length discipline matters more than content
breadth; ninety seconds is the ceiling before it stops being a briefing.

**3. Presence-aware attract mode**

LD2410 mmWave sensor on USB serial. No one present: dim to a low-power ambient
layout. On approach: wake with the LCARS boot sequence.

Protects the panel from burn-in, cuts idle power, and the boot sequence is the
single best signature moment the theme affords. mmWave over a camera — works in
the dark, no inference, and no always-on lens in living space.

**4. Conversational follow-up**

"What about Myanmar?" after asking about Sudan. Short-lived session context in
the sidecar, expiring after ~2 minutes of silence.

Small, but it's the difference between a command line you speak at and something
you converse with. Expiry matters: stale context produces confidently wrong
answers about the wrong subject.

**5. Voice-driven map control**

"Computer, show me the Red Sea." Globe flies to coordinates. "Overlay shipping
lanes." "Rotate to the Pacific."

The best demonstration of the whole system, and it exercises upstream's dual map
engine rather than working around it. Needs a gazetteer mapping place names to
coordinates and zoom levels — build it as data, not as model knowledge, so it's
deterministic.

**6. Panel focus brackets**

When the assistant answers about a panel, bracket it using
`bracket-top-left.svg` from the reviewed assets. Corner brackets rather than a
border highlight — reads as instrumentation, not a CSS focus ring.

Solves a real problem: with six panels and a spoken answer, the user doesn't
know which numbers were just described. Cheap, and it makes the voice layer feel
integrated rather than bolted on.

**7. Home lab telemetry panel**

Swarm node health, Harbor registry status, NAS capacity, *arr stack state,
surfaced as a native panel and queryable by voice. "Computer, status of the
compute swarm."

Turns this from a news dashboard into the actual computer for the lab, which is
the version most likely to earn its wall space long-term. Data sources already
exist; the work is a collector and a panel.

**8. PADD companion view**

A phone-sized LCARS layout served from the same instance, so a phone becomes a
PADD that controls the wall panel — push a region to the globe, trigger a
briefing, acknowledge an alert.

The theme engine already separates tokens from chrome, so this is a second
chrome variant rather than a second app. Also the natural home for anything that
needs text entry, which a wall panel is bad at.

**9. Historical time-scrub**

Persist panel snapshots; scrub back through them. "Computer, show CII over the
last thirty days."

The largest item here — it needs a storage layer, a retention policy, and
snapshot schema versioning that survives upstream panel changes. But LCARS is
full of scrubbers and sliders, so the interaction language fits, and it's the
difference between a live readout and something you can reason about. Defer
until the panel set is stable.

**10. Second theme**

Something with a genuinely different structural language, not a recolor —
a green-phosphor CRT terminal in the MU-TH-UR / Nostromo register is the
obvious foil to LCARS: monospace, scanlines, no chrome, everything in one
column.

The engine's whole justification is supporting more than one theme; until a
second exists with real structural differences, we don't know whether the
chrome abstraction holds. Treat this as a test of the architecture as much as a
feature.

---

## 7. Asset register

Full review in `docs/LCARS-ASSETS.md`. Summary:

**Take** — UI sounds ×6 (P1), Drexler palette (**done**), corner bracket (P4-6),
CSS techniques (**partly done**).

**Skip** — Vue components, `index.css` wholesale, planet textures, Helvetica LT
Std Ultra Compressed (**commercial font, do not ship**), Trek fiction props,
numeral SVGs.

**Palette variants.** Both ship as `lcars` (Drexler, screen-accurate) and
`lcars-bright` (higher contrast). Which one is right is a **hardware test**, not
a taste decision — legibility at 2.5 m on a 163-PPI panel. Select with
`WM_KIOSK_THEME`.

**Typography.** Antonio (OFL), self-hosted, behind a single token so a licensed
Helvetica LT Std swap is one line.

**Voice assets.** No cloned voices — see `docs/VOICE-CHARACTER.md`. Kokoro 82M
(Apache-2.0) default, Piper (MIT) fallback, faster-whisper `small.en` int8
(MIT), openWakeWord (Apache-2.0), Ollama 3–7B tool-calling.

---

## 8. Bill of materials

| Item | Notes | Est. |
|---|---|---|
| Intel NUC6i7KYK | Owned | — |
| 9" 1280×720 panel | To source | ~$60–90 |
| **Audio: pick one** | | |
| → Jabra Speak 410 / 510, used | USB, class-compliant, genuine full-duplex UC-grade AEC. **Recommended.** | ~$25–45 |
| → ReSpeaker Mic Array v2.0 + powered speaker | 4-mic array, beamforming, DOA; 3.5mm out lets AEC reference an external speaker | ~$80 + speaker |
| → Anker PowerConf S3 | Known-good fallback | ~$70 |
| LD2410 mmWave sensor + USB serial | P4 presence detection | ~$8 |
| GPU | **Deferred.** Measure P2 on CPU first. If needed: used RTX 3060 12 GB in a swarm node, not an eGPU on the kiosk. | $150–220 |

**Rejected:** Monster SD100. Bluetooth/aux only — the mic path forces HFP, which
collapses both directions to narrowband mono, and a soundbar has no AEC at all.
Category mismatch, not a quality problem.

**Audio acceptance test**, whatever is chosen: play a long TTS response and say
the wake word over the top. Responds = real full-duplex AEC. Ignores you until
playback ends = ducking, unusable for always-on voice.

---

## 9. Software stack

| Layer | Choice | Licence |
|---|---|---|
| OS | Ubuntu Server 26.04 LTS (supported to Apr 2031) | — |
| Kiosk | `cage` Wayland compositor + Chromium `--kiosk` | MIT / BSD |
| Audio | PipeWire + WirePlumber | MIT |
| Containers | Docker (matches existing swarm tooling) | Apache-2.0 |
| Frontend | Vanilla TS + Vite (upstream's stack — do not add a framework) | — |
| LLM runtime | Ollama | MIT |

Server rather than Desktop, then `cage`. Ubuntu Desktop with the panel hidden is
the common approach and is strictly worse — more surface area, more update churn,
more things that can steal focus at 3am.

---

## 10. Licence obligations

| Source | Licence | Obligation |
|---|---|---|
| worldmonitor | AGPL-3.0 | Fork stays AGPL. LAN self-hosting imposes nothing further. |
| louh/lcars | GPL-3.0 | Compatible via AGPLv3 §13. Attribute; combined work is AGPL. |
| Antonio | OFL | Retain licence file. |
| Kokoro, openWakeWord | Apache-2.0 | Retain notices. |
| Piper, faster-whisper, Chatterbox | MIT | Retain notices. |

**Do not ship:** Helvetica LT Std Ultra Compressed. **Do not distribute
publicly without replacing:** the `.ogg` sound assets.

Star Trek and LCARS are Paramount IP. Personal self-hosted use is ordinary fan
territory; public distribution of an LCARS-branded product is a different
question and outside this scope.

---

## 11. Risks

| Risk | Impact | Mitigation | State |
|---|---|---|---|
| Upstream merge divergence | High | §4 fork discipline; `UPSTREAM-DIFF.md` | 2 files, 3 insertions, 1 deletion |
| Audio device lacks real AEC | High | §8 acceptance test before committing | Open |
| CPU inference too slow | Medium | Measure at P2; GPU in a swarm node, not an eGPU | Open |
| Muted palette illegible at distance | Medium | Ship both variants; decide on hardware | Both ship |
| Upstream panel churn breaks context schema | Medium | Version the snapshot schema; defer P4-9 until panels stabilise | Open |
| Upstream retunes a token our extraction records | Medium | Drift test compares `tokens.ts` against `main.css` on every run | Covered |
| Proactive alerts become ignorable | Medium | Debounce, quiet hours, user-editable thresholds | Open |
| NUC fan noise in living space | Low | Offload inference; measure under sustained load | Open |

---

## 12. Document index

| Doc | Contents |
|---|---|
| `docs/WORKING-BRIEF.md` | Working brief — conventions, fork rules, phase summary. Tracked here because upstream's `.gitignore` ignores a root `CLAUDE.md`. |
| `docs/P0-PORT.md` | Default-theme extraction procedure and verification |
| `docs/LCARS-ASSETS.md` | Full `louh/lcars` review, take/skip with rationale |
| `docs/VOICE-CHARACTER.md` | Phrasing table, prosody tuning, ffmpeg chain, engine comparison |
| `docs/UPSTREAM-DIFF.md` | Every upstream file touched, and why |
| `deploy/kiosk/README.md` | Kiosk install and operational notes |
| `preview/lcars-preview.html` | Standalone 1280x720 mock for the on-panel palette test |
| `SCOPE.md` | This document |
