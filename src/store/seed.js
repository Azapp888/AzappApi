'use strict';

const crypto = require('crypto');

const config = require('../config');
const { encrypt } = require('../lib/crypto');

// 固定 id，保证重复初始化幂等
const CHANNEL_IDS = {
  deepseek: 'ch_deepseek',
  aliyun: 'ch_aliyun',
  doubao: 'ch_doubao',
};

function defaultChannels() {
  return [
    {
      id: CHANNEL_IDS.deepseek,
      name: 'DeepSeek',
      provider: 'deepseek',
      base_url: config.UPSTREAM_DEEPSEEK_BASE_URL,
      api_key_enc: encrypt(config.UPSTREAM_DEEPSEEK_KEY),
      status: 'active',
    },
    {
      id: CHANNEL_IDS.aliyun,
      name: '阿里云百炼',
      provider: 'aliyun',
      base_url: config.UPSTREAM_ALIYUN_BASE_URL,
      api_key_enc: encrypt(config.UPSTREAM_ALIYUN_KEY),
      status: 'active',
    },
    {
      id: CHANNEL_IDS.doubao,
      name: '豆包（火山方舟）',
      provider: 'doubao',
      base_url: config.UPSTREAM_DOUBAO_BASE_URL,
      api_key_enc: encrypt(config.UPSTREAM_DOUBAO_KEY),
      status: 'active',
    },
  ];
}

// 默认模型映射：默认不预置任何模型（避免写入未经验证的模型名），
// 由登录后在后台逐个添加；也可用环境变量 DEFAULT_MODEL_MAPPINGS（JSON 数组）预置。
//   DEFAULT_MODEL_MAPPINGS=[{"model_name":"...","provider":"deepseek","upstream_model":"..."}]
function defaultMappings() {
  const raw = process.env.DEFAULT_MODEL_MAPPINGS;
  if (raw === undefined || raw === '') return [];

  let list;
  try {
    list = JSON.parse(raw);
    if (!Array.isArray(list)) {
      console.error('[seed] DEFAULT_MODEL_MAPPINGS 需为 JSON 数组，已忽略');
      return [];
    }
  } catch (err) {
    console.error(`[seed] DEFAULT_MODEL_MAPPINGS 解析失败（${err.message}），已忽略`);
    return [];
  }

  return list
    .filter((m) => m && m.model_name && m.upstream_model)
    .map((m) => ({
      id: `md_${m.model_name}`,
      model_name: m.model_name,
      channel_id: m.channel_id || CHANNEL_IDS[m.provider],
      upstream_model: m.upstream_model,
      enabled: m.enabled !== false,
    }))
    .filter((m) => m.channel_id);
}

function defaultUserId() {
  return 'u_admin';
}

function newId() {
  return crypto.randomUUID();
}

module.exports = { CHANNEL_IDS, defaultChannels, defaultMappings, defaultUserId, newId };
