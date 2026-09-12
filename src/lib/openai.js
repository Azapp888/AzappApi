'use strict';

const crypto = require('crypto');

// 生成 OpenAI 风格的对象 id，如 chatcmpl-xxxx
function id(prefix) {
  return `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// 统一的 OpenAI 错误对象
function errorBody(message, type = 'invalid_request_error', code = null, param = null) {
  return { error: { message, type, param, code } };
}

// 向客户端返回 OpenAI 风格错误；已发送响应头时静默放弃
function sendOpenAIError(res, status, message, type, code) {
  if (res.headersSent || res.writableEnded) {
    try {
      res.end();
    } catch (_) {
      /* ignore */
    }
    return;
  }
  res.status(status).json(errorBody(message, type, code));
}

module.exports = { id, nowSec, errorBody, sendOpenAIError };
