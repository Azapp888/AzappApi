'use strict';

// 存储层入口：按配置选择 sqlite / postgres / memory 实现，对外暴露同一套接口
// 单机（小内存、小 eMMC）默认 sqlite，无需数据库服务。

const config = require('../config');

const IMPLS = {
  sqlite: () => require('./sqlite'),
  postgres: () => require('./postgres'),
  memory: () => require('./memory'),
};

const factory = IMPLS[config.GATEWAY_STORE] || IMPLS.sqlite;

module.exports = factory();
