'use strict';

// 上游转发：解密渠道密钥 -> 适配器构造请求 -> fetch -> 归一化响应 / 透传 SSE。
// 返回值为本次请求的真实 token 用量（无法取得 usage 时按文本估算）。

const config = require('../config');
const { decrypt } = require('../lib/crypto');
const { getAdapter } = require('../adapters');
const { estimateTokens } = require('../lib/limits');

class UpstreamError extends Error {
  constructor(status, message, code, type) {
    super(message);
    this.status = status;
    this.code = code || 'upstream_error';
    this.type = type || 'api_error';
  }
}

function parseUpstreamError(status, text) {
  let message = String(text || '').slice(0, 500) || `上游返回 ${status}`;
  let code = 'upstream_error';
  try {
    const json = JSON.parse(text);
    if (json && json.error) {
      message = json.error.message || json.error.code || message;
      code = json.error.code || code;
    } else if (json && json.message) {
      message = json.message;
    }
  } catch (_) {
    /* keep raw text */
  }
  const type = status === 429 ? 'rate_limit_error' : status >= 500 ? 'api_error' : 'invalid_request_error';
  return new UpstreamError(status >= 400 && status < 500 ? status : 502, message, code, type);
}

function estimateUsage(promptTokens, completionText) {
  const completion = estimateTokens(completionText || '');
  return {
    prompt_tokens: Number(promptTokens || 0),
    completion_tokens: completion,
    total_tokens: Number(promptTokens || 0) + completion,
  };
}

async function proxyChat({ mapping, channel, body, res, promptTokens }) {
  const apiKey = decrypt(channel.api_key_enc);
  const adapter = getAdapter(channel.provider);
  const { url, headers, body: payload } = adapter.buildRequest({
    baseUrl: channel.base_url,
    upstreamModel: mapping.upstream_model,
    body,
    apiKey,
  });

  if (config.MOCK_UPSTREAM || !apiKey) {
    return mockChat({ mapping, res, promptTokens, stream: Boolean(payload.stream) });
  }

  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    res.off('close', onClose);
    throw new UpstreamError(502, `连接上游失败：${err.message}`, 'upstream_unreachable', 'api_error');
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    res.off('close', onClose);
    throw parseUpstreamError(upstream.status, text);
  }

  try {
    if (payload.stream) {
      return await streamResponse({ upstream, res, adapter, promptTokens });
    }
    const json = await upstream.json();
    const usage = adapter.extractUsage(json) || estimateUsage(promptTokens, '');
    if (!res.writableEnded) res.status(200).json(json);
    return usage;
  } finally {
    res.off('close', onClose);
  }
}

async function streamResponse({ upstream, res, adapter, promptTokens }) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  let completionText = '';

  try {
    for await (const chunk of upstream.body) {
      const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!res.writableEnded) res.write(piece);
      buffer += decoder.decode(piece, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '').trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const u = adapter.extractUsage(json);
          if (u) usage = u;
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && typeof delta.content === 'string') completionText += delta.content;
        } catch (_) {
          /* 忽略非 JSON 心跳 */
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error('[upstream] 流式读取异常:', err.message);
  } finally {
    if (!res.writableEnded) res.end();
  }

  return usage || estimateUsage(promptTokens, completionText);
}

// 无上游密钥时的本地 mock，方便联调格式与限流
async function mockChat({ mapping, res, promptTokens, stream }) {
  const content = `[mock] 未配置上游密钥，这是对 ${mapping.model_name} 的模拟回复。配置 UPSTREAM_*_KEY 后将转发到真实上游。`;
  const usage = {
    prompt_tokens: Number(promptTokens || 0),
    completion_tokens: estimateTokens(content),
    total_tokens: Number(promptTokens || 0) + estimateTokens(content),
  };
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-mock-${Math.random().toString(36).slice(2, 10)}`;

  if (!stream) {
    res.status(200).json({
      id,
      object: 'chat.completion',
      created,
      model: mapping.model_name,
      choices: [
        { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop', logprobs: null },
      ],
      usage,
    });
    return usage;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const base = { id, object: 'chat.completion.chunk', created, model: mapping.model_name };
  send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  for (const part of content.match(/.{1,12}/g) || []) {
    send({ ...base, choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
  }
  send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  send({ ...base, choices: [], usage });
  res.write('data: [DONE]\n\n');
  res.end();
  return usage;
}

module.exports = { proxyChat, UpstreamError, parseUpstreamError, estimateUsage };
