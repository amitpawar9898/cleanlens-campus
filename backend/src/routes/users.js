const { audit } = require('../services/audit');
const router = require('express').Router(), bcrypt = require('bcryptjs'), { z } = require('zod');
const { q } = require('../db'), { auth, role } = require('../middleware/auth'), { ah, HttpError, page } = require('../utils');
router.use(auth);
router.get('/departments', ah(async (req, res) => res.json((await q('SELECT * FROM departments ORDER BY name')).rows)));
router.post('/departments', role('admin'), ah(async (req,res) => {
  const b=z.object({name:z.string().trim().min(2).max(80)}).parse(req.body);
  const r=(await q('INSERT INTO departments(name) VALUES($1) RETURNING *',[b.name])).rows[0];
  await audit(req.user.id,'department.create','department:'+r.id); res.status(201).json(r);
}));
router.patch('/departments/:id', role('admin'), ah(async (req,res) => {
  const b=z.object({name:z.string().trim().min(2).max(80)}).parse(req.body);
  const r=(await q('UPDATE departments SET name=$1 WHERE id=$2 RETURNING *',[b.name,req.params.id])).rows[0];
  if(!r) throw new HttpError(404,'Department not found'); await audit(req.user.id,'department.update','department:'+r.id); res.json(r);
}));
router.delete('/departments/:id', role('admin'), ah(async (req,res) => {
  const used=(await q('SELECT (SELECT count(*) FROM users WHERE department_id=$1)::int users,(SELECT count(*) FROM complaints WHERE department_id=$1)::int complaints FROM departments WHERE id=$1',[req.params.id])).rows[0];
  if(!used) throw new HttpError(404,'Department not found');
  if(used.users||used.complaints) throw new HttpError(409,'Department is in use. Reassign its users and complaints before deletion.');
  await q('DELETE FROM departments WHERE id=$1',[req.params.id]); await audit(req.user.id,'department.delete','department:'+req.params.id); res.json({ok:true});
}));
router.get('/cleaners', role('admin', 'staff'), ah(async (req, res) => {
  const { department_id } = z.object({ department_id: z.coerce.number().int().positive().optional() }).parse(req.query);
  res.json((await q(
    "SELECT id,name,email,department_id FROM users WHERE role='cleaner' AND is_active AND ($1::int IS NULL OR department_id=$1) ORDER BY name",
    [department_id || null]
  )).rows);
}));
router.use(role('admin'));
router.get('/', ah(async (req, res) => {
  const { limit, offset } = page(req), w = [], p = [];
  if (req.query.role) { p.push(req.query.role); w.push(`role=$${p.length}`); }
  if (req.query.q) { p.push('%' + req.query.q + '%'); w.push(`(name ILIKE $${p.length} OR email ILIKE $${p.length})`); }
  const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const rows = (await q(`SELECT id,name,email,phone,role,department_id,is_active,created_at FROM users ${where} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, p)).rows;
  const total = (await q(`SELECT count(*)::int n FROM users ${where}`, p)).rows[0].n; res.json({ total, items: rows });
}));
const base = { name: z.string().min(2).max(80), email: z.string().email(), phone: z.string().regex(/^\+?[0-9]{10,15}$/).optional(), role: z.enum(['student', 'staff', 'cleaner', 'admin']), department_id: z.number().int().optional() };
router.post('/', ah(async (req, res) => {
  const b = z.object({ ...base, password: z.string().min(8) }).parse(req.body);
  if (['staff', 'cleaner'].includes(b.role) && !b.department_id) throw new HttpError(400, 'Staff and cleaner accounts require a department');
  const { rows } = await q('INSERT INTO users(name,email,phone,password_hash,role,department_id) VALUES($1,lower($2),$3,$4,$5,$6) RETURNING id,name,email,phone,role,department_id', [b.name, b.email, b.phone || null, await bcrypt.hash(b.password, 10), b.role, b.department_id || null]);
  await audit(req.user.id, 'user.create', 'user:' + rows[0].id, { role: b.role });
  res.status(201).json(rows[0]);
}));
router.patch('/:id', ah(async (req, res) => {
  const b = z.object({ name: base.name.optional(), phone: base.phone, role: base.role.optional(), department_id: base.department_id, is_active: z.boolean().optional(), password: z.string().min(8).optional() }).parse(req.body);
  if (+req.params.id === req.user.id && b.is_active === false) throw new HttpError(400, 'You cannot deactivate your own account');
  const current = (await q('SELECT role,department_id FROM users WHERE id=$1', [req.params.id])).rows[0];
  if (!current) throw new HttpError(404, 'User not found');
  const nextRole = b.role || current.role, nextDepartment = b.department_id || current.department_id;
  if (['staff', 'cleaner'].includes(nextRole) && !nextDepartment)
    throw new HttpError(400, 'Staff and cleaner accounts require a department');
  const hash = b.password ? await bcrypt.hash(b.password, 10) : null;
  const { rows } = await q('UPDATE users SET name=COALESCE($1,name),phone=COALESCE($2,phone),role=COALESCE($3,role),department_id=COALESCE($4,department_id),is_active=COALESCE($5,is_active),password_hash=COALESCE($6,password_hash) WHERE id=$7 RETURNING id,name,email,phone,role,department_id,is_active', [b.name, b.phone, b.role, b.department_id, b.is_active, hash, req.params.id]);
  await audit(req.user.id, 'user.update', 'user:' + req.params.id, { fields: Object.keys(b) }); res.json(rows[0]);
}));
router.delete('/:id', ah(async (req, res) => {
  if (+req.params.id === req.user.id) throw new HttpError(400, 'You cannot disable your own account');
  await q('UPDATE users SET is_active=false WHERE id=$1', [req.params.id]); await q('UPDATE refresh_tokens SET revoked=true WHERE user_id=$1', [req.params.id]); await audit(req.user.id, 'user.disable', 'user:' + req.params.id); res.json({ ok: true });
}));
module.exports = router;
