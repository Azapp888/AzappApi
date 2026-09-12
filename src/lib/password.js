'use strict';

// 密码散列：纯 JS bcrypt，避免 native 依赖

const bcrypt = require('bcryptjs');

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), 10);
}

function verifyPassword(plain, hashed) {
  if (!hashed) return false;
  try {
    return bcrypt.compareSync(String(plain), hashed);
  } catch (_) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
