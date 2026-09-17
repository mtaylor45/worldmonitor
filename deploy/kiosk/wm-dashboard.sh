#!/usr/bin/env bash
# Starts the dashboard server.
#
# A script rather than the unit calling npm directly, because systemd expands
# EnvironmentFile variables in ExecStart= and NOWHERE ELSE — not in
# WorkingDirectory=, not in User=. A unit with `WorkingDirectory=${WM_APP_DIR}`
# looks like it works and fails at start with a path taken literally.
set -euo pipefail

WM_APP_DIR="${WM_APP_DIR:-/opt/worldmonitor}"

if [ ! -d "${WM_APP_DIR}/node_modules" ]; then
    echo "wm-dashboard: ${WM_APP_DIR} has no node_modules — run 'npm ci' there first" >&2
    exit 78
fi

cd "${WM_APP_DIR}"

# --host 127.0.0.1 keeps it off the LAN. The panel is the only client, and the
# sidecar reaches it on localhost; binding wider would publish an unauthenticated
# dashboard to every device on the network.
exec npm run dev -- --host 127.0.0.1
