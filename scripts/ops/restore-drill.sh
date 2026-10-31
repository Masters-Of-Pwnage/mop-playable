#!/bin/sh
# Restore drill (pentest N-14; ADR-01 of docs/sdd/00-arquitetura.md): brings the latest off-site
# snapshot back into a throwaway volume, with no network, and checks it with the game's own image.
# Run monthly and before any big change. Same variables as backup-offsite.sh, plus:
#   MOP_IMAGE   game image to check with (default: the one the running container uses)
set -eu
: "${RESTIC_REPOSITORY:?defina RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD_FILE:?defina RESTIC_PASSWORD_FILE}"
IMAGE="${MOP_IMAGE:-$(docker inspect -f '{{.Config.Image}}' masters-of-pwnage)}"
WORK="$(mktemp -d)"
VOL="mop-restore-drill-$$"
trap 'rm -rf "$WORK"; docker volume rm -f "$VOL" >/dev/null 2>&1 || true' EXIT

restic restore latest --tag mop --target "$WORK"
FILE="$(find "$WORK" -name mop-latest.sqlite | head -1)"
[ -n "$FILE" ] || { echo "snapshot sem mop-latest.sqlite" >&2; exit 1; }
docker volume create "$VOL" >/dev/null
docker run --rm --network none -v "$VOL":/data -v "$(dirname "$FILE")":/r:ro alpine:3.20 sh -c \
  'cp /r/mop-latest.sqlite /data/mop.sqlite && chown 1000:1000 /data/mop.sqlite && chmod 600 /data/mop.sqlite'
# Exit code 1 when the file is unreadable or a ledger invariant is broken.
docker run --rm --network none -v "$VOL":/data -w /app/server "$IMAGE" node src/verify-backup.js /data/mop.sqlite
echo "$(date -u +%FT%TZ) ensaio de restauração ok"
