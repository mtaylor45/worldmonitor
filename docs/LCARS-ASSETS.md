# LCARS asset review — `louh/lcars`

Take/skip decisions with rationale, per SCOPE.md §7.1.

**Source:** [`louh/lcars`](https://github.com/louh/lcars), GPL-3.0.
**Compatibility:** GPL-3.0 combines with this fork's AGPL-3.0 via AGPLv3 §13.
The combined work is AGPL. Attribution is required on every lifted file and in
`docs/UPSTREAM-DIFF.md`.

---

## Take

| Asset | Path | Size | Use | Status |
|---|---|---|---|---|
| UI sounds x6 | `public/sounds/*.ogg` | 140 KB | Wake ack, command accepted, refusal, alert | P1 |
| Drexler palette | `src/styles/index.css` | — | Palette variant A | **Done** — `src/themes/lcars/tokens.ts` |
| Corner bracket | `src/bracket-top-left.svg` | 1 KB | Focus indicator | P4-6 |
| Random code utils | `src/utils/index.ts` | — | Ornamental filler only | Optional |
| CSS techniques | various | — | See below | **Partly done** |

### Sound mapping

Characters are documented in the source repo's `src/utils/sounds.ts`.

| File | Character | Our use |
|---|---|---|
| `panel_beep_07.ogg` | single tap | wake word acknowledged |
| `panel_beep_14.ogg` | two beeps, short gap | command accepted |
| `panel_beep_03.ogg` | three quick beeps | panel / theme change |
| `deny_beep_01.ogg` | rejection | not understood, action refused |
| `panel_beep_08.ogg`, `panel_beep_13.ogg` | general | spare, alert candidates |

Play at volume 0.15–0.2; the raw files are loud. Six preloaded `Audio` objects
is the whole implementation — Howler is not worth its weight for this.

The slots are already declared in `src/themes/lcars/index.ts` so the mapping is
reviewable before the files land.

> **Provenance caveat.** The origin of these files is unstated in the source
> repo and they are likely show-sourced. Acceptable for a personal LAN kiosk.
> **Must be replaced before any public distribution.**

### Palette variants

Both ship. Which one is right is a **hardware test, not a taste decision** —
the question is legibility at 2.5 m on a 163-PPI panel, and it cannot be
settled before the panel exists.

- **Variant A — Drexler** (`lcars`): `#ec943a #eb9870 #c47d69 #d29a7f #faa41b
  #c082a9 #9c698a #b6a5d1 #8b72aa`, ground `#090909`. Attributed in the source
  repo to a Star Trek scenic artist; screen-accurate, muted.
- **Variant B — bright** (`lcars-bright`): `#ffcc66 #cc99cc #99ccff #ff9933
  #ffff99`. Matches the reference screenshot; higher contrast.

Switch between them with `WM_KIOSK_THEME` in `/etc/default/wm-kiosk`.

Salmon `#cc6666` sits in **neither** ramp. It is alert-only, defined once as
`--lcars-alert`, and used by exactly one rule — the `[data-wm-alert="true"]`
block in `src/themes/lcars/lcars.css`. If it becomes decorative the theme stops
communicating, so keeping its sole legitimate use in the same file as the rule
that reserves it is deliberate.

### CSS techniques

| Technique | Status |
|---|---|
| Pill caps as `border-radius: 50%` on two corners, not `999px` | **Adopted.** Scales with row height; a fixed radius flattens as the block grows. |
| Cap-height matching via `font-size: calc(row-height * 1.36)` | **Adopted, factor unverified.** 1.36 is calibrated for Swiss 911. Antonio has different vertical metrics — P1 must re-measure against rendered text rather than inherit the number on faith. |
| `user-select: none` on body | **Adopted.** A kiosk panel is never selected from. |
| `font-display: block` on the face | P1, with the self-hosted Antonio. |
| Text `<span>` carries the *background* colour over a coloured bar, punching the label through it | **Not yet.** The authentic Okudagram look and the one technique our stylesheet most conspicuously lacks. The rail markup already puts labels in their own `<span>` so P1 can apply it without touching chrome structure. |

---

## Skip

| Asset | Reason |
|---|---|
| Vue components (86% of the repo) | We are vanilla TS, and upstream's stack is not negotiable (SCOPE.md §9). Read for technique, reimplement. |
| `src/styles/index.css` wholesale | Starts with `@import 'tailwindcss'`. Take the custom properties only. |
| `public/planets/`, `src/planets/` | 16 MB of solar-system textures. We have a globe. |
| `HelveticaLTStd-UltraComp.*` | **Commercial Monotype font, redistributed without apparent licence. Do not ship.** |
| StarChart, WarpField*, OmegaDirective, Transmission | Trek fiction props with no data to bind. A dashboard that displays invented readings is not a monitor. |
| `src/label/0-9.svg` | Unnecessary with a real font. |

---

## Typography

**Antonio** (Google Fonts, OFL) — the standard free substitute for Swiss 911
Ultra Compressed. Self-host in `public/fonts/`; no CDN, because the kiosk must
render its chrome with zero network dependency.

The family is behind a single token (`--font-body-base` in
`src/themes/lcars/tokens.ts`) so a swap is one line. That matters: Helvetica LT
Std Ultra Compressed is available through Adobe Fonts, and if it is separately
licensed it can be dropped in legitimately.

If Antonio sits wrong against block heights, adjust the **font's vertical
metrics**, not padding. Ultra-condensed faces are unusually sensitive here, and
padding fixes one row height and breaks every other.

---

## Licence obligations summary

| Source | Licence | Obligation |
|---|---|---|
| `koala73/worldmonitor` | AGPL-3.0 | Fork stays AGPL. LAN self-hosting imposes nothing further. |
| `louh/lcars` | GPL-3.0 | Attribute; combined work is AGPL. |
| Antonio | OFL | Retain licence file alongside the font. |

**Do not ship:** Helvetica LT Std Ultra Compressed.
**Do not distribute publicly without replacing:** the `.ogg` sound assets.

Star Trek and LCARS are Paramount IP. Personal self-hosted use is ordinary fan
territory; public distribution of an LCARS-branded product is a different
question and outside this project's scope.
