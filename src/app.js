'use strict';

const express = require('express');
const cors = require('cors');

const config = require('./config');
const routes = require('./routes');

const app = express();

// 跨域
app.use(
  cors({
    origin: config.CORS_ORIGINS.includes('*') ? true : config.CORS_ORIGINS,
    credentials: true,
  })
);

// 请求体解析
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// 访问日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// 业务路由
app.use(config.API_PREFIX, routes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not Found' });
});

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERR]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

module.exports = app;
