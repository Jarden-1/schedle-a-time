# Meet Backend

Node.js/Express backend for the time scheduler mini program.

## Setup

```bash
npm install
cp .env.example .env
npm test
```

Required environment variables are listed in `.env.example`. `sharp` is a native
dependency; on a clean Linux server run `npm ci --omit=dev` and it will pull the
prebuilt binary.

## Scripts

- `npm test`: run regression, smoke and integration tests
- `npm run migrate:backfill`: backfill historical event data

## Runtime Notes

- Runtime uploads are stored in `uploads/` and are intentionally ignored by Git.
- Uploaded images are decoded with `sharp` and re-encoded to JPEG (max 512px),
  so the stored file never keeps the client-supplied format or metadata.
- Secrets must stay in `.env`; do not commit production credentials.

## Deployment

### 必须单实例 fork 模式

微信 `access_token` 的缓存是**进程内**的。如果开 cluster（`pm2 start server.js -i max`），
每个实例会各自换一次 token，新 token 让其他实例的 token 立刻失效，订阅消息就会大面积失败。

```bash
# 推荐：用仓库里的配置启动
pm2 start ecosystem.config.js
pm2 save

# 已有的进程请先删掉再按上面的方式重启
# pm2 delete <旧进程名>
```

检查方式：

```bash
pm2 list           # mode 应为 fork，instances 为 1
```

如果以后确实需要多实例，请把 access_token 换成共享存储（Redis 或数据库），
不要继续依赖进程内缓存。

### 反向代理

`app.set('trust proxy', 1)` 已经打开，Nginx 需要透传真实 IP：

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 3m;
}
```

### Nginx 层限流（推荐）

应用内已经有针对 `/api/login`（20 次/分钟）和 `/api/upload`（10 次/分钟）的
基础限流，Nginx 再做一层更稳：

```nginx
# 放在 http { } 块里
limit_req_zone $binary_remote_addr zone=api_login:10m rate=20r/m;
limit_req_zone $binary_remote_addr zone=api_upload:10m rate=10r/m;

# 放在 server { } 块里
location = /api/login {
    limit_req zone=api_login burst=5 nodelay;
    proxy_pass http://127.0.0.1:3000;
}

location = /api/upload {
    limit_req zone=api_upload burst=3 nodelay;
    client_max_body_size 3m;
    proxy_pass http://127.0.0.1:3000;
}
```

### CORS

默认**不允许任何跨域来源**。小程序原生请求不携带 `Origin` 头，因此不受影响。
浏览器里调试时按需配置：

```env
# 多个来源用逗号分隔
CORS_ORIGINS=http://localhost:10086,https://example.com
# 或者完全放开（不推荐用于生产）
CORS_ORIGINS=*
```

### 列表接口分页

`GET /api/events` 支持 `limit`（默认 50，上限 200）和 `offset`，
响应里的 `pagination` 字段包含 `total` / `limit` / `offset` / `hasMore`。
列表项**不返回**参与者的 `availableSlots`，只有详情接口会返回，用于控制响应体大小。
