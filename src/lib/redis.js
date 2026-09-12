'use strict';

// Redis 客户端：仅当 GATEWAY_REDIS=redis 时创建连接

const config = require('../config');

let client = null;

function getRedis() {
  if (config.GATEWAY_REDIS !== 'redis') return null;
  if (client) return client;
  const Redis = require('ioredis');
  client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });
  client.on('error', (err) => console.error('[redis]', err.message));
  return client;
}

module.exports = { getRedis };
