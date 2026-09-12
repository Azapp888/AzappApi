'use strict';

// 管理后台接口：/api/admin/*（JWT 鉴权）
// 下游接入使用统一固定密钥，不再提供按用户/按令牌的创建与封禁。

const { Router } = require('express');
const jwt = require('jsonwebtoken');

const config = require('../config');
const store = require('../store');
const auth = require('../middleware/auth');
const { verifyPassword } = require('../lib/password');
const { encrypt } = require('../lib/crypto');

const router = Router();

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data = {}) => res.json({ success: true, ...data });
const bad = (res, status, message) => res.status(status).json({ success: false, message });

function publicChannel(c) {
  const { api_key_enc, ...rest } = c;
  return { ...rest, has_api_key: Boolean(api_key_enc) };
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return bad(res, 403, '需要管理员权限');
}

// ---------------- 登录 ----------------

router.post(
  '/login',
  ah(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return bad(res, 400, '用户名和密码不能为空');

    const user = await store.findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return bad(res, 401, '用户名或密码错误');
    }
    if (user.status !== 'active') return bad(res, 401, '账号已被停用');

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );
    return ok(res, {
      token,
      expiresIn: config.JWT_EXPIRES_IN,
      user: { id: user.id, username: user.username, role: user.role },
    });
  })
);

router.use(auth, requireAdmin);

// ---------------- 接入密钥 ----------------

// 全局固定密钥，所有下游用户共用；不需要按用户封禁。
router.get('/access-key', (req, res) =>
  ok(res, {
    api_key: config.GATEWAY_API_KEY,
    limits: {
      rpm: config.GATEWAY_RPM,
      concurrency: config.GATEWAY_CONCURRENCY,
      tpm: config.GATEWAY_TPM,
      daily_token_limit: config.GATEWAY_DAILY_TOKEN_LIMIT,
    },
  })
);

// ---------------- 渠道 ----------------

router.get(
  '/channels',
  ah(async (req, res) => ok(res, { data: (await store.listChannels()).map(publicChannel) }))
);

router.post(
  '/channels',
  ah(async (req, res) => {
    const { name, provider, base_url, api_key, status = 'active' } = req.body || {};
    if (!name || !provider || !base_url) return bad(res, 400, 'name、provider、base_url 不能为空');
    const channel = await store.createChannel({ name, provider, base_url, api_key_enc: encrypt(api_key || ''), status });
    return ok(res, { data: publicChannel(channel) });
  })
);

router.patch(
  '/channels/:id',
  ah(async (req, res) => {
    const patch = { ...(req.body || {}) };
    if (patch.api_key !== undefined) {
      patch.api_key_enc = encrypt(patch.api_key);
      delete patch.api_key;
    }
    const channel = await store.updateChannel(req.params.id, patch);
    if (!channel) return bad(res, 404, '渠道不存在');
    return ok(res, { data: publicChannel(channel) });
  })
);

// ---------------- 模型映射 ----------------

router.get(
  '/mappings',
  ah(async (req, res) => ok(res, { data: await store.listMappings({}) }))
);

router.post(
  '/mappings',
  ah(async (req, res) => {
    const { model_name, channel_id, upstream_model, enabled = true } = req.body || {};
    if (!model_name || !channel_id || !upstream_model) {
      return bad(res, 400, 'model_name、channel_id、upstream_model 不能为空');
    }
    if (!(await store.getChannelById(channel_id))) return bad(res, 404, '渠道不存在');
    const existing = (await store.listMappings({})).find((m) => m.model_name === model_name);
    if (existing) return bad(res, 409, `模型 ${model_name} 已存在，可改用 PATCH 更新或先停用`);
    const mapping = await store.createMapping({ model_name, channel_id, upstream_model, enabled });
    return ok(res, { data: mapping });
  })
);

router.patch(
  '/mappings/:id',
  ah(async (req, res) => {
    const mapping = await store.updateMapping(req.params.id, req.body || {});
    if (!mapping) return bad(res, 404, '模型映射不存在');
    return ok(res, { data: mapping });
  })
);

// ---------------- 用量 ----------------

router.get(
  '/usage',
  ah(async (req, res) => {
    const { from, to } = req.query;
    const summary = await store.usageSummary({ from, to });
    return ok(res, summary);
  })
);

module.exports = router;
