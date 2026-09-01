# Kiosk deployment

> **Unverified on hardware.** The profile in `deploy/kiosk/` is written and
> reviewed, but the panel has not been sourced. Treat every number here as an
> intention until someone runs it.

---

## Target

| | |
|---|---|
| Display | 9-inch, 1280×720, wall-mounted, always on |
| Compute | Intel NUC6i7KYK (Skylake, 4 physical cores, ~34 GB/s memory bandwidth) |
| OS | Ubuntu Server — no desktop environment |
| Compositor | `cage` (a kiosk Wayland compositor) running Chromium |
| Network | LAN only. Nothing in the runtime path leaves the machine |

`cage` rather than a full desktop: it runs exactly one application fullscreen,
with no panel, no launcher and nothing to accidentally exit into.

---

## Layout

```
deploy/kiosk/
├── README.md              install and operational notes
├── wm-kiosk-launch.sh     cage + Chromium, with the kiosk flags
├── wm-kiosk.service       systemd unit: restart policy, boot ordering
└── wm-kiosk.env.example   the knobs, to copy and edit
```

Read [`deploy/kiosk/README.md`](https://github.com/mtaylor45/worldmonitor/blob/main/deploy/kiosk/README.md)
for the actual commands — this page is the reasoning around them.

---

## Why the browser does not own the audio

Capture, wake word, recognition and synthesis all live in the sidecar, not the
page:

- Kiosk Chromium makes microphone permissions painful.
- The browser adds nothing to that path.
- A sidecar keeps voice alive **across a dashboard reload**, which matters on a
  display that reloads itself.

`src/voice/` only renders state.

---

## The sidecar container

```bash
docker compose -f voice-sidecar/docker-compose.yml up -d
```

Two things in that file are load-bearing:

- `--device /dev/snd` — the container needs real audio devices.
- Host networking — the dashboard, the model server and the sidecar are all on
  the same machine, and bridging them adds a hop for no isolation benefit on a
  single-user LAN appliance.

---

## Burn-in

An always-on panel in living space pays for ambient motion every hour of the
day. The theme kills transitions inside the frame explicitly, and the **only**
motion permitted to run unattended is the alert pulse — and only while the
condition holds.

`prefers-reduced-motion` stops even that, dropping to a solid critical red.

Presence-aware attract mode (dim when nobody is present, wake on approach) is a
P4 candidate and would help further. It needs an LD2410 mmWave sensor — mmWave
over a camera, because it works in the dark, needs no inference, and puts no
always-on lens in living space.

---

## What must be measured on the panel

| | Why it cannot be simulated |
|---|---|
| Palette choice | It is a legibility test at 2.5 m. Open `preview/lcars-preview.html` on the panel and toggle |
| The cap-height factor | The 1.36 token is calibrated for Swiss 911; Antonio has different vertical metrics. Recorded, not yet applied |
| Voice latency | `bench_latency.py` on the NUC, not on a workstation |
| AEC behaviour | Depends entirely on the audio hardware |
| Long-duration stability | Days, not minutes |
