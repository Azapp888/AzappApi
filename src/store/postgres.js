'use strict';

// PostgreSQL 存储：生产默认。首次启动自动建表并写入种子数据（幂等）。

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const config = require('../config');
const { hashPassword } = require('../lib/password');
const { defaultChannels, defaultMappings, defaultUserId, newId } = require('./seed');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: config.PGSSL ? { rejectUnauthorized: false } : undefined,
});

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

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

async function init() {
  await pool.query(SCHEMA_SQL);

  await pool.query(
    `INSERT INTO users (id, username, password_hash, role, status)
     VALUES ($1, $2, $3, 'admin', 'active')
     ON CONFLICT (username) DO NOTHING`,
    [defaultUserId(), config.ADMIN_USERNAME, hashPassword(config.ADMIN_PASSWORD)]
  );

  for (const ch of defaultChannels()) {
    await pool.query(
      `INSERT INTO channels (id, name, provider, base_url, api_key_enc, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [ch.id, ch.name, ch.provider, ch.base_url, ch.api_key_enc]
    );
  }

  for (const m of defaultMappings()) {
    await pool.query(
      `INSERT INTO model_mappings (id, model_name, channel_id, upstream_model, enabled)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (model_name) DO NOTHING`,
      [m.id, m.model_name, m.channel_id, m.upstream_model]
    );
  }
}

// ---------------- users ----------------

async function findUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createUser({ username, password_hash, role = 'user', status = 'active' }) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, username, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [newId(), username, password_hash, role, status]
  );
  return rows[0];
}

async function listUsers() {
  const { rows } = await pool.query('SELECT id, username, role, status, created_at FROM users ORDER BY created_at');
  return rows;
}

// ---------------- tokens ----------------

async function findTokenByHash(keyHash) {
  const { rows } = await pool.query(
    `SELECT t.*, u.username, u.status AS user_status
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.key_hash = $1`,
    [keyHash]
  );
  return rows[0] || null;
}

async function getTokenById(id) {
  const { rows } = await pool.query('SELECT * FROM api_tokens WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createToken(data) {
  const { rows } = await pool.query(
    `INSERT INTO api_tokens
       (id, user_id, name, key_hash, key_prefix, plan, rpm, concurrency, tpm, daily_token_limit, ip_whitelist, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      newId(),
      data.user_id,
      data.name,
      data.key_hash,
      data.key_prefix,
      data.plan || 'free',
      data.rpm,
      data.concurrency,
      data.tpm,
      data.daily_token_limit,
      data.ip_whitelist || '',
      data.expires_at || null,
    ]
  );
  return rows[0];
}

async function listTokens({ userId } = {}) {
  if (userId) {
    const { rows } = await pool.query('SELECT * FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM api_tokens ORDER BY created_at DESC');
  return rows;
}

async function updateToken(id, patch) {
  const keys = Object.keys(patch).filter((k) => TOKEN_PATCH_COLUMNS.has(k));
  if (keys.length === 0) return getTokenById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => patch[k]);
  const { rows } = await pool.query(`UPDATE api_tokens SET ${sets} WHERE id = $1 RETURNING *`, [id, ...values]);
  return rows[0] || null;
}

async function revokeToken(id) {
  return updateToken(id, { status: 'disabled' });
}

async function touchToken(id) {
  await pool.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [id]);
}

// ---------------- channels ----------------

async function listChannels() {
  const { rows } = await pool.query('SELECT * FROM channels ORDER BY created_at');
  return rows;
}

async function getChannelById(id) {
  const { rows } = await pool.query('SELECT * FROM channels WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createChannel(data) {
  const { rows } = await pool.query(
    `INSERT INTO channels (id, name, provider, base_url, api_key_enc, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [newId(), data.name, data.provider, data.base_url, data.api_key_enc || '', data.status || 'active']
  );
  return rows[0];
}

async function updateChannel(id, patch) {
  const allowed = ['name', 'provider', 'base_url', 'api_key_enc', 'status'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return getChannelById(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(`UPDATE channels SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => patch[k])]);
  return rows[0] || null;
}

// ---------------- model mappings ----------------

async function listMappings({ enabledOnly = false } = {}) {
  const where = enabledOnly ? 'WHERE m.enabled = true' : '';
  const { rows } = await pool.query(
    `SELECT m.*, c.provider, c.base_url, c.status AS channel_status
     FROM model_mappings m JOIN channels c ON c.id = m.channel_id
     ${where} ORDER BY m.model_name`
  );
  return rows;
}

async function getMappingByModel(modelName) {
  const { rows } = await pool.query(
    `SELECT m.model_name, m.upstream_model,
            c.id AS channel_id, c.provider, c.base_url, c.api_key_enc, c.status AS channel_status
     FROM model_mappings m JOIN channels c ON c.id = m.channel_id
     WHERE m.model_name = $1 AND m.enabled = true AND c.status = 'active'`,
    [modelName]
  );
  const row = rows[0];
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
  const { rows } = await pool.query(
    `INSERT INTO model_mappings (id, model_name, channel_id, upstream_model, enabled)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [newId(), data.model_name, data.channel_id, data.upstream_model, data.enabled !== false]
  );
  return rows[0];
}

async function updateMapping(id, patch) {
  const allowed = ['model_name', 'channel_id', 'upstream_model', 'enabled'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length === 0) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(`UPDATE model_mappings SET ${sets} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => patch[k])]);
  return rows[0] || null;
}

// ---------------- usage ----------------

async function insertUsage(row) {
  await pool.query(
    `INSERT INTO usage_logs
       (id, token_id, user_id, model, provider, channel_id, prompt_tokens, completion_tokens, total_tokens, latency_ms, status, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
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
    ]
  );
}

async function usageSummary({ tokenId, userId, from, to } = {}) {
  const conds = [];
  const params = [];
  if (tokenId) {
    params.push(tokenId);
    conds.push(`token_id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conds.push(`user_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    conds.push(`created_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    conds.push(`created_at <= $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const totalsQ = pool.query(
    `SELECT COUNT(*)::int AS requests,
            COALESCE(SUM(prompt_tokens),0)::bigint AS prompt_tokens,
            COALESCE(SUM(completion_tokens),0)::bigint AS completion_tokens,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens
     FROM usage_logs ${where}`,
    params
  );
  const byModelQ = pool.query(
    `SELECT model, COUNT(*)::int AS requests, COALESCE(SUM(total_tokens),0)::bigint AS total_tokens
     FROM usage_logs ${where} GROUP BY model ORDER BY total_tokens DESC`,
    params
  );
  const dailyQ = pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS date,
            COUNT(*)::int AS requests,
            COALESCE(SUM(total_tokens),0)::bigint AS total_tokens
     FROM usage_logs ${where}
     GROUP BY 1 ORDER BY 1`,
    params
  );

  const [totals, byModel, daily] = await Promise.all([totalsQ, byModelQ, dailyQ]);
  return { totals: totals.rows[0], byModel: byModel.rows, daily: daily.rows };
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
