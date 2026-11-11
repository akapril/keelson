#!/usr/bin/env bash
# Check stored SquashFS modes: extraction can rewrite modes and hide this bug.
set -euo pipefail
image="$(realpath "${1:?Usage: bash scripts/check-appimage-permissions.sh FILE.AppImage}")"
offset="$("$image" --appimage-offset)"
listing="$(unsquashfs -lln -o "$offset" "$image")"
printf '%s\n' "$listing" | awk '
  $1 ~ /^[-d]/ {
    mode = $1
    if (substr(mode, 8, 1) != "r" ||
        ((substr(mode, 4, 1) ~ /[xs]/ || substr(mode, 1, 1) == "d") && substr(mode, 10, 1) !~ /[xt]/)) {
      print "Inaccessible AppImage entry: " $0
      bad = 1
    }
    if ($NF ~ /^squashfs-root\/AppRun(\.wrapped)?$/) {
      launchers++
      if (substr(mode, 1, 1) != "-" || substr(mode, 10, 1) !~ /[xt]/) {
        print "Launcher is not executable: " $0
        bad = 1
      }
    }
  }
  END {
    if (!launchers) { print "No AppRun launcher found"; exit 1 }
    exit bad ? 1 : 0
  }
'
echo "AppImage stored permissions passed: $image"
