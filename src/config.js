'use strict';

// 统一配置入口：所有环境变量在这里读取并给默认值
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
};
