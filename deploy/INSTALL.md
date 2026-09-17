# Installation and first light

Bench runbook for the two-display LCARS World Monitor kiosk. Written for a
weekend with the hardware on the table and nothing installed yet.

Read **§0 before you start** — two of those checks decide whether the rest of
the weekend is assembly or shopping.

Nothing in this file has been run on real hardware. It is derived from the
units, scripts and Makefile in this directory, which are tested only insofar as
shell and systemd syntax can be. Expect to correct it as you go, and correct
*it* rather than only your shell history.

---

## 0 · Before you plug anything in

| Check | Why it decides the weekend |
|---|---|
| **Both panels report EDID at their native mode** — `1280x400` and `1424x280` | Odd-resolution industrial LCDs often present a generic mode. If a panel will not do its native timing, the whole layout is wrong and no software fixes it |
| **The NUC has two usable outputs** for those panels | NUC6i7KYK has HDMI 2.0 + mini-DP + Thunderbolt 3. Two simultaneous outputs is fine; the adapters are where this goes wrong |
| **The audio device does full-duplex** | See §7. This decides whether the wake word can be used while the assistant speaks, and it is a property of the hardware, not a setting |
| **Each touchscreen enumerates separately** | Two panels reporting as one device cannot be mapped per-output, and touch lands on the wrong screen |

Do §0 with a live USB and `swaymsg -t get_outputs` before mounting anything.
Discovering a panel will not do 1424x280 *after* it is on a wall is the
expensive version.

---

## 1 · Base OS

Ubuntu Server 26.04 LTS. **Server, not Desktop** — a desktop session with the
panel hidden has more surface area, more update churn, and more things that can
steal focus at 3am (`SCOPE.md` §9).

```bash
sudo apt update && sudo apt install -y \
    sway chromium curl git build-essential \
    pipewire pipewire-pulse wireplumber \
    ffmpeg python3-venv python3-pip

# Node 22. Ubuntu's packaged node is older than this build wants.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # expect v22.x
```

`sway` rather than `cage`: cage runs exactly one fullscreen client by design,
which is right for one panel and cannot place a second window on a second
output. Sway still has no desktop, no launcher, and nothing that can steal
focus.

---

## 2 · Identify the hardware

**Do this before installing anything else.** Every value below is
machine-specific, and the two-display unit refuses to start without the output
names rather than coming up with the panels swapped.

```bash
# Start a throwaway sway session on the console to enumerate:
sway

# In a terminal inside it:
swaymsg -t get_outputs | grep -E '"name"|"model"|"current_mode"'
swaymsg -t get_inputs  | grep -E '"identifier"|"name"|"type"'
```

Write down, and keep them somewhere other than your shell history:

| | Example | Yours |
|---|---|---|
| 2U dashboard output | `HDMI-A-1` | |
| 1U console output | `DP-2` | |
| Dashboard touchscreen identifier | `1234:5678:ILITEK...` | |
| Console touchscreen identifier | `1234:9012:ILITEK...` | |

**Touch mapping is the single most common thing to get wrong.** An unmapped
touchscreen reports in whole-layout coordinates, so a touch on the lower panel
lands on the upper one. If touch is off by a consistent offset later, it is
this.

---

## 3 · The dashboard server

```bash
sudo mkdir -p /opt/worldmonitor
sudo git clone https://github.com/mtaylor45/worldmonitor.git /opt/worldmonitor

sudo make -C /opt/worldmonitor/deploy dashboard   # creates the `wm` user
sudo chown -R wm:wm /opt/worldmonitor
sudo -u wm npm --prefix /opt/worldmonitor ci

sudo systemctl enable --now wm-dashboard.service
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/   # expect 200
```

**No API keys are required.** `.env.example` says it plainly — every key is
optional and the dashboard works without them, with the corresponding feeds
disabled. Expect warnings in the journal about ACLED, Redis and digest
freshness; those are features degrading, not the panel failing. Add keys later
from `.env.example` into `/opt/worldmonitor/.env.local` if a panel you care
about is thin.

Two things worth knowing about this service:

- **It runs `vite dev`, not a static build, and that is deliberate.** Upstream
  serves its 92 API routes through dev-server plugins — the same handler
  pipeline the hosted deployment runs. A static build of the client would paint
  the frame and then fail every fetch behind it.
