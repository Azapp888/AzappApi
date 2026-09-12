'use strict';

const { Router } = require('express');

const health = require('./health');
const auth = require('../middleware/auth');

const router = Router();

// 健康检查：GET /api/health
router.use('/health', health);

// 示例：需要登录的接口，成功后返回令牌中的用户信息
router.get('/me', auth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
