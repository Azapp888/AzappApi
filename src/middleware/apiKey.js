'use strict';

// 下游 API Key 鉴权：Bearer sk-az-... -> 查库校验状态 / 过期 / IP 白名单

const store = require('../store');
const { hashApiKey } = require('../lib/keys');
const { sendOpenAIError } = require('../lib/openai');
const { clientIp, ipMatches } = require('../lib/limits');

async function apiKeyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!raw) {
    return sendOpenAIError(res, 401, '缺少 API Key，请在 Authorization 头中提供 Bearer 令牌。', 'invalid_request_error', 'invalid_api_key');
  }

  const token = await store.findTokenByHash(hashApiKey(raw));
  if (!token) {
    return sendOpenAIError(res, 401, 'API Key 无效。', 'invalid_request_error', 'invalid_api_key');
  }
  if (token.status !== 'active') {
    return sendOpenAIError(res, 401, 'API Key 已被停用。', 'invalid_request_error', 'invalid_api_key');
  }
  if (token.user_status && token.user_status !== 'active') {
    return sendOpenAIError(res, 401, '账号已被停用。', 'invalid_request_error', 'account_disabled');
  }
  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) {
    return sendOpenAIError(res, 401, 'API Key 已过期。', 'invalid_request_error', 'invalid_api_key');
  }

  const ip = clientIp(req);
  if (!ipMatches(token.ip_whitelist, ip)) {
    return sendOpenAIError(res, 403, `当前 IP ${ip} 不在白名单内。`, 'invalid_request_error', 'ip_not_allowed');
  }

  req.apiKey = token;
  req.clientIp = ip;
  return next();
}

module.exports = apiKeyAuth;
