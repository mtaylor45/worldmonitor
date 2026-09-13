#!/usr/bin/env bash
# Fetches and verifies the weights listed in models.conf.
#
# Idempotent: a file already present and matching its hash is left alone, so
# re-running after a partial download resumes rather than restarting five
# gigabytes. A file present and NOT matching is refused rather than silently
# re-fetched — that is either a corrupted download or a changed upstream
# artefact, and both are things the operator should see.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${WM_MODEL_DIR:-$here/models}"
conf="$here/models.conf"

verify() {  # path sha -> 0 if it matches
    [ -f "$1" ] || return 1
    [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$2" ]
}

failed=0
while IFS='|' read -r name url sha; do
    case "$name" in ''|\#*) continue ;; esac
    target="$dest/$name"

    if verify "$target" "$sha"; then
        printf '  ok    %s\n' "$name"
        continue
    fi

    if [ -f "$target" ]; then
        printf '  FAIL  %s\n        present but the hash does not match.\n' "$name"
        printf '        expected %s\n        got      %s\n' \
            "$sha" "$(sha256sum "$target" | cut -d' ' -f1)"
        printf '        Delete it to re-fetch, or check models.conf against upstream.\n'
        failed=$((failed + 1))
        continue
    fi

    printf '  ..    %s\n' "$name"
    mkdir -p "$(dirname "$target")"
    # --continue-at so an interrupted multi-gigabyte fetch resumes.
    if ! curl -fL --continue-at - --progress-bar -o "$target.part" "$url"; then
        printf '  FAIL  %s\n        download failed: %s\n' "$name" "$url"
        failed=$((failed + 1))
        continue
    fi

    if verify "$target.part" "$sha"; then
        mv "$target.part" "$target"
        printf '  ok    %s\n' "$name"
    else
        printf '  FAIL  %s\n        downloaded, but the hash does not match. Not installed.\n' "$name"
        printf '        expected %s\n        got      %s\n' \
            "$sha" "$(sha256sum "$target.part" | cut -d' ' -f1)"
        failed=$((failed + 1))
    fi
done < "$conf"

echo
if [ "$failed" -gt 0 ]; then
    echo "$failed file(s) failed. The panel will not start cleanly."
    exit 1
fi
echo "All weights present and verified in $dest"
