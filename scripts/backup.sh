#!/usr/bin/env bash
set -euo pipefail

# Backup harian PostgreSQL dengan retensi 30 hari.
# Pemakaian: DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/orca ./scripts/backup.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

DATABASE_URL="${DATABASE_URL:-postgres://orca:orca@127.0.0.1:5432/orca}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/orca}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "${BACKUP_DIR}"
TARGET="${BACKUP_DIR}/orca-${STAMP}.dump"

pg_dump "${DATABASE_URL}" --format=custom --file="${TARGET}"
chmod 600 "${TARGET}"

find "${BACKUP_DIR}" -type f -name 'orca-*.dump' -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] selesai: ${TARGET}"