- **Port 3000, not 5173.** This repo's `vite.config.ts` defaults to 3000, and
  the sidecar's `WM_API_URL` points at the same place. The dashboard and its
  API are one process on one port.

---

## 4 · Model weights

```bash
make -C /opt/worldmonitor/deploy models
```

Fetches the Qwen3 8B GGUF and the Piper voice, verifying each against a sha256
read from Hugging Face's own API — so it checks the upstream artefact, not
whatever arrived. A hash mismatch is refused rather than silently re-fetched.

About 5 GB. Do it on wired ethernet and before you need it.

**Two things are deliberately not fetched:**

- **Kokoro** downloads its own weights on first synthesis.
- **The "Computer" wake model does not exist yet.** openWakeWord ships no
  pretrained model for that word — see §8. Until you train one,
  `WM_WAKE_MODEL` stays empty and the sidecar says so at startup; push-to-talk
  works regardless.

---

## 5 · Voice sidecar

```bash
sudo usermod -aG audio wm          # /dev/snd access
make -C /opt/worldmonitor/deploy up
make -C /opt/worldmonitor/deploy doctor
```

`doctor` is the point of this step. Six probes — audio device, wake model,
speech engine, model server, dashboard API, alert rules — each naming a
**remedy** rather than a verdict, and exiting non-zero on failure so it can
gate the rest of the build. Every dependency this sidecar has fails silently
otherwise.

Expect on a first run:

```
[ warn ] wake word     no model configured; push-to-talk only
```

That is correct and not a problem yet. A `FAIL` on the audio device or the
model server is a problem, and the remedy line says which.

**The model server will take a few minutes to load 5 GB on first start.** Run
`doctor` again rather than concluding it is broken.

---

## 6 · The two displays

```bash
sudo make -C /opt/worldmonitor/deploy kiosk-dual
sudoedit /etc/default/wm-kiosk
```

Set, from §2:

```ini
WM_KIOSK_URL=http://localhost:3000/
WM_APP_DIR=/opt/worldmonitor
WM_KIOSK_THEME=lcars

WM_KIOSK_OUT_DASHBOARD=HDMI-A-1
WM_KIOSK_OUT_NAV=DP-2
WM_KIOSK_TOUCH_DASHBOARD=1234:5678:ILITEK...
WM_KIOSK_TOUCH_NAV=1234:9012:ILITEK...
```

```bash
sudo systemctl enable --now wm-kiosk-dual.service
journalctl -u wm-kiosk-dual -f
```

**Enable only one kiosk unit.** `wm-kiosk.service` (single display, cage) and
`wm-kiosk-dual.service` (two displays, sway) both want the screens and will
fight. The dual unit declares `Conflicts=` for this reason.

The launch script waits up to two minutes for the dashboard before opening
Chromium: the browser caches the error page it lands on, and a wall panel has
nobody to press reload.

### What you should see

| Panel | |
|---|---|
| 2U, 1280×400 | LCARS frame, elbow top-left, map filling the well, Live News right, voice tag bottom-right. No rail — navigation is on the other panel |
| 1U, 1424×280 | Cap reading LCARS, five page buttons with **OPS bright and the rest dimmed**, six map-layer buttons, GLOBE / LISTEN / DISPLAY, STANDING BY |

### First things to try

1. **Touch a page button** — the dashboard should change page. If the console
   lights but the dashboard does not move, the two windows are not sharing a
   `BroadcastChannel`: check both are the same origin under one Chromium
   profile.
2. **Touch a layer button** — the map layer toggles and the console button
   brightens or dims to match. This is the round trip working.
3. **Touch the wrong panel on purpose.** If a touch near the bottom of the 2U
   panel activates the console, the touch mapping is wrong — §2.

---

## 7 · The acceptance tests that need the hardware

These are why the weekend exists. Everything above is assembly; this is
measurement, and none of it can be done anywhere else.

### 7.1 Palette, at distance

Open `preview/lcars-preview.html` on the panel and stand where you will
actually stand — 2.5 m.

```
?wm-theme=lcars          Drexler, muted, screen-accurate
?wm-theme=lcars-bright   higher contrast
```

Pick one. It is a legibility test, not a taste test, and it has been waiting
for a panel since P1.

### 7.2 Voice latency

