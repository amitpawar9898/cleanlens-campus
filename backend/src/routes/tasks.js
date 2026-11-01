const router = require('express').Router(), { z } = require('zod');
const { q, pool } = require('../db'), { auth, role } = require('../middleware/auth'), { disk, url, validImage } = require('../middleware/upload');
const fs = require('fs'), path = require('path'), cfg = require('../config');
const { ah, HttpError, page } = require('../utils'), { notify, staffFor, event } = require('../services/notify');
const { signed } = require('../services/files'), { audit } = require('../services/audit'), ai = require('../services/ai');

const CHECKLIST = [
  { id: 'inspect', label: 'Inspect the reported area' },
  { id: 'debris', label: 'Remove waste and visible debris' },
  { id: 'surfaces', label: 'Clean and disinfect affected surfaces' },
  { id: 'supplies', label: 'Restock supplies where needed' },
  { id: 'safety', label: 'Check the area is safe and ready to use' }
];
const initialChecklist = () => CHECKLIST.map(item => ({ ...item, completed: false }));
const SEL = `SELECT t.*,c.code,c.title,c.description complaint_description,c.category,c.priority,c.building_id,
    b.name building,c.department_id,s.name spot,u.name cleaner,
    COALESCE(cp.items,'[]'::json) complaint_photos
  FROM tasks t JOIN complaints c ON c.id=t.complaint_id
  LEFT JOIN buildings b ON b.id=c.building_id LEFT JOIN spots s ON s.id=c.spot_id JOIN users u ON u.id=t.cleaner_id
  LEFT JOIN LATERAL (SELECT json_agg(json_build_object('id',p.id,'kind',p.kind,'url',p.url) ORDER BY p.id) items
    FROM complaint_photos p WHERE p.complaint_id=c.id) cp ON true`;
const signedTask = t => ({
  ...t,
  before_url: signed(t.before_url),
  after_url: signed(t.after_url),
  complaint_photos: (t.complaint_photos || []).map(p => ({ ...p, url: signed(p.url) }))
});
const tx = async fn => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};
const taskEvent = (db, taskId, actorId, from, to, note, detail) => db.query(
  'INSERT INTO task_events(task_id,actor_id,from_status,to_status,note,detail) VALUES($1,$2,$3,$4,$5,$6)',
  [taskId, actorId, from || null, to || null, note || null, detail ? JSON.stringify(detail) : null]
);
const cleanupUploads = files => Promise.all(files.map(file => fs.promises.unlink(path.join(cfg.uploadDir, file.filename)).catch(error => {
  if (error.code !== 'ENOENT') throw error;
})));

router.use(auth);

router.post('/', role('admin', 'staff'), ah(async (req, res) => {
  const b = z.object({
    complaint_id: z.number().int(),
    cleaner_id: z.number().int(),
    instructions: z.string().max(500).optional(),
    due_at: z.string().datetime().optional()
  }).parse(req.body);
  const result = await tx(async db => {
    const c = (await db.query('SELECT * FROM complaints WHERE id=$1 FOR UPDATE', [b.complaint_id])).rows[0];
    if (!c) throw new HttpError(404, 'Complaint not found');
    if (['Resolved', 'Closed'].includes(c.status)) throw new HttpError(400, 'Complaint is already resolved');
    if (!['Reviewed', 'Open', 'Assigned', 'Reopened'].includes(c.status))
      throw new HttpError(400, 'Review the complaint before assigning a cleaning task');
    if (req.user.role === 'staff' && (!req.user.department_id || req.user.department_id !== c.department_id))
      throw new HttpError(403, 'This complaint belongs to another department');
    const cl = (await db.query("SELECT id,name,department_id FROM users WHERE id=$1 AND role='cleaner' AND is_active", [b.cleaner_id])).rows[0];
    if (!cl) throw new HttpError(400, 'cleaner_id must be an active cleaner');
    if (cl.department_id !== c.department_id)
      throw new HttpError(400, 'Cleaner must belong to the complaint department');
    const t = (await db.query(
      'INSERT INTO tasks(complaint_id,cleaner_id,instructions,due_at,checklist) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [c.id, cl.id, b.instructions || null, b.due_at || null, JSON.stringify(initialChecklist())]
    )).rows[0];
    await db.query("UPDATE complaints SET assigned_to=$1,status='Assigned',updated_at=now(),resolved_at=NULL WHERE id=$2", [cl.id, c.id]);
    await event(c.id, req.user.id, 'task', 'Task assigned to ' + cl.name, db);
    await taskEvent(db, t.id, req.user.id, null, 'Assigned', 'Task assigned');
    await notify([cl.id], 'New cleaning task ' + c.code, c.title, { task_id: t.id, complaint_id: c.id }, db);
    await notify([c.reporter_id], c.code + ' assigned', 'A cleaner has been assigned to your complaint.', { complaint_id: c.id }, db);
    await audit(req.user.id, 'task.assign', 'task:' + t.id, { complaint: c.code, cleaner: cl.id }, db);
    return t;
  });
  res.status(201).json(result);
}));

