const router = require('express').Router(), { z } = require('zod');
const { q, pool } = require('../db'), { auth, role } = require('../middleware/auth'), { disk, url, validImage } = require('../middleware/upload');
const fs = require('fs'), path = require('path'), cfg = require('../config');
const { signed } = require('../services/files'), { audit } = require('../services/audit'), { ah, HttpError, page } = require('../utils'), { notify, staffFor, event } = require('../services/notify');
const DEPT = { Cleaning: 'Housekeeping', Maintenance: 'Maintenance', Waste: 'Waste Management', Pest: 'Pest Control', Other: 'Admin Office' };
const NEXT = { Submitted: ['Reviewed', 'Rejected'], Open: ['Reviewed', 'Rejected'], Reviewed: ['Rejected'], Assigned: [], 'In Progress': [], 'Pending Verification': [], Resolved: ['Closed', 'Reopened'], Closed: ['Reopened'], Rejected: ['Reopened'], Reopened: ['Rejected'] };
const CATS = ['Cleaning', 'Maintenance', 'Waste', 'Pest', 'Other'], PRI = ['Low', 'Medium', 'High', 'Critical'], STAT = ['Submitted', 'Open', 'Reviewed', 'Assigned', 'In Progress', 'Pending Verification', 'Resolved', 'Closed', 'Rejected', 'Reopened'];
const deptId = async (cat, db = q) => (await db.query('SELECT id FROM departments WHERE name=$1', [DEPT[cat]])).rows[0]?.id || null;
const SEL = `SELECT c.*,b.name building,s.name spot,s.floor,u.name reporter,a.name assignee,d.name department FROM complaints c
  LEFT JOIN buildings b ON b.id=c.building_id LEFT JOIN spots s ON s.id=c.spot_id JOIN users u ON u.id=c.reporter_id
  LEFT JOIN users a ON a.id=c.assigned_to LEFT JOIN departments d ON d.id=c.department_id`;
