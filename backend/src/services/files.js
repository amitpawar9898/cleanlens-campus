const crypto = require('crypto'), path = require('path'), cfg = require('../config');
const mac = (n, e) => crypto.createHmac('sha256', cfg.jwtSecret).update(n + '.' + e).digest('hex');
// Private photos: DB keeps /uploads/<name>; clients get a short-lived signed link instead.
exports.signed = (u, ttl = 900) => { if (!u || !u.startsWith('/uploads/')) return u || null; const n = path.basename(u), e = Math.floor(Date.now() / 1000) + ttl; return `/files/${n}?exp=${e}&sig=${mac(n, e)}`; };
exports.verify = (n, e, s) => { if (!/^[a-f0-9]{24}\.(jpe?g|png|webp)$/.test(n) || !(+e > Date.now() / 1000) || typeof s !== 'string' || s.length !== 64) return false;
  try { return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(mac(n, e))); } catch { return false; } };