router.get('/', ah(async (req, res) => {
  const { limit, offset } = page(req), p = [], w = [];
  if (req.user.role === 'cleaner') { p.push(req.user.id); w.push(`t.cleaner_id=$${p.length}`); }
  else if (req.user.role === 'student') throw new HttpError(403, 'Not allowed');
  else if (req.user.role === 'staff') {
    if (!req.user.department_id) throw new HttpError(403, 'Staff account has no department');
    p.push(req.user.department_id); w.push(`c.department_id=$${p.length}`);
  }
  if (req.query.status) { p.push(req.query.status); w.push(`t.status=$${p.length}`); }
  const where = w.length ? 'WHERE ' + w.map(x => '(' + x + ')').join(' AND ') : '';
  const items = (await q(`${SEL} ${where} ORDER BY t.id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  const cp = req.user.role === 'cleaner' ? [req.user.id] : req.user.role === 'staff' ? [req.user.department_id] : [];
  const cw = req.user.role === 'cleaner' ? 'WHERE cleaner_id=$1' : req.user.role === 'staff' ? 'WHERE complaint_id IN (SELECT id FROM complaints WHERE department_id=$1)' : '';
  const counts = (await q(`SELECT status,count(*)::int n FROM tasks ${cw} GROUP BY status`, cp)).rows;
  res.json({ items: items.map(signedTask), counts });
}));

router.patch('/:id', role('admin', 'staff'), ah(async (req, res) => {
  const b = z.object({
    cleaner_id: z.number().int().optional(),
    instructions: z.string().max(500).nullable().optional(),
    due_at: z.string().datetime().nullable().optional()
  }).parse(req.body);
  if (!Object.keys(b).length) throw new HttpError(400, 'Provide task details to update');
  const result = await tx(async db => {
    const t = await mine(req, db, true);
    if (['Verified', 'Completed'].includes(t.status)) throw new HttpError(400, 'Verified tasks cannot be changed');
    const c = (await db.query('SELECT department_id,code FROM complaints WHERE id=$1 FOR UPDATE', [t.complaint_id])).rows[0];
    let cleanerId = t.cleaner_id, cleanerName = t.cleaner;
    if (b.cleaner_id !== undefined) {
      const cleaner = (await db.query("SELECT id,name,department_id FROM users WHERE id=$1 AND role='cleaner' AND is_active", [b.cleaner_id])).rows[0];
      if (!cleaner) throw new HttpError(400, 'cleaner_id must be an active cleaner');
      if (cleaner.department_id !== c.department_id) throw new HttpError(400, 'Cleaner must belong to the complaint department');
      cleanerId = cleaner.id; cleanerName = cleaner.name;
    }
    const updated = (await db.query(
      `UPDATE tasks SET cleaner_id=$1,instructions=CASE WHEN $5 THEN $2 ELSE instructions END,due_at=$3
       WHERE id=$4 RETURNING *`,
      [cleanerId, b.instructions ?? null, b.due_at === undefined ? t.due_at : b.due_at, t.id, b.instructions !== undefined]
    )).rows[0];
    if (b.cleaner_id !== undefined && b.cleaner_id !== t.cleaner_id) {
      await db.query('UPDATE complaints SET assigned_to=$1,updated_at=now() WHERE id=$2', [cleanerId, t.complaint_id]);
      await notify([t.cleaner_id], 'Task reassigned: ' + c.code, 'This cleaning task is no longer assigned to you.', { task_id: t.id, complaint_id: t.complaint_id }, db);
      await notify([cleanerId], 'Task reassigned: ' + c.code, 'A cleaning task has been assigned to you.', { task_id: t.id, complaint_id: t.complaint_id }, db);
    }
    if (b.due_at !== undefined && b.due_at !== t.due_at)
      await notify([cleanerId], 'Deadline updated: ' + c.code, 'The deadline for your cleaning task has changed.', { task_id: t.id, complaint_id: t.complaint_id }, db);
    await taskEvent(db, t.id, req.user.id, t.status, t.status, 'Task details updated', { due_at: updated.due_at, cleaner_id: cleanerId, cleaner: cleanerName });
    await audit(req.user.id, 'task.update', 'task:' + t.id, { fields: Object.keys(b) }, db);
    return updated;
  });
  res.json(result);
}));

async function mine(req, db = pool, lock = false) {
  const suffix = lock ? ' FOR UPDATE OF t' : '';
  const t = (await db.query(`${SEL} WHERE t.id=$1${suffix}`, [req.params.id])).rows[0];
  if (!t) throw new HttpError(404, 'Task not found');
  if (req.user.role === 'cleaner' && t.cleaner_id !== req.user.id) throw new HttpError(403, 'This task belongs to another cleaner');
  if (req.user.role === 'student') throw new HttpError(403, 'Not allowed');
  if (req.user.role === 'staff' && (!req.user.department_id || t.department_id !== req.user.department_id))
    throw new HttpError(403, 'This task belongs to another department');
  return t;
}

router.get('/:id', ah(async (req, res) => {
  const t = await mine(req);
  t.history = (await q(`SELECT e.*,u.name actor FROM task_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.task_id=$1 ORDER BY e.id`, [t.id])).rows;
  res.json(signedTask(t));
}));

router.patch('/:id/start', role('cleaner'), ah(async (req, res) => {
  const result = await tx(async db => {
    const t = await mine(req, db, true);
    if (!['Assigned', 'Correction Required', 'Rejected'].includes(t.status))
      throw new HttpError(400, 'Task cannot be started from ' + t.status);
    const c = (await db.query('SELECT reporter_id,code,title,status FROM complaints WHERE id=$1 FOR UPDATE', [t.complaint_id])).rows[0];
    if (['Resolved', 'Closed'].includes(c.status)) throw new HttpError(400, 'Complaint is already resolved');
    await db.query("UPDATE tasks SET status='In Progress',started_at=now() WHERE id=$1", [t.id]);
    await db.query("UPDATE complaints SET status='In Progress',updated_at=now(),resolved_at=NULL WHERE id=$1", [t.complaint_id]);
    await taskEvent(db, t.id, req.user.id, t.status, 'In Progress', 'Cleaning started');
    await event(t.complaint_id, req.user.id, 'task', 'Cleaning started', db);
    await notify([c.reporter_id], c.code + ' is in progress', c.title, { complaint_id: t.complaint_id }, db);
    return { ok: true, status: 'In Progress' };
  });
  res.json(result);
}));

router.patch('/:id/checklist', role('cleaner'), ah(async (req, res) => {
  const b = z.object({
    checklist: z.array(z.object({ id: z.string(), completed: z.boolean() })).length(CHECKLIST.length)
  }).parse(req.body);
  const expected = new Set(CHECKLIST.map(x => x.id));
  if (b.checklist.some(x => !expected.has(x.id)) || new Set(b.checklist.map(x => x.id)).size !== CHECKLIST.length)
    throw new HttpError(400, 'Checklist must contain each required item exactly once');
  const checklist = CHECKLIST.map(item => ({ ...item, completed: b.checklist.find(x => x.id === item.id).completed }));
  const result = await tx(async db => {
    const t = await mine(req, db, true);
    if (t.status !== 'In Progress') throw new HttpError(400, 'Checklist can only be updated while the task is in progress');
    await db.query('UPDATE tasks SET checklist=$1 WHERE id=$2', [JSON.stringify(checklist), t.id]);
    await taskEvent(db, t.id, req.user.id, t.status, t.status, 'Checklist updated', checklist);
    return checklist;
  });
  res.json({ checklist: result });
}));

router.post('/:id/complete', role('cleaner'), disk.fields([{ name: 'before_photo', maxCount: 1 }, { name: 'after_photo', maxCount: 1 }]), ah(async (req, res) => {
  const uploaded = Object.values(req.files || {}).flat();
  let b;
  try {
    for(const file of uploaded)if(!validImage(fs.readFileSync(path.join(cfg.uploadDir,file.filename)),file.mimetype))throw new HttpError(400,'Image content does not match its file type');
    b = z.object({
      notes: z.string().max(500).optional(),
      before_score: z.coerce.number().int().min(0).max(100).optional(),
      after_score: z.coerce.number().int().min(0).max(100).optional()
    }).parse(req.body);
  } catch (error) { await cleanupUploads(uploaded); throw error; }
  const before = req.files && req.files.before_photo && req.files.before_photo[0];
  const after = req.files && req.files.after_photo && req.files.after_photo[0];
  if (!before || !after) {
    await cleanupUploads(uploaded);
    throw new HttpError(400, 'before_photo and after_photo are required');
  }
  let result;
  try { result = await tx(async db => {
    const t = await mine(req, db, true);
    if (t.status !== 'In Progress') throw new HttpError(400, 'Start the task before submitting it');
    if (!Array.isArray(t.checklist) || t.checklist.length !== CHECKLIST.length || t.checklist.some(item => !item.completed))
      throw new HttpError(400, 'Complete every checklist item before submitting the task');
    let beforeScore = b.before_score ?? null, afterScore = b.after_score ?? null, aiNotes = null;
    if (ai.status().configured && beforeScore === null && afterScore === null) {
      try {
        const compare = await ai.compare(
          { buf: fs.readFileSync(path.join(cfg.uploadDir, before.filename)), mime: before.mimetype },
          { buf: fs.readFileSync(path.join(cfg.uploadDir, after.filename)), mime: after.mimetype }
        );
        beforeScore = compare.before_score; afterScore = compare.after_score; aiNotes = compare.notes;
      } catch (e) { console.warn('AI compare skipped:', e.message); }
    }
    const beforeUrl = url(before), afterUrl = url(after);
    await db.query(
      "UPDATE tasks SET status='Submitted for Verification',completed_at=now(),before_url=$1,after_url=$2,before_score=$3,after_score=$4,notes=$5 WHERE id=$6",
      [beforeUrl, afterUrl, beforeScore, afterScore, b.notes || aiNotes || null, t.id]
    );
    await db.query("UPDATE complaints SET status='Pending Verification',updated_at=now() WHERE id=$1", [t.complaint_id]);
    await db.query("INSERT INTO complaint_photos(complaint_id,url,kind) VALUES($1,$2,'before'),($1,$3,'after')", [t.complaint_id, beforeUrl, afterUrl]);
    await taskEvent(db, t.id, req.user.id, t.status, 'Submitted for Verification', b.notes || 'Work submitted for verification');
    await event(t.complaint_id, req.user.id, 'task', 'Cleaning submitted for verification', db);
    const c = (await db.query('SELECT department_id,code FROM complaints WHERE id=$1', [t.complaint_id])).rows[0];
    await notify(await staffFor(c.department_id), c.code + ' needs verification', 'A cleaner submitted work for review.', { task_id: t.id, complaint_id: t.complaint_id }, db);
    return { ok: true, status: 'Submitted for Verification', before_score: beforeScore, after_score: afterScore, improvement: beforeScore !== null && afterScore !== null ? afterScore - beforeScore : null };
  }); } catch (error) { await cleanupUploads(uploaded); throw error; }
  res.json(result);
}));

router.post('/:id/verify', role('admin', 'staff'), ah(async (req, res) => {
  const b = z.object({ approve: z.boolean(), reason: z.string().min(3).max(500).optional() }).parse(req.body);
  if (!b.approve && !b.reason) throw new HttpError(400, 'A reason is required when rejecting');
  const result = await tx(async db => {
    const t = await mine(req, db, true);
    if (t.status !== 'Submitted for Verification') throw new HttpError(400, 'Task is not waiting for verification');
    const c = (await db.query('SELECT department_id,reporter_id,code FROM complaints WHERE id=$1 FOR UPDATE', [t.complaint_id])).rows[0];
    const next = b.approve ? 'Verified' : 'Correction Required';
    await db.query(
      'UPDATE tasks SET status=$1,review_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4',
      [next, b.reason || null, req.user.id, t.id]
    );
    await db.query(
      b.approve
        ? "UPDATE complaints SET status='Resolved',resolved_at=now(),updated_at=now() WHERE id=$1"
        : "UPDATE complaints SET status='In Progress',resolved_at=NULL,updated_at=now() WHERE id=$1",
      [t.complaint_id]
    );
    await taskEvent(db, t.id, req.user.id, t.status, next, b.reason || (b.approve ? 'Work verified' : 'Correction requested'));
    await event(t.complaint_id, req.user.id, 'task', (b.approve ? 'Work verified' : 'Work rejected') + (b.reason ? ': ' + b.reason : ''), db);
    await audit(req.user.id, b.approve ? 'task.verify' : 'task.reject', 'task:' + t.id, { reason: b.reason || null }, db);
    await notify([t.cleaner_id], t.code + (b.approve ? ' approved' : ' needs corrections'), b.reason || 'Your work was verified.', { task_id: t.id }, db);
    if (b.approve) await notify([c.reporter_id], t.code + ' resolved', 'Your complaint has been resolved. Please rate the work.', { complaint_id: t.complaint_id }, db);
    return { ok: true, status: next };
  });
  res.json(result);
}));

module.exports = router;
