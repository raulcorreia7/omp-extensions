#!/usr/bin/env bash
#
# Install every extension in this repo into the live OMP extensions directory.
#
# Each extension is a single entry point (index.ts). The install replaces the
# target directory wholesale, so files deleted from this repo never linger in
# the installed copy. Sidecar data files (*.md) install as symlinks to their
# repo copies, so runtime edits (captured lessons) land in the repo and
# survive reinstalls.
#
# Usage:
#   ./install.sh
#   OMP_EXT_DIR=/some/other/dir ./install.sh   # override the extensions root

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_ROOT="${OMP_EXT_DIR:-$HOME/.omp/agent/extensions}"

for src in "$ROOT"/extensions/*/; do
   name="$(basename "$src")"
   dest="$DEST_ROOT/$name"
   rm -rf "$dest"
   mkdir -p "$dest"
   cp "$src/index.ts" "$dest/"
   for sidecar in "$src"/*.md; do
      [ -e "$sidecar" ] || continue
      ln -s "$sidecar" "$dest/$(basename "$sidecar")"
   done
   echo "Installed $name extension -> $dest"
done
