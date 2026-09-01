# LCARS World Monitor

A fork of [koala73/worldmonitor](https://github.com/koala73/worldmonitor) that
adds a selectable theme system with an LCARS theme, and a local voice assistant,
running as an always-on kiosk on a 9-inch 1280×720 panel.

Everything runs on the LAN. No cloud AI service is in the runtime path.

---

## Start here

| If you want to… | Read |
|---|---|
| Understand the whole plan | [`SCOPE.md`](https://github.com/mtaylor45/worldmonitor/blob/main/SCOPE.md) — the authoritative roadmap |
| Change any code | [Fork Rules](Fork-Rules) first, then [`docs/WORKING-BRIEF.md`](https://github.com/mtaylor45/worldmonitor/blob/main/docs/WORKING-BRIEF.md) |
| Change how it looks | [`docs/DESIGN-SYSTEM.md`](https://github.com/mtaylor45/worldmonitor/blob/main/docs/DESIGN-SYSTEM.md), and open `preview/lcars-style-guide.html` |
| Configure the sidecar | [Configuration](Configuration) |
| Get the wake word working | [Wake Word](Wake-Word) |
| Tune the alerts | [Proactive Alerts](Proactive-Alerts) |
| Merge upstream | [Upstream Merges](Upstream-Merges) |
| Work out why something is broken | [Troubleshooting](Troubleshooting) |

---

## The shape of it

```text
┌─ upstream World Monitor ──────────────────────────────────────┐
│  vanilla TypeScript + Vite. Untouched except two lines.       │
└───────────────────────────────────────────────────────────────┘
        ▲                                    ▲
        │ data-panel, data-wm-shell          │ data-wm-theme, data-wm-alert
        │ (attributes we read)               │ (attributes we write)
┌───────┴────────────────────────────────────┴──────────────────┐
│  src/themes/    engine, tokens, chrome, actions, sounds       │
│  src/voice/     WebSocket client, indicator, transcript       │
│  src/context/   structured dashboard state for the model      │
│  src/alert/     the data-wm-alert attribute and its tone      │
│  src/boot.ts    composition root — the one thing upstream calls│
└───────────────────────────────────────────────────────────────┘
        ▲ WebSocket (localhost:8765)
┌───────┴───────────────────────────────────────────────────────┐
│  voice-sidecar/   audio · wake · STT · LLM · alerts · TTS     │
└───────────────────────────────────────────────────────────────┘
```

**The whole merge strategy is that our code lives in new directories.** Two
upstream files are touched, by three lines total. See [Fork Rules](Fork-Rules).

---

## Status

| Phase | State | What is left |
|---|---|---|
| **P0** Theme engine | ✅ Complete, verified | — |
| **P1** LCARS theme | ✅ Complete, verified | — |
| **P2** Voice, read-only | 🟡 Built and tested | Three hardware measurements |
| **P3** Voice commands | 🟡 Built and tested | Same hardware, plus map control |
| **P4-1** Proactive alerts | 🟡 Built and tested | Threshold calibration |

**Nothing on that list is a missing feature.** Each open item is a number that
can only be taken off the physical panel, in the room it lives in:

- Sub-3-second voice latency on the NUC's CPU
- The wake word surviving the assistant's own TTS playback (the AEC test)
- No false wake in 24 hours of room noise
- A trained "Computer" wake model — a training run, not code
- Alert thresholds worth trusting — a week of real readings
- The palette choice, at 2.5 m, on the actual panel

---

## Verification

```bash
npx vitest run --config vitest.dom.config.mts     # 815 tests, 95 files
npx playwright test e2e/theme-engine-p0.spec.ts   # 36 tests
cd voice-sidecar && python3 -m unittest discover -s tests -t .   # 207 tests
```

See [Testing](Testing) for what each suite is actually protecting, and for the
two traps that cost real time when writing tests against this dashboard.
