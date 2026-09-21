#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec node build/cli.js "agent-${1:-status}" --config .local/cloud-agent.json
