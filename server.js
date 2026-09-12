'use strict';

require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');

app.listen(config.PORT, () => {
  console.log(`[AzappApi] 已启动: http://localhost:${config.PORT}${config.API_PREFIX}  (${config.NODE_ENV})`);
});
