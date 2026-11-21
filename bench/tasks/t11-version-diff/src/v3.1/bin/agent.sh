#!/bin/sh
# Starts the vendor agent.
exec node "$(dirname "$0")/../lib/agent.js" "$@"
