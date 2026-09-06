#!/bin/bash
# Ensure the MySQL container is running and healthy before the service starts.
set -e
cd "$(dirname "$0")/.."

# Docker Desktop may not be running yet (e.g. right after a reboot).
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running - starting Docker Desktop..."
  open -a Docker
  for i in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    echo "Docker did not come up in time. Start Docker Desktop, then retry." >&2
    exit 1
  fi
fi

# Idempotent: no-op if already up and healthy. --wait blocks on the healthcheck.
docker compose up -d --wait
