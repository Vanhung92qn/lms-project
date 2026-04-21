#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Daily backup of Postgres + (if present) MongoDB.
# Designed to run from cron on the VPS:
#   0 2 * * *   /home/root/lms-project/scripts/backup.sh
#
# Retention: keeps the last 7 daily snapshots under ${BACKUP_DIR}, deletes
# anything older. Exit code is non-zero if ANY dump failed, so cron MAILTO
# catches real failures.
#
# Not-included on purpose:
#   - Redis (ephemeral — rate-limit counters are OK to lose on restore)
#   - Ollama models (large, re-downloadable from the registry)
#   - File uploads (none exist yet; will live in MinIO/S3 later)
# -----------------------------------------------------------------------------

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/lms/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TS="$(date -u +%Y%m%d-%H%M%S)"
STAMP_DIR="${BACKUP_DIR}/${TS}"

mkdir -p "${STAMP_DIR}"
chmod 700 "${BACKUP_DIR}" "${STAMP_DIR}"

log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }

# ---- Postgres ----------------------------------------------------------
log "dumping postgres → ${STAMP_DIR}/postgres.sql.gz"
docker exec lms-postgres pg_dump \
  -U "${POSTGRES_USER:-lms}" \
  --no-owner --no-acl --clean --if-exists \
  "${POSTGRES_DB:-lms}" \
  | gzip -9 > "${STAMP_DIR}/postgres.sql.gz"

pg_size=$(stat -c%s "${STAMP_DIR}/postgres.sql.gz")
log "postgres ok — ${pg_size} bytes"

# ---- MongoDB (optional — skip silently if telemetry not deployed) ------
if docker ps --format '{{.Names}}' | grep -q '^lms-mongo$'; then
  log "dumping mongo → ${STAMP_DIR}/mongo.archive.gz"
  docker exec lms-mongo mongodump \
    --username "${MONGO_ROOT_USER:-lms}" \
    --password "${MONGO_ROOT_PASSWORD:-change-me-in-prod}" \
    --authenticationDatabase admin \
    --db "${MONGO_DB:-lms_telemetry}" \
    --archive --gzip \
    > "${STAMP_DIR}/mongo.archive.gz"
  mongo_size=$(stat -c%s "${STAMP_DIR}/mongo.archive.gz")
  log "mongo ok — ${mongo_size} bytes"
else
  log "mongo container not running — skipping (ok for pre-P5a deployments)"
fi

# ---- Retention ---------------------------------------------------------
log "pruning older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -maxdepth 1 -type d -name '????????-??????' \
  -mtime +"${RETENTION_DAYS}" -print -exec rm -rf {} +

# ---- Summary ----------------------------------------------------------
log "backup complete:"
ls -lh "${STAMP_DIR}" | sed 's/^/  /' >&2
log "total snapshots retained:"
ls -1d "${BACKUP_DIR}"/*/ 2>/dev/null | wc -l | sed 's/^/  /' >&2

# ---- Offsite mirror (optional — user wires this when B2/S3 is set up)
# if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
#   aws s3 sync "${STAMP_DIR}" "s3://${BACKUP_S3_BUCKET}/${TS}/" --storage-class STANDARD_IA
# fi
