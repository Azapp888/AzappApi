'use strict';

// OpenAI 兼容接口：/v1/models、/v1/chat/completions

const { Router } = require('express');

const config = require('../config');
const store = require('../store');
const apiKeyAuth = require('../middleware/apiKey');
const { createRateLimiter } = require('../services/ratelimit');
const { proxyChat } = require('../services/upstream');
const { sendOpenAIError } = require('../lib/openai');
const { estimateMessagesTokens } = require('../lib/limits');

const router = Router();
const STARTED_AT = Math.floor(Date.now() / 1000);

function toModelObject(m) {
  return {
    id: m.model_name,
    object: 'model',
    created: STARTED_AT,
    owned_by: m.provider || 'azapp',
  };
}

router.get('/models', apiKeyAuth, async (req, res) => {
  const mappings = await store.listMappings({ enabledOnly: true });
  res.json({ object: 'list', data: mappings.map(toModelObject) });
});

router.get('/models/:model', apiKeyAuth, async (req, res) => {
  const mapping = await store.getMappingByModel(req.params.model);
  if (!mapping) {
    return sendOpenAIError(res, 404, `模型 ${req.params.model} 不存在。`, 'invalid_request_error', 'model_not_found');
  }
  res.json(toModelObject({ model_name: mapping.model_name, provider: mapping.channel.provider }));
});

router.post('/chat/completions', apiKeyAuth, async (req, res) => {
  const body = req.body || {};
  const token = req.apiKey;

  if (!body.model || typeof body.model !== 'string') {
    return sendOpenAIError(res, 400, '缺少 model 参数。', 'invalid_request_error', 'missing_model');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return sendOpenAIError(res, 400, 'messages 必须是非空数组。', 'invalid_request_error', 'invalid_messages');
  }

  const mapping = await store.getMappingByModel(body.model);
  if (!mapping) {
    return sendOpenAIError(res, 404, `模型 ${body.model} 不存在或未开放。`, 'invalid_request_error', 'model_not_found');
  }

  const maxOut = Number(body.max_tokens || body.max_completion_tokens || config.DEFAULT_MAX_TOKENS) || config.DEFAULT_MAX_TOKENS;
  const promptEstimate = estimateMessagesTokens(body.messages);
  const estimated = promptEstimate + Math.max(1, maxOut);

  const limiter = createRateLimiter();
  const handle = await limiter.preflight(token, estimated);
  if (!handle.ok) {
    if (handle.retryAfter) res.setHeader('Retry-After', String(handle.retryAfter));
    return sendOpenAIError(res, handle.status, handle.message, 'rate_limit_error', handle.code);
  }

  const started = Date.now();
  try {
    const usage = await proxyChat({
      mapping,
      channel: mapping.channel,
      body,
      res,
      promptTokens: promptEstimate,
    });

    await handle.settle(usage.total_tokens);
    await store.insertUsage({
      token_id: token.id,
      user_id: token.user_id,
      model: mapping.model_name,
      provider: mapping.channel.provider,
      channel_id: mapping.channel.id,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      latency_ms: Date.now() - started,
      status: 200,
      ip: req.clientIp,
    });
  } catch (err) {
    await handle.release();
    try {
      await store.insertUsage({
        token_id: token.id,
        user_id: token.user_id,
        model: mapping.model_name,
        provider: mapping.channel.provider,
        channel_id: mapping.channel.id,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        latency_ms: Date.now() - started,
        status: err.status || 502,
        ip: req.clientIp,
      });
    } catch (logErr) {
      console.error('[usage] 写入失败:', logErr.message);
    }
    sendOpenAIError(res, err.status || 502, err.message, err.type || 'api_error', err.code || 'upstream_error');
  }
});

module.exports = router;
