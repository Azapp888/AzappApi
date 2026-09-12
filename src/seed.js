'use strict';

// 初始化/种子脚本：建表 + 写入管理员、渠道、模型映射（幂等）
// 用法：npm run seed

require('dotenv').config();

const { initGateway } = require('./bootstrap');
const config = require('./config');

initGateway()
  .then(() => {
    console.log('[seed] 完成');
    console.log(`[seed] 存储: ${config.GATEWAY_STORE}`);
    console.log(`[seed] 管理员: ${config.ADMIN_USERNAME}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('[seed] 失败:', err.message);
    process.exit(1);
  });
