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

mkdir -p "${WM_KIOSK_PROFILE}"

# The theme is pinned in the URL rather than left to localStorage. A panel with
# no keyboard cannot be recovered from a wedged persisted value, and the URL
# pin deliberately does not write back to storage (src/themes/index.ts).
separator='?'
case "${WM_KIOSK_URL}" in
  *\?*) separator='&' ;;
esac
url="${WM_KIOSK_URL}${separator}wm-theme=${WM_KIOSK_THEME}"

exec "${WM_KIOSK_BROWSER}" \
  --kiosk \
  --app="${url}" \
  --user-data-dir="${WM_KIOSK_PROFILE}" \
  --ozone-platform=wayland \
  --window-size=1280,720 \
  --start-fullscreen \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --overscroll-history-navigation=0 \
  --disable-pinch \
  --hide-scrollbars
