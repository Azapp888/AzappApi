'use strict';

// SQLite 存储：单文件、零外部服务，适合小内存 / 小 eMMC 的单机（如 RK3566 4GB + 8GB eMMC）。
// 依赖 Node 内置 node:sqlite（Node >= 22）。首次启动自动建表并写入种子数据（幂等）。
// 数据文件建议放在 SATA 盘（SQLITE_PATH），避免写满 eMMC。

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const config = require('../config');
const { hashPassword } = require('../lib/password');
const { defaultChannels, defaultMappings, defaultUserId, newId } = require('./seed');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  api_key_enc TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  name              TEXT NOT NULL,
  key_hash          TEXT UNIQUE NOT NULL,
  key_prefix        TEXT NOT NULL,
  plan              TEXT NOT NULL DEFAULT 'free',
  rpm               INTEGER NOT NULL DEFAULT 30,
  concurrency       INTEGER NOT NULL DEFAULT 3,
  tpm               INTEGER NOT NULL DEFAULT 20000,
  daily_token_limit INTEGER NOT NULL DEFAULT 100000,
  ip_whitelist      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active',
  expires_at        TEXT,
  last_used_at      TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_mappings (
  id             TEXT PRIMARY KEY,
  model_name     TEXT UNIQUE NOT NULL,
  channel_id     TEXT NOT NULL,
  upstream_model TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id                TEXT PRIMARY KEY,
  token_id          TEXT,
  user_id           TEXT,
  model             TEXT,
  provider          TEXT,
  channel_id        TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  status            INTEGER NOT NULL DEFAULT 200,
  ip                TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(key_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_token_time ON usage_logs(token_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_logs(user_id, created_at);
`;

let db = null;

function nowIso() {
  return new Date().toISOString();
}

function getDb() {
  if (db) return db;
  const file = path.resolve(process.cwd(), config.SQLITE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  // WAL 降低写放大、提升并发读；放在 SATA 盘可减少 eMMC 磨损
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function init() {
  const d = getDb();
  d.exec(SCHEMA_SQL);

  d.prepare(
    `INSERT INTO users (id, username, password_hash, role, status, created_at)
     VALUES (?, ?, ?, 'admin', 'active', ?)
     ON CONFLICT(username) DO NOTHING`
  ).run(defaultUserId(), config.ADMIN_USERNAME, hashPassword(config.ADMIN_PASSWORD), nowIso());

  const insertChannel = d.prepare(
    `INSERT INTO channels (id, name, provider, base_url, api_key_enc, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)
     ON CONFLICT(id) DO NOTHING`
  );
  for (const ch of defaultChannels()) {
    insertChannel.run(ch.id, ch.name, ch.provider, ch.base_url, ch.api_key_enc, nowIso());
  }

  const insertMapping = d.prepare(
    `INSERT INTO model_mappings (id, model_name, channel_id, upstream_model, enabled, created_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(model_name) DO NOTHING`
  );
  for (const m of defaultMappings()) {
    insertMapping.run(m.id, m.model_name, m.channel_id, m.upstream_model, nowIso());
  }
  return Promise.resolve();
}

// ---------------- users ----------------

async function findUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

async function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

async function createUser({ username, password_hash, role = 'user', status = 'active' }) {
  const user = { id: newId(), username, password_hash, role, status, created_at: nowIso() };
  getDb()
    .prepare('INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, user.username, user.password_hash, user.role, user.status, user.created_at);
  return user;
}

async function listUsers() {
  return getDb().prepare('SELECT id, username, role, status, created_at FROM users ORDER BY created_at').all();
}

// ---------------- tokens ----------------

async function findTokenByHash(keyHash) {
  return (
    getDb()
      .prepare(
        `SELECT t.*, u.username, u.status AS user_status
         FROM api_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.key_hash = ?`
      )
      .get(keyHash) || null
  );
}

async function getTokenById(id) {
  return getDb().prepare('SELECT * FROM api_tokens WHERE id = ?').get(id) || null;
}

async function createToken(data) {
  const token = {
    id: newId(),
    status: 'active',
    created_at: nowIso(),
    last_used_at: null,
    ...data,
  };
  getDb()
    .prepare(
      `INSERT INTO api_tokens
        (id, user_id, name, key_hash, key_prefix, plan, rpm, concurrency, tpm, daily_token_limit, ip_whitelist, status, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      token.id,
      token.user_id,
      token.name,
      token.key_hash,
      token.key_prefix,
      token.plan || 'free',
      token.rpm,
      token.concurrency,
      token.tpm,
      token.daily_token_limit,
      token.ip_whitelist || '',
      token.status,
      token.expires_at || null,
      token.created_at
    );
  return token;
}

async function listTokens({ userId } = {}) {
  if (userId) {
    return getDb().prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }
  return getDb().prepare('SELECT * FROM api_tokens ORDER BY created_at DESC').all();
}

const TOKEN_PATCH_COLUMNS = new Set([
  'name',
  'plan',
  'rpm',
  'concurrency',
  'tpm',
  'daily_token_limit',
  'ip_whitelist',
  'status',
  'expires_at',
]);

async function updateToken(id, patch) {
  const keys = Object.keys(patch).filter((k) => TOKEN_PATCH_COLUMNS.has(k));
  if (keys.length === 0) return getTokenById(id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE api_tokens SET ${sets} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), id);
  return getTokenById(id);
}

async function revokeToken(id) {
  return updateToken(id, { status: 'disabled' });
}

async function touchToken(id) {
  getDb().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), id);
}

