#!/bin/bash
set -euo pipefail

# EDIT these two values to match your server.
REPO_PATH="/path/to/true-fitness-updated"
SERVICE_NAME="truefitness-backend"   # pm2 process name, or systemd unit name

cd "$REPO_PATH"
git pull origin main

cd backend
npm install --omit=dev

# Uncomment whichever matches how your backend actually runs on this server:
pm2 restart "$SERVICE_NAME"
# sudo systemctl restart "$SERVICE_NAME"
