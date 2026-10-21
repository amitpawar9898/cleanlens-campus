const jwt = require('jsonwebtoken'), cfg = require('../config'), { q } = require('../db'), { HttpError, ah } = require('../utils');
const auth = ah(async (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Missing bearer token');
  let p; try { p = jwt.verify(h.slice(7), cfg.jwtSecret); } catch { throw new HttpError(401, 'Invalid or expired token'); }
  const { rows } = await q('SELECT id,name,email,phone,role,department_id,is_active FROM users WHERE id=$1', [p.sub]);
  if (!rows[0] || !rows[0].is_active) throw new HttpError(401, 'Account not found or disabled');
  req.user = rows[0]; next();
});
const role = (...r) => (req, res, next) => r.includes(req.user.role) ? next() : next(new HttpError(403, 'Not allowed for role ' + req.user.role));
module.exports = { auth, role };
