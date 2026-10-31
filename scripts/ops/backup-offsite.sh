#!/bin/sh
# Encrypted off-site copy of the game database (pentest N-14). Runs on the Docker host, daily, after
# the server's own backup (BACKUP_HOURS). restic encrypts before sending (AES-256), so the remote
# only ever sees ciphertext.
#
#   RESTIC_REPOSITORY      where to keep it, OFF this host: s3:https://<conta>.r2.cloudflarestorage.com/mop-backups,
#                          b2:<bucket>:mop, sftp:user@host:/srv/restic/mop ...
#   RESTIC_PASSWORD_FILE   file (0600) with the repository password; keep a copy in Infisical (/mop/RESTIC_PASSWORD):
#                          without it the backups cannot be read
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   for s3: (R2) repositories
#   MOP_VOLUME             Docker volume of the game (default masters-of-pwnage-data)
#
# cron (root):  15 4 * * *  /opt/mop/backup-offsite.sh >> /var/log/mop-backup.log 2>&1
set -eu
: "${RESTIC_REPOSITORY:?defina RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD_FILE:?defina RESTIC_PASSWORD_FILE}"
VOLUME="${MOP_VOLUME:-masters-of-pwnage-data}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
chmod 700 "$STAGE"

# The newest copy made by VACUUM INTO (consistent); never the live .sqlite with its WAL.
docker run --rm --network none -v "$VOLUME":/d:ro -v "$STAGE":/o alpine:3.20 sh -c \
  'f=$(ls -1t /d/backups/mop-*.sqlite 2>/dev/null | head -1); [ -n "$f" ] || { echo "nenhum backup em /data/backups" >&2; exit 1; }
   cp "$f" /o/mop-latest.sqlite && chmod 600 /o/mop-latest.sqlite && basename "$f"'

restic snapshots >/dev/null 2>&1 || restic init
restic backup --tag mop --host mop "$STAGE/mop-latest.sqlite"
restic forget --tag mop --keep-daily 14 --keep-weekly 8 --keep-monthly 6 --prune
restic check --read-data-subset=5%
echo "$(date -u +%FT%TZ) cópia externa ok"
