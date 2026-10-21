const { ZodError } = require('zod'), cfg = require('../config');
module.exports = (err, req, res, next) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced record does not exist' });
  if (err.name === 'MulterError') return res.status(400).json({ error: err.message });
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 && cfg.prod ? 'Internal server error' : err.message });
};
