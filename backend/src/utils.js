class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const page = (req, max = 100) => {
  const limit = Math.min(Math.max(+req.query.limit || 20, 1), max), p = Math.max(+req.query.page || 1, 1);
  return { limit, offset: (p - 1) * limit, page: p };
};
module.exports = { HttpError, ah, page };
