'use strict';

// OpenAI Responses API <-> Chat Completions 转换。
// 上游三家只提供 chat/completions 风格接口，这里在网关侧做协议适配，
// 让 /v1/responses 对外可用。

const { id, nowSec } = require('../lib/openai');

// 从 Responses 的 content 提取 chat 可用内容（支持纯文本与图片）
function contentToChat(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
      parts.push({ type: 'text', text: part.text || '' });
    } else if (part.type === 'input_image' && part.image_url) {
      parts.push({ type: 'image_url', image_url: { url: part.image_url } });
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  return parts;
}

// Responses 请求 -> chat.completions 请求（字段白名单，避免上游拒绝未知参数）
const CHAT_PASSTHROUGH_FIELDS = [
  'temperature',
  'top_p',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'stop',
  'n',
  'user',
  'response_format',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'stream',
];

function responsesToChat(body) {
  const messages = [];

  if (body.instructions) messages.push({ role: 'system', content: String(body.instructions) });

  const input = body.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        messages.push({ role: 'user', content: item });
        continue;
      }
      if (!item || typeof item !== 'object') continue;

      if (item.type === 'message' || item.role) {
        messages.push({ role: item.role || 'user', content: contentToChat(item.content) });
      } else if (item.type === 'input_text') {
        messages.push({ role: 'user', content: item.text || '' });
      }
      // 其余类型（function_call_output 等）暂不支持，忽略
    }
  }

  if (messages.length === 0) messages.push({ role: 'user', content: '' });

  const chat = { model: body.model, messages };
  for (const field of CHAT_PASSTHROUGH_FIELDS) {
    if (body[field] !== undefined) chat[field] = body[field];
  }

  const maxOut = body.max_output_tokens !== undefined ? body.max_output_tokens : body.max_tokens;
  if (maxOut !== undefined) chat.max_tokens = maxOut;

  return chat;
}

function extractText(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === 'object' ? p.text || '' : String(p || '')))
      .join('');
  }
  return '';
}

function usageToResponses(usage) {
  return {
    input_tokens: (usage && usage.prompt_tokens) || 0,
    output_tokens: (usage && usage.completion_tokens) || 0,
    total_tokens: (usage && usage.total_tokens) || 0,
  };
}

// chat.completions 响应 -> Responses 响应对象
function chatToResponse(chat, model, responseId) {
  const choice = (chat.choices && chat.choices[0]) || {};
  const text = extractText(choice.message);
  return buildResponse({ responseId, model, text, usage: chat.usage, created: chat.created });
}

function buildResponse({ responseId, model, text, usage, created, status = 'completed' }) {
  const messageId = id('msg');
  return {
    id: responseId,
    object: 'response',
    created_at: created || nowSec(),
    status,
    model,
    output: [
      {
        id: messageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    output_text: text,
    parallel_tool_calls: true,
    tool_calls: [],
    usage: usageToResponses(usage),
  };
}

// 流式翻译：消费 chat SSE，输出 Responses 风格事件，返回真实 usage
function createResponsesStream({ res, model, responseId }) {
  const created = nowSec();
  const messageId = id('msg');
  let text = '';
  let usage = null;
  let finished = false;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  function write(event, data) {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const skeleton = () => ({
    id: responseId,
    object: 'response',
    created_at: created,
    model,
    output: [],
    output_text: text,
  });

  write('response.created', { type: 'response.created', response: { ...skeleton(), status: 'in_progress' } });
  write('response.in_progress', { type: 'response.in_progress', response: { ...skeleton(), status: 'in_progress' } });
  write('response.output_item.added', {
    type: 'response.output_item.added',
    output_index: 0,
    item: { id: messageId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
  });
  write('response.content_part.added', {
    type: 'response.content_part.added',
    item_id: messageId,
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });

  return {
    onDelta(delta) {
      if (!delta) return;
      text += delta;
      write('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        delta,
      });
    },
    onUsage(u) {
      if (u) usage = u;
    },
    finish() {
      if (finished) return;
      finished = true;
      write('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        text,
      });
      write('response.content_part.done', {
        type: 'response.content_part.done',
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text, annotations: [] },
      });
      write('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          id: messageId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      });
      const completed = buildResponse({ responseId, model, text, usage, created });
      write('response.completed', { type: 'response.completed', response: completed });
      if (!res.writableEnded) res.end();
    },
    getText: () => text,
    getUsage: () => usage,
  };
}

module.exports = {
  responsesToChat,
  chatToResponse,
  buildResponse,
  createResponsesStream,
  contentToChat,
};
