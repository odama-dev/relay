#!/usr/bin/env bash
# Daily database backup (PRD: 02:00 WIB, kept off the VPS, ≥ 14 days).
# Dumps the app database, uploads it with rclone to off-VPS object storage,
# and prunes copies older than RETENTION_DAYS. Run from cron as the app user:
#   0 2 * * * /opt/odama-os/scripts/backup.sh >> /var/log/odama-backup.log 2>&1
# Needs: pg_dump, rclone with a remote named in BACKUP_REMOTE (e.g. "r2:odama-backups").
set -euo pipefail

: "${DIRECT_URL:?set DIRECT_URL (env file)}"
: "${BACKUP_REMOTE:?set BACKUP_REMOTE, e.g. r2:odama-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
WORKDIR="${BACKUP_DIR:-/var/backups/odama}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
FILE="$WORKDIR/odama-$STAMP.dump"

mkdir -p "$WORKDIR"
# Custom format: compressed, restorable table by table with pg_restore.
pg_dump --format=custom --no-owner --dbname="${DIRECT_URL%%\?*}" --file="$FILE"
rclone copy "$FILE" "$BACKUP_REMOTE/"
rclone delete --min-age "${RETENTION_DAYS}d" "$BACKUP_REMOTE/"
find "$WORKDIR" -name 'odama-*.dump' -mtime +2 -delete
echo "$(date -u +%FT%TZ) backup ok: $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"

# Restore test (do once before launch, see docs/VPS_DEPLOY.md):
#   createdb odama_restore && pg_restore --no-owner --dbname=odama_restore odama-<stamp>.dump
