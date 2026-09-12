'use strict';

// 下游 API Key 鉴权：全局固定密钥（默认 azapp888）。
// 所有用户共用同一把 Key，不做按用户/按令牌的封禁。

const crypto = require('crypto');

const config = require('../config');
const { sendOpenAIError } = require('../lib/openai');
const { clientIp } = require('../lib/limits');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function apiKeyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!raw) {
    return sendOpenAIError(res, 401, '缺少 API Key，请在 Authorization 头中提供 Bearer 令牌。', 'invalid_request_error', 'invalid_api_key');
  }
  if (!safeEqual(raw, config.GATEWAY_API_KEY)) {
    return sendOpenAIError(res, 401, 'API Key 无效。', 'invalid_request_error', 'invalid_api_key');
  }

  req.apiKey = {
    id: 'global',
    user_id: null,
    plan: 'global',
    rpm: config.GATEWAY_RPM,
    concurrency: config.GATEWAY_CONCURRENCY,
    tpm: config.GATEWAY_TPM,
    daily_token_limit: config.GATEWAY_DAILY_TOKEN_LIMIT,
  };
  req.clientIp = clientIp(req);
  return next();
}

module.exports = apiKeyAuth;
