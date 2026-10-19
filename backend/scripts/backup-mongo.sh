#!/usr/bin/env bash
#
# MongoDB 每日备份
#
# - 输出：$BACKUP_DIR/${DB_NAME}-YYYYmmdd-HHMMSS.gz
# - 保留：$KEEP_DAYS 天
# - 校验：gzip 完整性 + 文件大小下限
# - 附带检查磁盘水位（低于阈值只告警，不影响备份结果）
#
set -euo pipefail

DB_NAME="${DB_NAME:-meet_assistant}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/mongo}"
KEEP_DAYS="${KEEP_DAYS:-7}"
MIN_SIZE_KB="${MIN_SIZE_KB:-10}"
DISK_WARN_MB="${DISK_WARN_MB:-2048}"

STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="${BACKUP_DIR}/${DB_NAME}-${STAMP}.gz"

log() { echo "[$(date '+%F %T')] $*"; }

mkdir -p "$BACKUP_DIR"

log "开始备份 ${DB_NAME} -> ${TARGET}"
if ! mongodump --db "$DB_NAME" --gzip --archive="$TARGET" --quiet; then
  log "ERROR mongodump 执行失败"
  rm -f "$TARGET"
  exit 1
fi

if ! gzip -t "$TARGET" 2>/dev/null; then
  log "ERROR 备份文件 gzip 校验失败：${TARGET}"
  exit 1
fi

SIZE_KB="$(du -k "$TARGET" | cut -f1)"
if [ "$SIZE_KB" -lt "$MIN_SIZE_KB" ]; then
  log "ERROR 备份文件过小（${SIZE_KB}KB < ${MIN_SIZE_KB}KB），判定失败"
  exit 1
fi

log "备份完成：${TARGET}（${SIZE_KB}KB）"

DELETED="$(find "$BACKUP_DIR" -name "${DB_NAME}-*.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l | tr -d ' ')"
log "清理过期备份 ${DELETED} 个（保留 ${KEEP_DAYS} 天）"

AVAIL_MB="$(df -Pm / | awk 'NR==2 {print $4}')"
if [ "$AVAIL_MB" -lt "$DISK_WARN_MB" ]; then
  log "WARN 磁盘剩余仅 ${AVAIL_MB}MB，低于阈值 ${DISK_WARN_MB}MB"
else
  log "磁盘剩余 ${AVAIL_MB}MB"
fi

log "完成"
