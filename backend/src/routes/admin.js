const router = require('express').Router(), { q } = require('../db'), { auth, role } = require('../middleware/auth'), { ah } = require('../utils');
router.use(auth, role('admin'));
router.get('/export/complaints.csv', ah(async (req, res) => {
  const from = req.query.from || null, to = req.query.to || null;
  const valid = v => !v || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
  if (!valid(from) || !valid(to) || (from && to && from > to)) {
    const { HttpError } = require('../utils'); throw new HttpError(400, 'Use valid from/to dates (YYYY-MM-DD), with from on or before to.');
  }
  const { rows } = await q(`SELECT c.code,c.title,c.category,c.priority,c.status,b.name building,s.name spot,u.name reporter,a.name assignee,c.lat,c.lng,c.created_at,c.resolved_at
    FROM complaints c LEFT JOIN buildings b ON b.id=c.building_id LEFT JOIN spots s ON s.id=c.spot_id JOIN users u ON u.id=c.reporter_id LEFT JOIN users a ON a.id=c.assigned_to
    WHERE ($1::date IS NULL OR c.created_at >= $1::date) AND ($2::date IS NULL OR c.created_at < $2::date + interval '1 day') ORDER BY c.id`, [from,to]);
  const cols = rows[0] ? Object.keys(rows[0]) : ['code'], esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="complaints.csv"' });
  res.send([cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
}));
router.get('/audit', ah(async (req, res) => { const { limit, offset } = require('../utils').page(req); res.json((await q(`SELECT a.*,u.name actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`)).rows); }));
module.exports = router;
