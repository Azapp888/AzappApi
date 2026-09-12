# AzappApi · Azapp 服务端 API

Azapp 系列应用的服务端 API 骨架：开箱即用的 Express 工程结构，内置跨域、请求日志、统一错误处理、JWT 鉴权与健康检查，按模块往下加业务即可。

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

## ➕ 怎么加一个新模块

1. 在 `src/routes/` 下新建 `xxx.js`，导出一个 `Router`
2. 在 `src/routes/index.js` 里 `router.use('/xxx', xxx)`
3. 需要登录的接口加上 `auth` 中间件：`router.post('/xxx', auth, handler)`

访问路径即 `/api/xxx`。

## 🔐 安全说明

仓库不含任何密钥，`.env` 已加入 `.gitignore`，只保留 `.env.example` 模板。部署前请生成强随机 `JWT_SECRET` 并收紧 `CORS_ORIGINS`。

## 📄 License

MIT
