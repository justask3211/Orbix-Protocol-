#!/usr/bin/env bash
# Start the staking backend API on :8310 (K — staking read backend).
set -euo pipefail
cd "$(dirname "$0")/.."
exec node relayer/staking-api.js
