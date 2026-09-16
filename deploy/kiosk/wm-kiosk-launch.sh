#!/usr/bin/env bash
# Chromium launch for the LCARS World Monitor kiosk.
#
# Split out of the systemd unit so the flag list stays readable and can be
# edited without a daemon-reload. Invoked by cage as its single client.
set -euo pipefail

# Defaults are overridable from /etc/default/wm-kiosk.
WM_KIOSK_URL="${WM_KIOSK_URL:-http://localhost:5173/}"
WM_KIOSK_THEME="${WM_KIOSK_THEME:-lcars}"
WM_KIOSK_PROFILE="${WM_KIOSK_PROFILE:-/var/lib/wm-kiosk/chromium}"
WM_KIOSK_BROWSER="${WM_KIOSK_BROWSER:-/usr/bin/chromium}"

# Which display this window is. `panel` is the single-display fallback;
# `dashboard` is the 2U 1280x400 primary and `nav` the 1U 1424x280 console.
# Passed as the first argument so one script serves every surface — sway starts
# it twice, once per output.
WM_KIOSK_SURFACE="${1:-${WM_KIOSK_SURFACE:-panel}}"

case "${WM_KIOSK_SURFACE}" in
  panel)     window_size="1280,720" ;;
  dashboard) window_size="1280,400" ;;
  nav)       window_size="1424,280" ;;
  *)
    echo "wm-kiosk: unknown surface '${WM_KIOSK_SURFACE}'" >&2
    exit 64
    ;;
esac

# BOTH windows share one profile directory, and that is load-bearing rather
# than incidental: same profile means same browser process group, which is what
# makes `BroadcastChannel` reach between them. Separate profiles would leave the
# console unable to tell the dashboard anything (src/surface/).
mkdir -p "${WM_KIOSK_PROFILE}"

# The theme is pinned in the URL rather than left to localStorage. A panel with
# no keyboard cannot be recovered from a wedged persisted value, and the URL
# pin deliberately does not write back to storage (src/themes/index.ts).
separator='?'
case "${WM_KIOSK_URL}" in
  *\?*) separator='&' ;;
esac
url="${WM_KIOSK_URL}${separator}wm-theme=${WM_KIOSK_THEME}&wm-surface=${WM_KIOSK_SURFACE}"

exec "${WM_KIOSK_BROWSER}" \
  --kiosk \
  --app="${url}" \
  --user-data-dir="${WM_KIOSK_PROFILE}" \
  --ozone-platform=wayland \
  --window-size="${window_size}" \
  --class="wm-kiosk-${WM_KIOSK_SURFACE}" \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --hide-scrollbars \
  --touch-events=enabled
