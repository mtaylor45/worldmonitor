#!/usr/bin/env bash
# Starts sway with the two-display config, substituting the output and touch
# device names for this machine.
#
# sway's config language has no environment interpolation, so the template is
# rendered to a runtime file rather than edited in place — which keeps the
# checked-in template honest about being a template.
set -euo pipefail

WM_KIOSK_OUT_DASHBOARD="${WM_KIOSK_OUT_DASHBOARD:-}"
WM_KIOSK_OUT_NAV="${WM_KIOSK_OUT_NAV:-}"
WM_KIOSK_TOUCH_DASHBOARD="${WM_KIOSK_TOUCH_DASHBOARD:-}"
WM_KIOSK_TOUCH_NAV="${WM_KIOSK_TOUCH_NAV:-}"

if [ -z "${WM_KIOSK_OUT_DASHBOARD}" ] || [ -z "${WM_KIOSK_OUT_NAV}" ]; then
    cat >&2 <<'MSG'
wm-kiosk: output names are not set.

Two displays cannot be assigned without knowing what the compositor calls
them, and guessing would put the console on the dashboard panel. Run:

    swaymsg -t get_outputs | grep -E '"name"|"model"'

and set WM_KIOSK_OUT_DASHBOARD and WM_KIOSK_OUT_NAV in /etc/default/wm-kiosk.
MSG
    exit 78
fi

template="${WM_KIOSK_SWAY_TEMPLATE:-/usr/local/share/wm-kiosk/wm-kiosk-dual.sway}"
runtime="${XDG_RUNTIME_DIR:-/tmp}/wm-kiosk-dual.sway"

render() {
    sed \
        -e "s|\$out_dashboard|${WM_KIOSK_OUT_DASHBOARD}|g" \
        -e "s|\$out_nav|${WM_KIOSK_OUT_NAV}|g" \
        "${template}"
}

# A touchscreen left unmapped sends coordinates in the whole-layout space, so a
# touch on the lower panel lands on the upper one. When the identifiers are not
# configured the mapping lines are dropped rather than left with empty
# arguments, which sway rejects outright.
if [ -n "${WM_KIOSK_TOUCH_DASHBOARD}" ] && [ -n "${WM_KIOSK_TOUCH_NAV}" ]; then
    render | sed \
        -e "s|\$in_touch_dashboard|${WM_KIOSK_TOUCH_DASHBOARD}|g" \
        -e "s|\$in_touch_nav|${WM_KIOSK_TOUCH_NAV}|g" \
        > "${runtime}"
else
    echo "wm-kiosk: no touch device mapping set; touch may land on the wrong panel" >&2
    render | grep -v 'map_to_output' > "${runtime}"
fi

exec /usr/bin/sway -c "${runtime}"
