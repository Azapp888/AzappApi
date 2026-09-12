'use strict';

require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const { initGateway } = require('./src/bootstrap');

initGateway()
  .then(() => {
    app.listen(config.PORT, () => {
      console.log(`[AzappApi] 已启动: http://localhost:${config.PORT}${config.API_PREFIX}  (${config.NODE_ENV})`);
      console.log(`[AzappApi] OpenAI 兼容端点: http://localhost:${config.PORT}/v1`);
    });
  })
  .catch((err) => {
    console.error('[AzappApi] 启动失败:', err.message);
    process.exit(1);
  });
