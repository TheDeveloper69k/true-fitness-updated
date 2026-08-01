#!/bin/bash
set -euo pipefail

SERVICE_NAME="truefitness-backend"   # EDIT to match your process manager

pm2 restart "$SERVICE_NAME"
# sudo systemctl restart "$SERVICE_NAME"
