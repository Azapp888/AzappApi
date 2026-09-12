'use strict';

const jwt = require('jsonwebtoken');

const config = require('../config');

// Bearer Token 鉴权中间件：校验通过后把载荷挂到 req.user
module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, message: '缺少访问令牌' });
  }

  try {
    req.user = jwt.verify(token, config.JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '令牌无效或已过期' });
  }
};
