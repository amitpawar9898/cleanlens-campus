const router = require('express').Router(), { z } = require('zod');
const { q } = require('../db'), { auth, role } = require('../middleware/auth'), { ah, HttpError } = require('../utils'), { buildingScores, locationScores } = require('../services/scoring'), { audit } = require('../services/audit');
router.use(auth);
router.get('/buildings', ah(async (req, res) => {
  const { rows } = await q(`SELECT b.*,COALESCE(json_agg(json_build_object('id',s.id,'floor',s.floor,'name',s.name,'location_type',s.location_type,'is_active',s.is_active) ORDER BY s.floor,s.name) FILTER (WHERE s.id IS NOT NULL),'[]') spots FROM buildings b LEFT JOIN spots s ON s.building_id=b.id GROUP BY b.id ORDER BY b.name`);
  res.json(rows);
}));
router.get('/map', ah(async (req, res) => res.json(await buildingScores())));
router.get('/scores', role('admin','staff'), ah(async (req,res) => res.json(await locationScores(req.user.role==='staff'?(req.user.department_id||-1):null))));
router.post('/buildings', role('admin'), ah(async (req, res) => {
  const b = z.object({ name: z.string().min(2), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), department_id:z.number().int().positive().nullable().optional() }).refine(v => (v.lat == null) === (v.lng == null), { message: 'Provide both latitude and longitude, or leave both blank.' }).parse(req.body);
  const r=(await q('INSERT INTO buildings(name,lat,lng,department_id) VALUES($1,$2,$3,$4) RETURNING *', [b.name, b.lat ?? null, b.lng ?? null,b.department_id||null])).rows[0];
  await audit(req.user.id,'location.building.create','building:'+r.id,{name:r.name}); res.status(201).json(r);
}));
router.patch('/buildings/:id', role('admin'), ah(async (req, res) => {
  const b = z.object({ name: z.string().min(2).optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), department_id:z.number().int().positive().nullable().optional() }).refine(v => (v.lat == null) === (v.lng == null), { message: 'Provide both latitude and longitude, or leave both unchanged.' }).parse(req.body);
  const r = (await q('UPDATE buildings SET name=COALESCE($1,name),lat=COALESCE($2,lat),lng=COALESCE($3,lng),department_id=CASE WHEN $5 THEN $6::int ELSE department_id END WHERE id=$4 RETURNING *', [b.name, b.lat, b.lng, req.params.id,Object.hasOwn(b,'department_id'),b.department_id??null])).rows[0];
  if (!r) throw new HttpError(404, 'Building not found'); await audit(req.user.id,'location.building.update','building:'+r.id,{fields:Object.keys(b)}); res.json(r);
}));
router.patch('/buildings/:id/active', role('admin'), ah(async (req, res) => {
  const b = z.object({ is_active: z.boolean() }).parse(req.body);
  const r = (await q('UPDATE buildings SET is_active=$1 WHERE id=$2 RETURNING *', [b.is_active, req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Building not found'); await audit(req.user.id,'location.building.active','building:'+r.id,{is_active:b.is_active}); res.json(r);
}));
router.delete('/buildings/:id', role('admin'), ah(async (req, res) => {
  const r = (await q('UPDATE buildings SET is_active=false WHERE id=$1 RETURNING id', [req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Building not found'); await audit(req.user.id,'location.building.deactivate','building:'+req.params.id); res.json({ ok: true });
}));
router.post('/buildings/:id/spots', role('admin'), ah(async (req, res) => {
  const b = z.object({ floor: z.string().default('Ground Floor'), name: z.string().min(1), location_type: z.enum(['Classroom','Laboratory','Washroom','Hostel','Canteen','Library','Office','Outdoor','Other']).default('Other') }).parse(req.body);
  const building = (await q('SELECT id FROM buildings WHERE id=$1 AND is_active=true', [req.params.id])).rows[0];
  if (!building) throw new HttpError(404, 'Active building not found');
  const r=(await q('INSERT INTO spots(building_id,floor,name,location_type) VALUES($1,$2,$3,$4) RETURNING *', [req.params.id, b.floor, b.name, b.location_type])).rows[0];
  await audit(req.user.id,'location.spot.create','spot:'+r.id,{building_id:+req.params.id,type:r.location_type}); res.status(201).json(r);
}));
router.patch('/spots/:id', role('admin'), ah(async (req, res) => {
  const b = z.object({ floor: z.string().min(1).optional(), name: z.string().min(1).optional(), location_type: z.enum(['Classroom','Laboratory','Washroom','Hostel','Canteen','Library','Office','Outdoor','Other']).optional(), is_active: z.boolean().optional() }).parse(req.body);
  const r = (await q('UPDATE spots SET floor=COALESCE($1,floor),name=COALESCE($2,name),location_type=COALESCE($3,location_type),is_active=COALESCE($4,is_active) WHERE id=$5 RETURNING *', [b.floor,b.name,b.location_type,b.is_active,req.params.id])).rows[0];
  if (!r) throw new HttpError(404, 'Location not found'); await audit(req.user.id,'location.spot.update','spot:'+r.id,{fields:Object.keys(b)}); res.json(r);
}));
router.delete('/spots/:id', role('admin'), ah(async (req, res) => { const r=(await q('UPDATE spots SET is_active=false WHERE id=$1 RETURNING id',[req.params.id])).rows[0]; if(!r) throw new HttpError(404,'Location not found'); await audit(req.user.id,'location.spot.deactivate','spot:'+req.params.id); res.json({ ok: true }); }));
module.exports = router;
