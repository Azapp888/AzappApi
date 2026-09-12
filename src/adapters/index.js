'use strict';

// 上游适配器：DeepSeek / 阿里云百炼走 OpenAI 兼容端点，豆包（火山方舟）做字段转换。
// 统一接口：
//   buildRequest({ baseUrl, upstreamModel, body, apiKey }) -> { url, headers, body }
//   extractUsage(payload) -> { prompt_tokens, completion_tokens, total_tokens } | null

function joinUrl(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, '')}${path}`;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const prompt = Number(usage.prompt_tokens || 0);
  const completion = Number(usage.completion_tokens || 0);
  const total = Number(usage.total_tokens || prompt + completion);
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

function withStreamUsage(body, enabled) {
  if (!body.stream) return body;
  if (!enabled) {
    const clone = { ...body };
    delete clone.stream_options;
    return clone;
  }
  return { ...body, stream_options: { ...(body.stream_options || {}), include_usage: true } };
}

// ---- OpenAI 兼容适配器（DeepSeek / 阿里云百炼） ----
function openAICompatible(name) {
  return {
    name,
    supportsStreamUsage: true,
    buildRequest({ baseUrl, upstreamModel, body, apiKey }) {
      const payload = withStreamUsage({ ...body, model: upstreamModel }, true);
      return {
        url: joinUrl(baseUrl, '/chat/completions'),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: payload,
      };
    },
    extractUsage: (payload) => normalizeUsage(payload && payload.usage),
  };
}

// ---- 豆包（火山方舟）适配器 ----
// 方舟 v3 已是 OpenAI 兼容格式，但存在若干字段差异，这里做显式转换。
const doubao = {
  name: 'doubao',
  supportsStreamUsage: process.env.DOUBAO_SUPPORTS_STREAM_USAGE !== 'false',
  buildRequest({ baseUrl, upstreamModel, body, apiKey }) {
    const payload = { ...body, model: upstreamModel };

    // 统一 max_tokens 字段
    if (payload.max_tokens === undefined && payload.max_completion_tokens !== undefined) {
      payload.max_tokens = payload.max_completion_tokens;
    }
    delete payload.max_completion_tokens;

    // 方舟对 stream_options 支持依版本而定，不支持时移除
    if (!this.supportsStreamUsage) {
      delete payload.stream_options;
    } else if (payload.stream) {
      payload.stream_options = { ...(payload.stream_options || {}), include_usage: true };
    }

    // 方舟不支持 n > 1 的并行生成
    if (payload.n && payload.n > 1) payload.n = 1;

    return {
      url: joinUrl(baseUrl, '/chat/completions'),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: payload,
    };
  },
  extractUsage: (payload) => normalizeUsage(payload && payload.usage),
};

const ADAPTERS = {
  deepseek: openAICompatible('deepseek'),
  aliyun: openAICompatible('aliyun'),
  doubao,
};

function getAdapter(provider) {
  return ADAPTERS[provider] || openAICompatible(provider);
}

module.exports = { getAdapter, ADAPTERS, normalizeUsage, joinUrl };
