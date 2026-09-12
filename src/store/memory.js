'use strict';

// 内存存储：零依赖本地跑通用（GATEWAY_STORE=memory）。
// 数据不持久化，仅用于开发联调与演示；生产请使用 postgres。

const { hashPassword } = require('../lib/password');
const { defaultChannels, defaultMappings, defaultUserId, newId } = require('./seed');

const state = {
  users: [],
  channels: [],
  tokens: [],
  mappings: [],
  usage: [],
  initialized: false,
};

async function ensureSeed() {
  if (state.users.length === 0) {
    state.users.push({
      id: defaultUserId(),
      username: require('../config').ADMIN_USERNAME,
      password_hash: hashPassword(require('../config').ADMIN_PASSWORD),
      role: 'admin',
      status: 'active',
      created_at: new Date(),
    });
  }
  if (state.channels.length === 0) state.channels.push(...defaultChannels());
  if (state.mappings.length === 0) state.mappings.push(...defaultMappings());
}

async function init() {
  await ensureSeed();
  state.initialized = true;
}

// ---------------- users ----------------

async function findUserByUsername(username) {
  return state.users.find((u) => u.username === username) || null;
}

async function findUserById(id) {
  return state.users.find((u) => u.id === id) || null;
}

async function createUser({ username, password_hash, role = 'user', status = 'active' }) {
  const user = {
    id: newId(),
    username,
    password_hash,
    role,
    status,
    created_at: new Date(),
  };
  state.users.push(user);
  return user;
}

async function listUsers() {
  return state.users.map((u) => ({ ...u }));
}

// ---------------- tokens ----------------

async function findTokenByHash(keyHash) {
  const token = state.tokens.find((t) => t.key_hash === keyHash) || null;
  if (!token) return null;
  const user = state.users.find((u) => u.id === token.user_id) || null;
  return { ...token, username: user ? user.username : null };
}

async function getTokenById(id) {
  return state.tokens.find((t) => t.id === id) || null;
}

async function createToken(data) {
  const token = {
    id: newId(),
    status: 'active',
    created_at: new Date(),
    last_used_at: null,
    expires_at: data.expires_at || null,
    ...data,
  };
  state.tokens.push(token);
  return token;
}

async function listTokens({ userId } = {}) {
  return state.tokens.filter((t) => !userId || t.user_id === userId).map((t) => ({ ...t }));
}

async function updateToken(id, patch) {
  const token = state.tokens.find((t) => t.id === id);
  if (!token) return null;
  Object.assign(token, patch);
  return { ...token };
}

async function revokeToken(id) {
  return updateToken(id, { status: 'disabled' });
}

async function touchToken(id) {
  const token = state.tokens.find((t) => t.id === id);
  if (token) token.last_used_at = new Date();
}

// ---------------- channels ----------------

async function listChannels() {
  return state.channels.map((c) => ({ ...c }));
}

async function getChannelById(id) {
  return state.channels.find((c) => c.id === id) || null;
}

async function createChannel(data) {
  const channel = { id: newId(), status: 'active', created_at: new Date(), ...data };
  state.channels.push(channel);
  return channel;
}

async function updateChannel(id, patch) {
  const channel = state.channels.find((c) => c.id === id);
  if (!channel) return null;
  Object.assign(channel, patch);
  return { ...channel };
}

// ---------------- model mappings ----------------

async function listMappings({ enabledOnly = false } = {}) {
  return state.mappings
    .filter((m) => !enabledOnly || m.enabled)
    .map((m) => {
      const channel = state.channels.find((c) => c.id === m.channel_id);
      return {
        ...m,
        provider: channel ? channel.provider : null,
        base_url: channel ? channel.base_url : null,
        channel_status: channel ? channel.status : null,
      };
    });
}

async function getMappingByModel(modelName) {
  const mapping = state.mappings.find((m) => m.model_name === modelName && m.enabled) || null;
  if (!mapping) return null;
  const channel = state.channels.find((c) => c.id === mapping.channel_id) || null;
  if (!channel || channel.status !== 'active') return null;
  return {
    model_name: mapping.model_name,
    upstream_model: mapping.upstream_model,
    channel: { ...channel },
  };
}

async function createMapping(data) {
  const mapping = { id: newId(), enabled: true, created_at: new Date(), ...data };
  state.mappings.push(mapping);
  return mapping;
}

async function updateMapping(id, patch) {
  const mapping = state.mappings.find((m) => m.id === id);
  if (!mapping) return null;
  Object.assign(mapping, patch);
  return { ...mapping };
}

// ---------------- usage ----------------

async function insertUsage(row) {
  const record = {
    id: newId(),
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    latency_ms: 0,
    status: 200,
    created_at: new Date(),
    ...row,
  };
  state.usage.push(record);
  return record;
}

async function usageSummary({ tokenId, userId, from, to } = {}) {
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const rows = state.usage.filter((r) => {
    if (tokenId && r.token_id !== tokenId) return false;
    if (userId && r.user_id !== userId) return false;
    if (fromDate && r.created_at < fromDate) return false;
    if (toDate && r.created_at > toDate) return false;
    return true;
  });

  const totals = { requests: rows.length, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const byModel = new Map();
  const daily = new Map();
  for (const r of rows) {
    totals.prompt_tokens += r.prompt_tokens || 0;
    totals.completion_tokens += r.completion_tokens || 0;
    totals.total_tokens += r.total_tokens || 0;

    const m = byModel.get(r.model) || { model: r.model, requests: 0, total_tokens: 0 };
    m.requests += 1;
    m.total_tokens += r.total_tokens || 0;
    byModel.set(r.model, m);

    const day = r.created_at.toISOString().slice(0, 10);
    const d = daily.get(day) || { date: day, requests: 0, total_tokens: 0 };
    d.requests += 1;
    d.total_tokens += r.total_tokens || 0;
    daily.set(day, d);
  }

  return {
    totals,
    byModel: Array.from(byModel.values()),
    daily: Array.from(daily.values()).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

module.exports = {
  init,
  findUserByUsername,
  findUserById,
  createUser,
  listUsers,
  findTokenByHash,
  getTokenById,
  createToken,
  listTokens,
  updateToken,
  revokeToken,
  touchToken,
  listChannels,
  getChannelById,
  createChannel,
  updateChannel,
  listMappings,
  getMappingByModel,
  createMapping,
  updateMapping,
  insertUsage,
  usageSummary,
};
