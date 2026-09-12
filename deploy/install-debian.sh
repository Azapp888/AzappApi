#!/usr/bin/env bash
# Azapp AI 网关 · Debian(ARM64) 裸机安装脚本
# 目标硬件：RK3566 四核 / 4GB RAM / 8GB eMMC / SATA 硬盘位 / 千兆网口
#
# 设计取舍（针对小 eMMC）：
#   - 不用 Docker，不用 Postgres/Redis，改用单文件 SQLite + 进程内存限流
#   - 数据库放在 SATA 盘，减少 eMMC 写入
#   - 日志交给 journald，并限制日志总量
#
# 用法：sudo bash install-debian.sh
# 注意：脚本不会执行 systemctl enable（开机自启请你手动决定）。

set -euo pipefail

APP_DIR=/opt/azapp
CONF_DIR=/etc/azapp
DATA_DIR=/mnt/sata/azapp
LOG_DIR=/var/log/azapp
NODE_MAJOR=22

echo "==> 检查系统架构"
ARCH=$(uname -m)
echo "架构: ${ARCH}（RK3566 应为 aarch64）"

echo "==> 安装基础依赖（Node 22 / Nginx / Git）"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg git nginx

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  echo "==> 安装 Node.js ${NODE_MAJOR}.x（ARM64 官方源）"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> 创建运行用户与目录"
id -u azapp >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin azapp
mkdir -p "${APP_DIR}" "${CONF_DIR}" "${LOG_DIR}"
# SATA 数据目录：若未挂载 /mnt/sata，则回退到 /var/lib/azapp
if [ -d /mnt/sata ]; then
  mkdir -p "${DATA_DIR}"
else
  echo "!! 未检测到 /mnt/sata，数据将放在 /var/lib/azapp（建议尽快挂载 SATA 盘）"
  DATA_DIR=/var/lib/azapp
  mkdir -p "${DATA_DIR}"
fi
chown -R azapp:azapp "${DATA_DIR}" "${LOG_DIR}"

echo "==> 拷贝应用代码到 ${APP_DIR}"
# 从当前目录（脚本所在仓库）同步，排除无关文件
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude node_modules --exclude .git --exclude data --exclude '*.db*' ./ "${APP_DIR}/"
else
  cp -a server.js package.json package-lock.json src public "${APP_DIR}/"
fi
cd "${APP_DIR}"
npm ci --omit=dev

if [ ! -f "${CONF_DIR}/azapp.env" ]; then
  echo "==> 生成配置文件 ${CONF_DIR}/azapp.env（请填入真实密钥）"
  cat > "${CONF_DIR}/azapp.env" <<EOF
NODE_ENV=production
PORT=8100
API_PREFIX=/api
JWT_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
ENCRYPTION_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-strong-password
CORS_ORIGINS=https://openai.azayu.top
GATEWAY_STORE=sqlite
GATEWAY_REDIS=memory
SQLITE_PATH=${DATA_DIR}/azapp.db
UPSTREAM_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
UPSTREAM_DEEPSEEK_KEY=
UPSTREAM_ALIYUN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
UPSTREAM_ALIYUN_KEY=
UPSTREAM_DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
UPSTREAM_DOUBAO_KEY=
EOF
  chmod 600 "${CONF_DIR}/azapp.env"
  chown azapp:azapp "${CONF_DIR}/azapp.env"
else
  echo "==> 已存在 ${CONF_DIR}/azapp.env，保持不动"
fi

echo "==> 安装 systemd 服务"
cp deploy/systemd/azapp-api.service /etc/systemd/system/azapp-api.service
systemctl daemon-reload

echo "==> 限制 journald 日志占用（保护 eMMC）"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/azapp.conf <<EOF
[Journal]
SystemMaxUse=200M
MaxRetentionSec=2week
EOF
systemctl restart systemd-journald

echo "==> 安装 Nginx 反向代理配置（请按需修改证书路径）"
cp deploy/nginx/openai.azayu.top.conf /etc/nginx/conf.d/openai.azayu.top.conf
nginx -t || echo "!! Nginx 配置校验失败，请检查证书路径后手动 reload"

cat <<'EOF'

==================== 后续步骤（手动执行） ====================
1) 编辑 /etc/azapp/azapp.env，填入真实的上游密钥、ADMIN_PASSWORD
2) 初始化数据库并试运行：
     sudo -u azapp GATEWAY_STORE=sqlite SQLITE_PATH=/mnt/sata/azapp/azapp.db \
       node /opt/azapp/src/seed.js
3) 启动服务：
     sudo systemctl start azapp-api
     sudo systemctl status azapp-api
4) 如需开机自启（请自行确认）：
     sudo systemctl enable azapp-api
5) 签发证书并启用 Nginx：
     sudo certbot --nginx -d openai.azayu.top
     sudo systemctl reload nginx
6) 验证：
     curl http://127.0.0.1:8100/api/health
7) 管理后台：http://<服务器IP>:8100/admin（或 https://openai.azayu.top/admin）
===============================================================
EOF
