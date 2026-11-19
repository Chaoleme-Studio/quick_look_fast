#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# Use the Node runtime already shipped with Electron; do not require Node.js
# to be installed on the user's computer.
ELECTRON_RUN_AS_NODE=1 exec "$app_dir/quicklook-fast" "$app_dir/resources/app/scripts/install-linux-integration.cjs" --launcher "$app_dir/quicklook-fast" "$@"
