'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const routes = require('./routes');
const v1 = require('./routes/v1');
const { initGateway } = require('./bootstrap');

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

// 确保网关依赖（存储/限流）已就绪
app.use((req, res, next) => {
  initGateway()
    .then(() => next())
    .catch(next);
});

// OpenAI 兼容接口：/v1/models、/v1/chat/completions
app.use('/v1', v1);

// 业务路由
app.use(config.API_PREFIX, routes);

// 管理后台界面：/admin（静态单页，零构建）
const adminUiDir = path.join(__dirname, '..', 'public', 'admin');
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(adminUiDir, 'index.html')));
app.use('/admin', express.static(adminUiDir, { index: false, redirect: false }));

// 根路径直接进入管理后台
app.get('/', (req, res) => res.redirect('/admin'));

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
