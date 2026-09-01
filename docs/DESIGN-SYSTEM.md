# LCARS design system — rules

Terse companion to `preview/lcars-style-guide.html`. The guide is the reference;
this is the checklist. Open the guide when a decision needs to be *seen*.

Both are in-repo and open straight off the filesystem — no build step, no
network. `preview/lcars-preview.html` is the third piece: the frame at exactly
1280x720 with a palette toggle, for the decision that can only be made on the
panel from across the room.

Conformance is asserted, not assumed: `e2e/theme-engine-p0.spec.ts` checks the
field lift, the elbow ratio and its carve, the type scale, square status tags,
the absence of transitions inside the frame, and that salmon and red appear
nowhere in the chrome at rest.

## Geometry

| Token | Value | Note |
|---|---|---|
| Gutter | **5px** | Absolute. Two coloured blocks never touch. |
| Elbow outer radius | 72px | |
| Elbow inner radius | 30px | |
| Elbow ratio | **2.40 : 1** | Ratio matters more than absolutes. Closer reads as a plain corner; wider reads as a bubble. |
| Rail width | 150px | 128px acceptable at 1280 if content is tight |
| Row height | 34px | |
| Pill radius | 999px | Outer frame corners only |
| Tag radius | **0** | Status tags stay rectangular |

Elbow construction: one block with `border-top-left-radius`, plus an `::after`
carrying the **field colour** and its own smaller radius to carve the inner
corner. No clip-path, no SVG.

Frame first, content second. The frame is drawn, then content fills what's left.

## Colour

Field is `#090909`, not pure black.

| Role | Hex | Rule |
|---|---|---|
| Frame spine | `#ff9c00` | Structural only |
| Nav blocks | `#ffcc66` | |
| Data blocks | `#9999ff` | |
| Secondary | `#cc99cc` | |
| Info / inert | `#99ccff` | |
| Neutral bar | `#ffeebb` | |
| Readouts | `#ffcc00` | Numeric values only |
| Header sweep | `#e8a87c` | |
| Nominal | `#99cc99` | Status |
| Warning | `#cc6666` | **Status only** |
| Critical | `#ff3300` | **Status only** |

On screen LCARS colour was decorative. Here it carries meaning. The one
non-negotiable: **salmon and red are status only.** Used as ornament, alerts
stop meaning anything.

**Drexler variant** (screen-accurate, muted, lower contrast):
`#ec943a #eb9870 #c47d69 #d29a7f #faa41b #c082a9 #9c698a #b6a5d1 #8b72aa`

Ship both. Decide on the panel, from across the room.

## Type

Antonio. One family. All capitals. No second face.

| Size | Role |
|---|---|
| 44px | Page title |
| 30px | Section heading |
| 26px | Readout |
| 17px | Body |
| 15px | Label (tracking `0.08em`) |
| 13px | Micro — **hard floor** at 163 PPI |

Cap height must equal block height: `font-size = row-height × 1.36`, verified
optically. Padding is not the fix.

## Components

- **Labelled bar** — the label *interrupts* the bar. Text block carries the
  field colour, punching a hole through it. Most reproductions miss this.
- **Rail button** — label bottom-right, code bottom-left, both on the block
  floor. Codes derived deterministically from the button id so they hold still.
- **Data row** — chip, value, bar. Length is the datum, colour is the threshold.
  Right cap is a full pill.
- **Meter** — segmented columns, flat tops, no gradient, no rounding. Lit cells.
- **Number dump** — texture only. Max four rows. Never where it could be
  mistaken for data.
- **Status tag** — square corners. The only rectangular element, which is why
  the eye finds it.
- **Pill button** — commits an action. Rails navigate, pills act. Max two per
  screen.
- **Interrupt tab** — short contrasting block breaking a long rail. An anchor
  point for the eye.

## Page archetypes

| Page | Signature | Frame |
|---|---|---|
| **OPS** | Balanced blocks, no dominant panel, alerts pinned bottom | Orange / tan |
| **LONG RANGE SCAN** | One panel fills the well, frame compresses | Peach / salmon, Drexler palette |
| **ENGINEERING** | Symmetric metered columns | Gold |
| **COMMS** | Uniform list rows, newest top | Lilac |
| **LIBRARY** | Dual rail, three dense columns | Peach / tan |

A page should be identifiable from the doorway before any label resolves. Frame
colour and block rhythm carry that, not content. Second rail is LIBRARY-only —
elsewhere it steals width the content needs.

## Motion

**LCARS cuts, it does not fade.** The originals were backlit physical panels; a
state change was a lamp switching. Four permitted kinds, each reporting
something:

1. **Block blink** — one block, hard cut, ~700ms. Channel activity. Never a cascade.
2. **Sweep** — linear fill, constant rate, no easing. Genuine progress only.
3. **Sequential reveal** — blocks light in order at ~40ms. Boot and ambient wake only.
4. **Alert pulse** — hard alternation ~1Hz. The only unattended motion, and only
   while the condition holds.

**Forbidden:** fades, easing curves, scale/translate transforms, hover
transitions on every block, skeleton shimmer. Anything implying a surface is
soft, elastic, or physical.

Honour `prefers-reduced-motion`. On an always-on panel in living space, ambient
motion is a cost paid every hour of the day.
