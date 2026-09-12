'use strict';

// 启动引导：初始化存储层与限流器（幂等，只执行一次）

const store = require('./store');
const { createRateLimiter } = require('./services/ratelimit');

let ready = null;

function initGateway() {
  if (!ready) {
    ready = store
      .init()
      .then(() => {
        createRateLimiter();
        console.log(`[store] 使用 ${require('./config').GATEWAY_STORE} 存储`);
      })
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

module.exports = { initGateway };
