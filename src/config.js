'use strict';

// 统一配置入口：所有环境变量在这里读取并给默认值

const hasUpstreamKeys = Boolean(
  process.env.UPSTREAM_DEEPSEEK_KEY ||
    process.env.UPSTREAM_ALIYUN_KEY ||
    process.env.UPSTREAM_DOUBAO_KEY
);

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',

  // HTTP 服务端口
  PORT: Number(process.env.PORT || 8100),

  // 所有业务接口的统一前缀
  API_PREFIX: process.env.API_PREFIX || '/api',

  // JWT 配置（生产环境必须通过环境变量覆盖 JWT_SECRET）
  JWT_SECRET: process.env.JWT_SECRET || 'change-me-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // 允许跨域的前端地址，逗号分隔；* 表示不限制
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ======================= AI 聚合网关 =======================

  // 存储层：sqlite | postgres | memory。
  // 默认策略：有 DATABASE_URL 用 postgres，否则用 sqlite（单文件，适合小内存单机）。
  GATEWAY_STORE:
    process.env.GATEWAY_STORE || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),

  // 限流存储：redis | memory。单机默认 memory，省掉一个常驻进程。
  GATEWAY_REDIS:
    process.env.GATEWAY_REDIS || (process.env.REDIS_URL ? 'redis' : 'memory'),

  // SQLite 数据文件路径（GATEWAY_STORE=sqlite 时生效）
  SQLITE_PATH: process.env.SQLITE_PATH || 'data/azapp.db',

  DATABASE_URL: process.env.DATABASE_URL || '',
  PGSSL: process.env.PGSSL === 'true',

  REDIS_URL: process.env.REDIS_URL || '',

  // 上游密钥落库加密密钥；缺省回退到 JWT_SECRET，生产务必单独设置
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'change-me-in-production',

  // 下游统一固定接入密钥：所有用户共用同一把，不需要按用户封禁。
  // 可用环境变量 GATEWAY_API_KEY 覆盖，默认 azapp888。
  GATEWAY_API_KEY: process.env.GATEWAY_API_KEY || 'azapp888',

  // 全局令牌限流（0 表示不限制）
  GATEWAY_RPM: Number(process.env.GATEWAY_RPM || 60),
  GATEWAY_CONCURRENCY: Number(process.env.GATEWAY_CONCURRENCY || 5),
  GATEWAY_TPM: Number(process.env.GATEWAY_TPM || 60000),
  GATEWAY_DAILY_TOKEN_LIMIT: Number(process.env.GATEWAY_DAILY_TOKEN_LIMIT || 0),

  // 初始管理员（首次启动/seed 时创建）
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',

  // 未配置任何上游密钥时，自动进入 mock 上游，方便本地联调
  MOCK_UPSTREAM:
    process.env.MOCK_UPSTREAM === 'true' || (process.env.MOCK_UPSTREAM !== 'false' && !hasUpstreamKeys),

  // 默认 max_tokens（用于 TPM/额度预估）
  DEFAULT_MAX_TOKENS: Number(process.env.DEFAULT_MAX_TOKENS || 1024),

  // 三家上游：端点与密钥（密钥会加密写入 channels 表）
  UPSTREAM_DEEPSEEK_BASE_URL:
    process.env.UPSTREAM_DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  UPSTREAM_DEEPSEEK_KEY: process.env.UPSTREAM_DEEPSEEK_KEY || '',

  UPSTREAM_ALIYUN_BASE_URL:
    process.env.UPSTREAM_ALIYUN_BASE_URL ||
    'https://dashscope.aliyuncs.com/compatible-mode/v1',
  UPSTREAM_ALIYUN_KEY: process.env.UPSTREAM_ALIYUN_KEY || '',

  UPSTREAM_DOUBAO_BASE_URL:
    process.env.UPSTREAM_DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
  UPSTREAM_DOUBAO_KEY: process.env.UPSTREAM_DOUBAO_KEY || '',
};
