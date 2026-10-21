const router = require('express').Router(), { q } = require('../db'), { auth } = require('../middleware/auth'), { ah, page } = require('../utils');
router.use(auth);
router.get('/', ah(async (req, res) => {
  const { limit, offset } = page(req, 100), un = req.query.unread === 'true' ? 'AND NOT is_read' : '';
  const items = (await q(`SELECT * FROM notifications WHERE user_id=$1 ${un} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, [req.user.id])).rows;
  const unread = (await q('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND NOT is_read', [req.user.id])).rows[0].n; res.json({ unread, items });
}));
router.post('/read-all', ah(async (req, res) => { await q('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user.id]); res.json({ ok: true }); }));
router.patch('/:id/read', ah(async (req, res) => { await q('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ ok: true }); }));
router.delete('/:id', ah(async (req, res) => { await q('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]); res.json({ ok: true }); }));
module.exports = router;
