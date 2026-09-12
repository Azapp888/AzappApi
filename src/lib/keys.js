'use strict';

// 下游 API Key 生成与散列：明文只下发一次，库里只存 sha256

const crypto = require('crypto');

const PREFIX = 'sk-az-';

function hashApiKey(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}

function generateApiKey() {
  const raw = crypto.randomBytes(24).toString('base64url');
  const plain = `${PREFIX}${raw}`;
  return {
    plain,
    hash: hashApiKey(plain),
    prefix: `${plain.slice(0, 11)}...${plain.slice(-4)}`,
  };
}

module.exports = { PREFIX, hashApiKey, generateApiKey };