```bash
cd /opt/worldmonitor/voice-sidecar && python3 bench_latency.py --runs 20
```

Reports median, p95, worst and per-stage medians, exiting non-zero if a turn
misses budget. **Expect the LLM stage to dominate; if it does not, that finding
is more interesting than the total.**

Tier 0 commands ("show the map", "focus markets") should answer in under a
second with no model at all. A question takes 8–12 s and is *supposed* to — at
~4 tok/s an 8B cannot do better, and the tier table in
`voice-sidecar/README.md` explains why the budget is split rather than
pretended at.

### 7.3 Echo cancellation — the one that decides the audio hardware

Play a long response and say the wake word over the top.

| | Means |
|---|---|
| It responds | Real full-duplex AEC. Leave `WM_WAKE_DURING_PLAYBACK=1` |
| It ignores you until playback ends | The device ducks rather than cancels. It is the wrong category (`SCOPE.md` §8). Set `WM_WAKE_DURING_PLAYBACK=0` and lose interruptibility, or change the hardware |

Do this before mounting the microphone permanently.

### 7.4 Twenty-four hours of room noise

Leave it running a full day with a trained wake model and count the wakes
nobody asked for. Then move **one** number:

1. `WM_WAKE_CONSECUTIVE` 2 → 3 first — it removes single-frame spikes, which
   is what most false accepts are, and costs the least recall.
2. Then `WM_WAKE_THRESHOLD` up in steps of 0.05.
3. `WM_WAKE_REFRACTORY` only affects double-fires from one utterance.

Raising the threshold because a demo misfired once is how a wake word ends up
at 0.95 and unusable.

---

## 8 · Training the "Computer" wake model

Not on the critical path for first light — push-to-talk works without it — but
it is the longest-lead item, so start it Saturday and let it run.

```bash
pip install openwakeword[training]
python -m openwakeword.train \
    --target_word "computer" \
    --model_name computer \
    --n_samples 30000 \
    --output_dir ./wake-models
```

Two things that cost nothing now and a retraining run later:

- **Include negatives containing the word in running sentences.** "Computer" is
  a single common word, so false accepts are the design problem, not misses,
  and that is what teaches the model the difference between an address and a
  mention.
- **Record fifty positives in the actual room** and hold them back as a test
  set. Synthetic speech trains well and evaluates badly; the room's
  reverberation is what the panel actually hears.

Then set `WM_WAKE_MODEL` to the exported `.onnx`, restart the sidecar, and
confirm with `doctor` that it reports `armed` rather than `no model
configured`.

---

## 9 · When something is wrong

`make -C /opt/worldmonitor/deploy doctor` first — it covers most of this and
names a remedy. Then:

| Symptom | Look at |
|---|---|
| Panels swapped | `WM_KIOSK_OUT_*` in `/etc/default/wm-kiosk` |
| Touch lands on the other panel | `WM_KIOSK_TOUCH_*` unset or wrong — §2 |
| Chromium shows connection refused | `systemctl status wm-dashboard`; exit 78 means no `node_modules` |
| Console buttons do nothing on the dashboard | Two Chromium profiles, so no shared `BroadcastChannel` |
| Frame missing, plain dashboard | `WM_KIOSK_THEME` is `default`, the identity theme. That is also the deliberate escape hatch: `default` restores upstream exactly, including the settings gear the LCARS theme hides |
| No voice at all | `make -C deploy logs`; a dead model server is a failed turn, not a crashed sidecar |
| Alerts never fire | `doctor` checks the API *shape*, not just reachability — readings that no longer parse read as a calm world |

**Getting back to upstream's own UI:** the LCARS theme hides upstream's header,
footer, Pro banner, tab bar and settings gear, so there is no on-panel route to
them. Append `?wm-theme=default` to the URL, or set `WM_KIOSK_THEME=default`
and restart the kiosk unit.

---

## 10 · What to write down

The things that only exist once you have measured them, and that this project
has been carrying as open questions:

- [ ] Which palette, and at what distance you judged it
- [ ] `bench_latency.py` output — median, p95, per-stage
- [ ] AEC verdict: cancels, or ducks
- [ ] False wakes in 24h, and which number you moved
- [ ] Output and touch identifiers, so a rebuild is not another §2
- [ ] Anything in this file that was wrong

The last one matters most. This runbook has never been executed.