// ---------------- channels ----------------

async function listChannels() {
  return getDb().prepare('SELECT * FROM channels ORDER BY created_at').all();
}

async function getChannelById(id) {
  return getDb().prepare('SELECT * FROM channels WHERE id = ?').get(id) || null;
}

async function createChannel(data) {
  const channel = {
    id: newId(),
    name: data.name,
    provider: data.provider,
    base_url: data.base_url,
    api_key_enc: data.api_key_enc || '',
    status: data.status || 'active',
    created_at: nowIso(),
  };
  getDb()
    .prepare('INSERT INTO channels (id, name, provider, base_url, api_key_enc, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(channel.id, channel.name, channel.provider, channel.base_url, channel.api_key_enc, channel.status, channel.created_at);
  return channel;
}

async function updateChannel(id, patch) {
  const allowed = ['name', 'provider', 'base_url', 'api_key_enc', 'status'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return getChannelById(id);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE channels SET ${sets} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), id);
  return getChannelById(id);
}

// ---------------- model mappings ----------------

async function listMappings({ enabledOnly = false } = {}) {
  const where = enabledOnly ? 'WHERE m.enabled = 1' : '';
  const rows = getDb()
    .prepare(
      `SELECT m.*, c.provider, c.base_url, c.status AS channel_status
       FROM model_mappings m JOIN channels c ON c.id = m.channel_id
       ${where} ORDER BY m.model_name`
    )
    .all();
  return rows.map((r) => ({ ...r, enabled: Boolean(r.enabled) }));
}

async function getMappingByModel(modelName) {
  const row = getDb()
    .prepare(
      `SELECT m.model_name, m.upstream_model,
              c.id AS channel_id, c.provider, c.base_url, c.api_key_enc, c.status AS channel_status
       FROM model_mappings m JOIN channels c ON c.id = m.channel_id
       WHERE m.model_name = ? AND m.enabled = 1 AND c.status = 'active'`
    )
    .get(modelName);
  if (!row) return null;
  return {
    model_name: row.model_name,
    upstream_model: row.upstream_model,
    channel: {
      id: row.channel_id,
      provider: row.provider,
      base_url: row.base_url,
      api_key_enc: row.api_key_enc,
      status: row.channel_status,
    },
  };
}

async function createMapping(data) {
  const mapping = {
    id: newId(),
    model_name: data.model_name,
    channel_id: data.channel_id,
    upstream_model: data.upstream_model,
    enabled: data.enabled !== false ? 1 : 0,
    created_at: nowIso(),
  };
  getDb()
    .prepare('INSERT INTO model_mappings (id, model_name, channel_id, upstream_model, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(mapping.id, mapping.model_name, mapping.channel_id, mapping.upstream_model, mapping.enabled, mapping.created_at);
  return { ...mapping, enabled: Boolean(mapping.enabled) };
}

async function updateMapping(id, patch) {
  const allowed = ['model_name', 'channel_id', 'upstream_model', 'enabled'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return null;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE model_mappings SET ${sets} WHERE id = ?`)
    .run(...keys.map((k) => (k === 'enabled' ? (patch[k] ? 1 : 0) : patch[k])), id);
  const row = getDb().prepare('SELECT * FROM model_mappings WHERE id = ?').get(id);
  return row ? { ...row, enabled: Boolean(row.enabled) } : null;
}

// ---------------- usage ----------------

async function insertUsage(row) {
  getDb()
    .prepare(
      `INSERT INTO usage_logs
        (id, token_id, user_id, model, provider, channel_id, prompt_tokens, completion_tokens, total_tokens, latency_ms, status, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId(),
      row.token_id,
      row.user_id,
      row.model,
      row.provider,
      row.channel_id,
      row.prompt_tokens || 0,
      row.completion_tokens || 0,
      row.total_tokens || 0,
      row.latency_ms || 0,
      row.status || 200,
      row.ip || null,
      nowIso()
    );
}

async function usageSummary({ tokenId, userId, from, to } = {}) {
  const conds = [];
  const params = [];
  if (tokenId) {
    params.push(tokenId);
    conds.push('token_id = ?');
  }
  if (userId) {
    params.push(userId);
    conds.push('user_id = ?');
  }
  if (from) {
    params.push(new Date(from).toISOString());
    conds.push('created_at >= ?');
  }
  if (to) {
    params.push(new Date(to).toISOString());
    conds.push('created_at <= ?');
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const d = getDb();

  const totals = d
    .prepare(
      `SELECT COUNT(*) AS requests,
              COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens),0) AS completion_tokens,
              COALESCE(SUM(total_tokens),0) AS total_tokens
       FROM usage_logs ${where}`
    )
    .get(...params);
  const byModel = d
    .prepare(
      `SELECT model, COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS total_tokens
       FROM usage_logs ${where} GROUP BY model ORDER BY total_tokens DESC`
    )
    .all(...params);
  const daily = d
    .prepare(
      `SELECT substr(created_at, 1, 10) AS date,
              COUNT(*) AS requests,
              COALESCE(SUM(total_tokens),0) AS total_tokens
       FROM usage_logs ${where} GROUP BY 1 ORDER BY 1`
    )
    .all(...params);

  return { totals, byModel, daily };
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
