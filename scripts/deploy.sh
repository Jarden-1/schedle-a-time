#!/usr/bin/env bash
#
# 一键部署后端到线上服务器。
#
# 用法（在仓库根目录）：
#   ./scripts/deploy.sh              # 常规部署
#   ./scripts/deploy.sh --skip-check # 跳过本地类型检查
#   DEPLOY_HOST=myserver ./scripts/deploy.sh
#
# 前置：
#   - ~/.ssh/config 里已经配好免密登录（本项目用 myserver 别名）
#   - 服务器上服务名为 meet-api
#
set -euo pipefail

HOST="${DEPLOY_HOST:-myserver}"
REMOTE_DIR="${DEPLOY_DIR:-/root/meet-backend}"
SERVICE="${DEPLOY_SERVICE:-meet-api}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-https://api.zhanghaoyang.cn/api/announcement/latest}"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

SKIP_CHECK=0
for arg in "$@"; do
  [ "$arg" = "--skip-check" ] && SKIP_CHECK=1
done

if [ "$SKIP_CHECK" -eq 0 ]; then
  echo "▶ 1/6 本地类型检查"
  npx tsc --noEmit
else
  echo "▶ 1/6 跳过类型检查"
fi

echo "▶ 2/6 检查服务器连通性"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "test -d $REMOTE_DIR" || {
  echo "❌ 无法连接服务器或目录不存在: $HOST:$REMOTE_DIR"
  exit 1
}

echo "▶ 3/6 备份服务器现状"
STAMP="$(date +%Y%m%d-%H%M%S)"
ssh -o BatchMode=yes "$HOST" "mkdir -p /root/deploy-backups && tar -czf /root/deploy-backups/meet-backend-${STAMP}.tar.gz -C ${REMOTE_DIR} server.js package.json package-lock.json models scripts && echo '  备份完成: /root/deploy-backups/meet-backend-${STAMP}.tar.gz'"

echo "▶ 4/6 同步代码"
scp -q -o BatchMode=yes backend/server.js backend/package.json backend/package-lock.json "$HOST:$REMOTE_DIR/"
scp -q -o BatchMode=yes backend/models/*.js "$HOST:$REMOTE_DIR/models/"
scp -q -o BatchMode=yes backend/scripts/*.js backend/scripts/*.sh "$HOST:$REMOTE_DIR/scripts/"
ssh -o BatchMode=yes "$HOST" "chmod +x $REMOTE_DIR/scripts/*.sh"

echo "▶ 5/6 安装依赖 + 数据迁移"
ssh -o BatchMode=yes "$HOST" "
  cd $REMOTE_DIR
  npm ci --omit=dev --no-audit --no-fund
  npm run migrate:after-deploy
"

echo "▶ 6/6 重启服务 + 健康检查"
ssh -o BatchMode=yes "$HOST" "systemctl restart $SERVICE"
sleep 3
ssh -o BatchMode=yes "$HOST" "systemctl is-active $SERVICE"

if curl -fsS --max-time 15 "$HEALTH_URL" >/dev/null; then
  echo "✅ 部署完成，接口健康"
else
  echo "⚠️ 服务已重启，但健康检查失败，请查看 journalctl -u $SERVICE"
  exit 1
fi