const cleanupUploads = files => Promise.all(files.map(file => fs.promises.unlink(path.join(cfg.uploadDir, file.filename)).catch(error => {
  if (error.code !== 'ENOENT') throw error;
})));
function scope(user, p) {
  if (user.role === 'student') { p.push(user.id); return `c.reporter_id=$${p.length}`; }
  if (user.role === 'cleaner') { p.push(user.id); return `c.assigned_to=$${p.length}`; }
  if (user.role === 'staff') { if (!user.department_id) return 'false'; p.push(user.department_id); return `c.department_id=$${p.length}`; }
  return 'true';
}
router.use(auth);
router.post('/', role('student'), disk.array('photos', 5), ah(async (req, res) => {
  const files = req.files || [];
  let b, ai, dept, category, priority, title, description;
  try {
    for(const file of files)if(!validImage(fs.readFileSync(path.join(cfg.uploadDir,file.filename)),file.mimetype))throw new HttpError(400,'Image content does not match its file type');
    b = z.object({
      title: z.string().min(3).max(120).optional(), description: z.string().min(5).max(2000),
      category: z.enum(CATS).optional(), priority: z.enum(PRI).optional(),
      building_id: z.coerce.number().int().optional(), spot_id: z.coerce.number().int().optional(),
      lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), ai: z.string().optional()
    }).parse(req.body);
    if (!files.length) throw new HttpError(400, 'At least one complaint photo is required');
    ai = null;
    if (b.ai) { try { ai = JSON.parse(b.ai); } catch { throw new HttpError(400, 'ai must be valid JSON'); } }
    category = b.category || (ai && CATS.includes(ai.category) ? ai.category : 'Other');
    priority = b.priority || (ai && PRI.includes(ai.priority) ? ai.priority : 'Medium');
    title = b.title || (ai && ai.title) || b.description.slice(0, 60);
    description = b.description;
    dept = await deptId(category);
    if (b.building_id) {
      const building=(await q('SELECT department_id FROM buildings WHERE id=$1 AND is_active=true',[b.building_id])).rows[0];
      if(!building) throw new HttpError(400,'Selected campus building is inactive or does not exist');
      if(b.spot_id && !(await q('SELECT 1 FROM spots WHERE id=$1 AND building_id=$2 AND is_active=true',[b.spot_id,b.building_id])).rowCount) throw new HttpError(400,'Selected campus area is inactive or does not belong to this building');
      if(building.department_id) dept=building.department_id;
    } else if (b.spot_id) throw new HttpError(400,'A campus building is required when specifying an area');
  } catch (error) {
    await cleanupUploads(files);
    throw error;
  }
  let client;
  try { client = await pool.connect(); } catch (error) { await cleanupUploads(files); throw error; }
  let c;
  try {
    await client.query('BEGIN');
    c = (await client.query(`INSERT INTO complaints(title,description,category,priority,building_id,spot_id,lat,lng,department_id,reporter_id,ai) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [title, description, category, priority, b.building_id || null, b.spot_id || null, b.lat ?? null, b.lng ?? null, dept, req.user.id, ai ? JSON.stringify(ai) : null])).rows[0];
    for (const f of req.files) await client.query('INSERT INTO complaint_photos(complaint_id,url) VALUES($1,$2)', [c.id, url(f)]);
    await event(c.id, req.user.id, 'created', 'Complaint submitted', client);
    await notify(await staffFor(dept), 'New complaint ' + c.code, `${priority} · ${category}: ${title}`, { complaint_id: c.id }, client);
    await notify([req.user.id], 'Complaint submitted: ' + c.code, 'Your report has been received and is awaiting review.', { complaint_id: c.id }, client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    await cleanupUploads(files);
    throw e;
  } finally {
    client.release();
  }
  res.status(201).json(c);
}));
router.get('/', ah(async (req, res) => {
  const { limit, offset, page: pg } = page(req), p = [], w = [scope(req.user, p)];
  for (const [k, col] of [['status', 'c.status'], ['category', 'c.category'], ['priority', 'c.priority'], ['building_id', 'c.building_id']])
    if (req.query[k]) { p.push(req.query[k]); w.push(`${col}=$${p.length}`); }
  if (req.query.assigned_to_me === 'true') { p.push(req.user.id); w.push(`c.assigned_to=$${p.length}`); }
  if (req.query.q) { p.push('%' + req.query.q + '%'); w.push(`(c.title ILIKE $${p.length} OR c.code ILIKE $${p.length} OR c.description ILIKE $${p.length})`); }
  const where = 'WHERE ' + w.join(' AND '), sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
  const items = (await q(`${SEL} ${where} ORDER BY c.created_at ${sort} LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  const total = (await q(`SELECT count(*)::int n FROM complaints c ${where}`, p)).rows[0].n;
  res.json({ page: pg, limit, total, items });
}));
async function load(id, user, db = q, lock = false) {
  const p = [id], s = scope(user, p);
  const c = (await db.query(`${SEL} WHERE c.id=$1 AND ${s}${lock ? ' FOR UPDATE OF c' : ''}`, p)).rows[0];
  if (!c) throw new HttpError(404, 'Complaint not found'); return c;
}
router.get('/:id', ah(async (req, res) => {
  const c = await load(req.params.id, req.user);
  c.photos = (await q('SELECT id,url,kind FROM complaint_photos WHERE complaint_id=$1 ORDER BY id', [c.id])).rows;
  c.events = (await q('SELECT e.id,e.type,e.note,e.created_at,u.name actor FROM complaint_events e LEFT JOIN users u ON u.id=e.actor_id WHERE complaint_id=$1 ORDER BY e.id', [c.id])).rows;
  c.task = (await q('SELECT t.*,u.name cleaner FROM tasks t JOIN users u ON u.id=t.cleaner_id WHERE complaint_id=$1 ORDER BY t.id DESC LIMIT 1', [c.id])).rows[0] || null;
  c.photos = c.photos.map(p => ({ ...p, url: signed(p.url) }));
  if (c.task) c.task = { ...c.task, before_url: signed(c.task.before_url), after_url: signed(c.task.after_url) };
  res.json(c);
}));
router.patch('/:id', role('admin', 'staff'), ah(async (req, res) => {
  const b = z.object({ status: z.enum(STAT).optional(), priority: z.enum(PRI).optional(), category: z.enum(CATS).optional(), note: z.string().max(500).optional() }).strict().parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = await load(req.params.id, req.user, client, true), notes = [];
    if (b.status && b.status !== c.status) {
      if (['Rejected', 'Reopened'].includes(b.status) && !b.note) throw new HttpError(400, 'A reason (note) is required for ' + b.status);
      if (!NEXT[c.status].includes(b.status)) throw new HttpError(400, `Cannot move from ${c.status} to ${b.status}`);
      notes.push(`Status: ${c.status} → ${b.status}`);
    }
    if (b.priority && b.priority !== c.priority) notes.push(`Priority: ${c.priority} → ${b.priority}`);
    if (b.category && b.category !== c.category && !['Submitted', 'Open', 'Reviewed', 'Rejected', 'Reopened'].includes(c.status))
      throw new HttpError(400, 'Category cannot change after a cleaning task has been assigned');
    let dept = c.department_id;
    if (b.category && b.category !== c.category) { dept = await deptId(b.category, client); if(c.building_id){const locationDept=(await client.query('SELECT department_id FROM buildings WHERE id=$1',[c.building_id])).rows[0]?.department_id;if(locationDept)dept=locationDept;} notes.push(`Category: ${c.category} → ${b.category} (re-routed)`); }
    const st = b.status || c.status;
    const updated = (await client.query(`UPDATE complaints SET status=$1,priority=COALESCE($2,priority),category=COALESCE($3,category),department_id=$4,
      assigned_to=CASE WHEN $1='Reopened' THEN NULL ELSE $5 END,updated_at=now(),
      resolved_at=CASE WHEN $1 IN ('Resolved','Closed') THEN COALESCE(resolved_at,now()) WHEN $1='Reopened' THEN NULL ELSE resolved_at END WHERE id=$6 RETURNING *`,
      [st, b.priority, b.category, dept, c.assigned_to, c.id])).rows[0];
    if (notes.length) {
      await audit(req.user.id, 'complaint.update', c.code, { changes: notes }, client);
      await event(c.id, req.user.id, 'updated', notes.join('; ') + (b.note ? ' — ' + b.note : ''), client);
    }
    if (b.status && b.status !== c.status)
      await notify([c.reporter_id], `${c.code} is now ${b.status}`, b.note || c.title, { complaint_id: c.id }, client);
    await client.query('COMMIT');
    res.json(updated);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));
router.post('/:id/comments', ah(async (req, res) => {
  const { note } = z.object({ note: z.string().min(1).max(500) }).parse(req.body), c = await load(req.params.id, req.user);
  await event(c.id, req.user.id, 'comment', note);
  await notify([c.reporter_id, c.assigned_to].filter(x => x !== req.user.id), 'New comment on ' + c.code, note, { complaint_id: c.id });
  res.status(201).json({ ok: true });
}));
router.post('/:id/feedback', role('student'), ah(async (req, res) => {
  const b = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }).parse(req.body), c = await load(req.params.id, req.user);
  if (!['Resolved', 'Closed'].includes(c.status)) throw new HttpError(400, 'Feedback is allowed after the complaint is resolved');
  await q('UPDATE complaints SET feedback_rating=$1,feedback_comment=$2 WHERE id=$3', [b.rating, b.comment || null, c.id]); await event(c.id, req.user.id, 'feedback', `Rated ${b.rating}/5`); res.json({ ok: true });
}));
router.delete('/:id', role('admin'), ah(async (req, res) => { await q('DELETE FROM complaints WHERE id=$1', [req.params.id]); await audit(req.user.id, 'complaint.delete', 'complaint:' + req.params.id); res.json({ ok: true }); }));
module.exports = router;
