# Kiosk profile

Boots the dashboard fullscreen on the 9-inch 1280x720 panel with no scrollbars,
no overflow, and no way for another window to take the display.

| File | Purpose |
|---|---|
| `wm-kiosk.service` | systemd unit; runs `cage` as the whole session |
| `wm-kiosk-launch.sh` | Chromium flags; cage's single client |
| `wm-kiosk.env.example` | Copy to `/etc/default/wm-kiosk` |

## Install

```bash
sudo useradd -r -m -d /var/lib/wm-kiosk -s /usr/sbin/nologin kiosk
sudo apt install cage chromium
sudo cp deploy/kiosk/wm-kiosk.service /etc/systemd/system/
sudo cp deploy/kiosk/wm-kiosk-launch.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/wm-kiosk-launch.sh
sudo cp deploy/kiosk/wm-kiosk.env.example /etc/default/wm-kiosk
sudo systemctl daemon-reload
sudo systemctl enable --now wm-kiosk.service
```

## Notes

- **`XDG_RUNTIME_DIR` assumes uid 1000.** If the `kiosk` user gets a different
  uid, correct the path in the unit or the Wayland socket will not be found.
- **The theme is pinned in the URL**, not left to `localStorage`. A wall panel
  has no keyboard, so a wedged persisted theme would otherwise need a
  screwdriver to recover. The pin deliberately does not write back to storage.
- **`Restart=always` with `StartLimitIntervalSec=0`.** An unattended panel that
  has been failing all night should still be retrying in the morning rather
  than sitting black because it exhausted a restart burst.
- **Screen blanking** is cage's default behaviour and is left alone here;
  P4-3 replaces it with presence-aware dimming driven by the LD2410 sensor,
  which is also what protects the panel from burn-in.

## Not yet verified on hardware

Written against the target described in SCOPE.md §2 but not yet run on the
NUC — the panel has not been sourced. Expect to adjust `--ozone-platform`
and the `WLR_*` environment once there is a real display and input device.
