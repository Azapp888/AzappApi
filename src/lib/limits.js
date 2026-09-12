'use strict';

// token 预估与 IP 白名单匹配

// 粗略估算 token：英文约 4 字符 1 token，中文约 1 字符 1 token，
// 取 3 字符/token 作为折中。真实值以响应 usage 为准，预估值只用于额度预留。
function estimateTokens(input) {
  if (input === null || input === undefined) return 0;
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return Math.max(1, Math.ceil(text.length / 3));
}

function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, m) => {
    const content = typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '');
    return sum + estimateTokens(content) + 4;
  }, 3);
}

// 提取客户端真实 IP：优先取 X-Forwarded-For 第一段
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const raw = xff || req.socket?.remoteAddress || req.ip || '';
  return raw.replace(/^::ffff:/, '');
}

// 白名单元素支持精确 IP、前缀通配（203.0.113.*）与 * 全放行
function ipMatches(whitelist, ip) {
  const list = String(whitelist || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return true;
  for (const entry of list) {
    if (entry === '*') return true;
    if (entry.endsWith('*')) {
      if (ip.startsWith(entry.slice(0, -1))) return true;
    } else if (entry === ip) {
      return true;
    }
  }
  return false;
}

module.exports = { estimateTokens, estimateMessagesTokens, clientIp, ipMatches };
