#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec node build/cli.js "${1:-status}" --config .local/gateway.json
