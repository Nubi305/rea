#!/bin/sh
# Starts the sync worker with the packaged defaults.
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
. "$here/config/defaults.env"
exec node "$here/lib/core.js" "$@"
