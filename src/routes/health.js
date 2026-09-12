'use strict';

const { Router } = require('express');

const router = Router();
const startedAt = Date.now();

// GET /api/health
router.get('/', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  });
});

module.exports = router;
