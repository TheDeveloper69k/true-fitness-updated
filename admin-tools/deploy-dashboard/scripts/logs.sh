#!/bin/bash
set -euo pipefail

SERVICE_NAME="truefitness"   # EDIT to match your process manager

pm2 logs "$SERVICE_NAME" --lines 150 --nostream
# journalctl -u "$SERVICE_NAME" -n 150 --no-pager
