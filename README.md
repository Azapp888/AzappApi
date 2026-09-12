# AzappApi · Azapp 服务端 API

Azapp 系列应用的服务端 API 骨架：开箱即用的 Express 工程结构，内置跨域、请求日志、统一错误处理、JWT 鉴权与健康检查，按模块往下加业务即可。

此外集成了 **OpenAI 兼容的 AI API 聚合网关**：对外暴露 `/v1/chat/completions`、`/v1/models`，按 `model` 路由转发到 DeepSeek、阿里云百炼、豆包（火山方舟），带令牌鉴权、RPM/并发/TPM/日额度限流、IP 白名单与用量统计。设计与部署细节见 `/docs/AI-GATEWAY.md`（位于当前工作区）。

## 🤖 AI 聚合网关快速开始

本地/单机零依赖运行（默认 SQLite + 内存限流 + mock 上游，无需 Postgres/Redis/上游 Key）：

```bash
npm install
npm start
```

需要 Node >= 22（使用内置 `node:sqlite`）。启动后打开管理后台界面：http://localhost:8100/admin （默认 `admin` / `admin123`）。登录后进入「开始配置」向导：第 1 步为三家服务商填入 API Key，第 2 步逐个添加模型，第 3 步创建下游令牌。系统不预置任何模型。

也可以直接用 API 生成一个令牌并调用：

```bash
# 1. 登录管理后台，拿到 admin JWT
curl -s http://localhost:8100/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# 2. 用 JWT 创建用户与令牌，响应里的 key 仅返回一次
curl -s http://localhost:8100/api/admin/tokens \
  -H "Authorization: Bearer <admin-jwt>" -H "Content-Type: application/json" \
  -d '{"userId":"u_admin","name":"demo","plan":"free","expires_in_days":7}'

# 3. 用下发的 sk-az-... 调用（model 换成你在后台添加的对外模型名）
curl -s http://localhost:8100/v1/chat/completions \
  -H "Authorization: Bearer sk-az-..." -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}]}'
```

部署方式二选一：

- 单机（RK3566 / Debian ARM64，4GB 内存、8GB eMMC）：SQLite + 内存限流，裸机 systemd。执行 `sudo bash deploy/install-debian.sh`，详见 当前工作区 内的 `/docs/AI-GATEWAY.md` 第 6 节。
- 完整方案（独立数据库 / 多实例）：Postgres + Redis + Docker。

```bash
cp .env.example .env
# 填入 JWT_SECRET、ENCRYPTION_KEY、三家 UPSTREAM_*_KEY
docker compose up -d --build
```

OpenAI SDK 只需把 `base_url` 换成本服务地址、`api_key` 换成下发的令牌即可。例如 `base_url="https://openai.azayu.top/v1"`。

模型不写死：`model_mappings` 即白名单，你在后台随时增删、启停，未配置的模型返回 404。Nginx 反代与流式（SSE）配置见当前工作区内的 `/deploy/nginx/openai.azayu.top.conf`。


## ✨ 已内置

- **统一响应结构** — 成功 `{ success: true, ... }`，失败 `{ success: false, message }`
- **统一错误处理** — 抛错即返回 JSON，自动带 HTTP 状态码
- **请求日志** — 方法、路径、状态码、耗时
- **CORS 配置** — 通过 `CORS_ORIGINS` 控制允许的前端来源
- **JWT 鉴权中间件** — 标准 `Authorization: Bearer <token>`
- **健康检查** — `/api/health` 返回运行状态与 uptime
- **配置集中管理** — 所有环境变量统一在 `src/config.js` 读取

## 🧱 技术栈

Node.js（>=18）+ Express 4、jsonwebtoken、cors、dotenv

## 📁 目录结构

```
AzappApi/
├── server.js                 # 进程入口，读取配置并监听端口
├── src/
│   ├── app.js                # Express 实例：中间件、路由挂载、错误处理
│   ├── config.js             # 环境变量统一读取
│   ├── routes/
│   │   ├── index.js          # 路由汇总（统一挂到 API_PREFIX 下）
│   │   └── health.js         # GET /api/health
│   └── middleware/
│       └── auth.js           # JWT Bearer 鉴权
├── .env.example              # 环境变量模板
└── package.json
```

## 🚀 快速开始

```bash
npm install
cp .env.example .env      # 按需修改端口、JWT 密钥、跨域来源
npm start                 # 或 npm run dev（文件变更自动重启）
```

启动后：

```bash
curl http://localhost:8100/api/health
# {"success":true,"status":"ok","uptime":3,"time":"..."}
```

## 🔌 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 否 | 健康检查，返回运行状态与 uptime |
| GET | `/api/me` | 是 | 示例接口，返回 JWT 中的用户信息 |
| POST | `/api/admin/login` | 否 | 管理后台登录，返回 JWT |
| POST | `/api/admin/tokens` | JWT | 创建下游令牌，明文 key 仅返回一次 |
| GET | `/api/admin/usage` | JWT | 用量汇总（按令牌/用户/模型/天） |
| GET | `/v1/models` | API Key | OpenAI 兼容模型列表 |
| POST | `/v1/chat/completions` | API Key | OpenAI 兼容对话，支持 `stream` |

带鉴权的请求写法：

```bash
curl http://localhost:8100/api/me -H "Authorization: Bearer <你的token>"
```

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | 运行环境 |
| `PORT` | `8100` | 服务端口 |
| `API_PREFIX` | `/api` | 接口统一前缀 |
| `JWT_SECRET` | `change-me-in-production` | JWT 签名密钥，**生产必须替换** |
| `JWT_EXPIRES_IN` | `7d` | 令牌有效期 |
| `CORS_ORIGINS` | `*` | 允许的前端来源，逗号分隔 |
| `GATEWAY_STORE` | 有 `DATABASE_URL` 时 `postgres`，否则 `sqlite` | 存储层 |
| `SQLITE_PATH` | `data/azapp.db` | SQLite 数据文件，单机建议放 SATA 盘 |
| `GATEWAY_REDIS` | 有 `REDIS_URL` 时 `redis`，否则 `memory` | 限流存储层 |
| `DATABASE_URL` | - | PostgreSQL 连接串（多实例时使用） |
| `REDIS_URL` | - | Redis 连接串（多实例时使用） |
| `ENCRYPTION_KEY` | 回退到 `JWT_SECRET` | 上游密钥加密密钥，**生产单独设置** |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | 初始管理员 |
| `UPSTREAM_DEEPSEEK_KEY` | - | DeepSeek 上游密钥 |
| `UPSTREAM_ALIYUN_KEY` | - | 阿里云百炼上游密钥 |
| `UPSTREAM_DOUBAO_KEY` | - | 豆包（火山方舟）上游密钥 |
| `MOCK_UPSTREAM` | 无上游密钥时自动 `true` | 无上游时返回 mock 回复 |
| `DEFAULT_MODEL_MAPPINGS` | 空 | 可选，首次启动预置的模型映射 JSON；默认不预置，登录后在后台逐个添加 |

## ➕ 怎么加一个新模块

1. 在 `src/routes/` 下新建 `xxx.js`，导出一个 `Router`
2. 在 `src/routes/index.js` 里 `router.use('/xxx', xxx)`
3. 需要登录的接口加上 `auth` 中间件：`router.post('/xxx', auth, handler)`

访问路径即 `/api/xxx`。

## 🔐 安全说明

仓库不含任何密钥，`.env` 已加入 `.gitignore`，只保留 `.env.example` 模板。部署前请生成强随机 `JWT_SECRET` 并收紧 `CORS_ORIGINS`。

## 📄 License

MIT
