-- Azapp AI 网关 · PostgreSQL 表结构

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 上游渠道（DeepSeek / 阿里云百炼 / 豆包等）
CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL,              -- deepseek | aliyun | doubao
  base_url    TEXT NOT NULL,
  api_key_enc TEXT NOT NULL DEFAULT '',   -- AES-256-GCM 密文
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 下游令牌
CREATE TABLE IF NOT EXISTS api_tokens (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  name              TEXT NOT NULL,
  key_hash          TEXT UNIQUE NOT NULL,
  key_prefix        TEXT NOT NULL,
  plan              TEXT NOT NULL DEFAULT 'free',   -- free | paid
  rpm               INTEGER NOT NULL DEFAULT 30,
  concurrency       INTEGER NOT NULL DEFAULT 3,
  tpm               INTEGER NOT NULL DEFAULT 20000,
  daily_token_limit BIGINT  NOT NULL DEFAULT 100000,
  ip_whitelist      TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active', -- active | disabled
  expires_at        TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 公开模型名 -> 上游渠道 + 上游模型名
CREATE TABLE IF NOT EXISTS model_mappings (
  id             TEXT PRIMARY KEY,
  model_name     TEXT UNIQUE NOT NULL,
  channel_id     TEXT NOT NULL REFERENCES channels(id),
  upstream_model TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 逐条用量日志
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
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(key_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_token_time ON usage_logs(token_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_user_time ON usage_logs(user_id, created_at);
