'use strict';

// 限流：RPM / 并发 / TPM / 日额度。
// 采用「预留-结算」：请求前按 (prompt 预估 + max_tokens) 预留额度，
// 响应后按上游真实 usage 结算差额，避免单次大请求击穿 TPM / 日额度。

const { getRedis } = require('../lib/redis');

const PREFIX = 'azrl:';

// ---------------- Redis Lua（原子操作） ----------------

// 固定窗口计数：KEYS[1]=key, ARGV[1]=limit, ARGV[2]=ttlMs
const LUA_COUNT_WINDOW = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2])) end
if c > tonumber(ARGV[1]) then return {0, c} end
return {1, c}
`;

// 并发获取：KEYS[1]=key, ARGV[1]=limit, ARGV[2]=ttlMs
const LUA_CONC_ACQUIRE = `
local c = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
if c > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

// 并发释放
const LUA_CONC_RELEASE = `
local c = redis.call('DECR', KEYS[1])
if c <= 0 then redis.call('DEL', KEYS[1]) end
return c
`;

// 预留额度：KEYS[1]=key, ARGV[1]=limit, ARGV[2]=amount, ARGV[3]=ttlMs
const LUA_RESERVE = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
if used + amount > limit then return {0, used} end
local v = redis.call('INCRBY', KEYS[1], amount)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return {1, v}
`;

// 结算/回滚：KEYS[1]=key, ARGV[1]=delta
const LUA_SETTLE = `
local v = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
if v < 0 then redis.call('SET', KEYS[1], '0'); v = 0 end
return v
`;

// ---------------- 工具 ----------------

function localDay(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function secondsUntilTomorrow(now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(60, Math.floor((end.getTime() - now.getTime()) / 1000));
}

function fail(code, message, retryAfter) {
  return { ok: false, status: 429, code, message, retryAfter };
}

// ---------------- Redis 实现 ----------------

class RedisRateLimiter {
  constructor(redis) {
    this.redis = redis;
  }

  async preflight(token, estimatedTokens) {
    const minute = Math.floor(Date.now() / 60000);

    const rpmKey = `${PREFIX}rpm:${token.id}:${minute}`;
    if (token.rpm > 0) {
      const rpm = await this.redis.eval(LUA_COUNT_WINDOW, 1, rpmKey, token.rpm, 60000);
      if (Number(rpm[0]) === 0) {
        return fail('rate_limit_exceeded', `每分钟请求数超过限制（${token.rpm} RPM）`, 60);
      }
    }

    const concKey = `${PREFIX}conc:${token.id}`;
    if (token.concurrency > 0) {
      const acquired = await this.redis.eval(LUA_CONC_ACQUIRE, 1, concKey, token.concurrency, 300000);
      if (Number(acquired) === 0) {
        return fail('rate_limit_exceeded', `并发数超过限制（${token.concurrency}）`, 5);
      }
    }

    const tpmKey = `${PREFIX}tpm:${token.id}:${minute}`;
    if (token.tpm > 0) {
      const tpm = await this.redis.eval(LUA_RESERVE, 1, tpmKey, token.tpm, estimatedTokens, 60000);
      if (Number(tpm[0]) === 0) {
        if (token.concurrency > 0) await this.redis.eval(LUA_CONC_RELEASE, 1, concKey);
        return fail('rate_limit_exceeded', `每分钟 token 数超过限制（${token.tpm} TPM）`, 60);
      }
    }

    const dayKey = `${PREFIX}day:${token.id}:${localDay()}`;
    if (token.daily_token_limit > 0) {
      const daily = await this.redis.eval(
        LUA_RESERVE,
        1,
        dayKey,
        token.daily_token_limit,
        estimatedTokens,
        secondsUntilTomorrow()
      );
      if (Number(daily[0]) === 0) {
        if (token.tpm > 0) await this.redis.eval(LUA_SETTLE, 1, tpmKey, -estimatedTokens);
        if (token.concurrency > 0) await this.redis.eval(LUA_CONC_RELEASE, 1, concKey);
        return fail('insufficient_quota', '今日 token 额度已用尽', 3600);
      }
    }

    const self = this;
    return {
      ok: true,
      reserved: estimatedTokens,
      async settle(actualTokens) {
        const delta = Number(actualTokens || 0) - estimatedTokens;
        if (delta !== 0) {
          if (token.tpm > 0) await self._safe(() => self.redis.eval(LUA_SETTLE, 1, tpmKey, delta));
          if (token.daily_token_limit > 0) await self._safe(() => self.redis.eval(LUA_SETTLE, 1, dayKey, delta));
        }
        if (token.concurrency > 0) await self._safe(() => self.redis.eval(LUA_CONC_RELEASE, 1, concKey));
      },
      async release() {
        if (token.tpm > 0) await self._safe(() => self.redis.eval(LUA_SETTLE, 1, tpmKey, -estimatedTokens));
        if (token.daily_token_limit > 0) await self._safe(() => self.redis.eval(LUA_SETTLE, 1, dayKey, -estimatedTokens));
        if (token.concurrency > 0) await self._safe(() => self.redis.eval(LUA_CONC_RELEASE, 1, concKey));
      },
    };
  }

  async _safe(fn) {
    try {
      await fn();
    } catch (err) {
      console.error('[ratelimit]', err.message);
    }
  }
}

// ---------------- 内存实现（本地开发/演示） ----------------

class MemoryRateLimiter {
  constructor() {
    this.windows = new Map(); // key -> { value, expire }
    this.concurrency = new Map(); // tokenId -> { value, expire }
  }

  _window(key, ttlMs) {
    const now = Date.now();
    const rec = this.windows.get(key);
    if (!rec || rec.expire <= now) {
      const fresh = { value: 0, expire: now + ttlMs };
      this.windows.set(key, fresh);
      return fresh;
    }
    return rec;
  }

  _reserve(key, limit, amount, ttlMs) {
    const rec = this._window(key, ttlMs);
    if (rec.value + amount > limit) return false;
    rec.value += amount;
    rec.expire = Date.now() + ttlMs;
    return true;
  }

  _settle(key, delta) {
    const rec = this.windows.get(key);
    if (!rec) return;
    rec.value = Math.max(0, rec.value + delta);
  }

  _acquire(tokenId, limit) {
    const now = Date.now();
    let rec = this.concurrency.get(tokenId);
    if (!rec || rec.expire <= now) rec = { value: 0, expire: now + 300000 };
    if (rec.value >= limit) return false;
    rec.value += 1;
    rec.expire = now + 300000;
    this.concurrency.set(tokenId, rec);
    return true;
  }

  _release(tokenId) {
    const rec = this.concurrency.get(tokenId);
    if (!rec) return;
    rec.value -= 1;
    if (rec.value <= 0) this.concurrency.delete(tokenId);
    else this.concurrency.set(tokenId, rec);
  }

  async preflight(token, estimatedTokens) {
    const minute = Math.floor(Date.now() / 60000);

    const rpmKey = `${PREFIX}rpm:${token.id}:${minute}`;
    if (token.rpm > 0) {
      const rpm = this._window(rpmKey, 60000);
      rpm.value += 1;
      if (rpm.value > token.rpm) {
        return fail('rate_limit_exceeded', `每分钟请求数超过限制（${token.rpm} RPM）`, 60);
      }
    }

    if (token.concurrency > 0 && !this._acquire(token.id, token.concurrency)) {
      return fail('rate_limit_exceeded', `并发数超过限制（${token.concurrency}）`, 5);
    }

    const tpmKey = `${PREFIX}tpm:${token.id}:${minute}`;
    if (token.tpm > 0 && !this._reserve(tpmKey, token.tpm, estimatedTokens, 60000)) {
      if (token.concurrency > 0) this._release(token.id);
      return fail('rate_limit_exceeded', `每分钟 token 数超过限制（${token.tpm} TPM）`, 60);
    }

    const dayKey = `${PREFIX}day:${token.id}:${localDay()}`;
    if (token.daily_token_limit > 0 && !this._reserve(dayKey, token.daily_token_limit, estimatedTokens, secondsUntilTomorrow() * 1000)) {
      if (token.tpm > 0) this._settle(tpmKey, -estimatedTokens);
      if (token.concurrency > 0) this._release(token.id);
      return fail('insufficient_quota', '今日 token 额度已用尽', 3600);
    }

    const self = this;
    return {
      ok: true,
      reserved: estimatedTokens,
      async settle(actualTokens) {
        const delta = Number(actualTokens || 0) - estimatedTokens;
        if (delta !== 0) {
          if (token.tpm > 0) self._settle(tpmKey, delta);
          if (token.daily_token_limit > 0) self._settle(dayKey, delta);
        }
        if (token.concurrency > 0) self._release(token.id);
      },
      async release() {
        if (token.tpm > 0) self._settle(tpmKey, -estimatedTokens);
        if (token.daily_token_limit > 0) self._settle(dayKey, -estimatedTokens);
        if (token.concurrency > 0) self._release(token.id);
      },
    };
  }
}

// ---------------- 工厂 ----------------

let instance = null;

function createRateLimiter() {
  if (instance) return instance;
  const redis = getRedis();
  instance = redis ? new RedisRateLimiter(redis) : new MemoryRateLimiter();
  console.log(`[ratelimit] 使用 ${redis ? 'redis' : 'memory'} 实现`);
  return instance;
}

module.exports = { createRateLimiter, RedisRateLimiter, MemoryRateLimiter };
