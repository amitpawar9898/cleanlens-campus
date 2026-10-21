const router = require('express').Router(), { q, pool } = require('../db'), { auth, role } = require('../middleware/auth'), { ah, HttpError } = require('../utils'), { buildingScores, locationScores, factors, level } = require('../services/scoring'), { audit } = require('../services/audit');
router.use(auth, role('admin', 'staff'));
function dateRange(req) {
  const from = req.query.from || null, to = req.query.to || null;
  const valid = v => !v || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
  if (!valid(from) || !valid(to) || (from && to && from > to)) {
    const { HttpError } = require('../utils'); throw new HttpError(400, 'Use valid from/to dates (YYYY-MM-DD), with from on or before to.');
  }
  return { from, to };
}
router.get('/summary', ah(async (req, res) => {
  const { from, to } = dateRange(req);
  const s = (await q(`SELECT count(*)::int total,count(*) FILTER (WHERE status IN ('Submitted','Open','Reviewed'))::int open,count(*) FILTER (WHERE status IN ('Assigned','In Progress','Pending Verification'))::int in_progress,
    count(*) FILTER (WHERE status IN ('Resolved','Closed'))::int resolved,
    round(avg(extract(epoch FROM resolved_at-created_at)/3600) FILTER (WHERE resolved_at IS NOT NULL)::numeric,1) avg_resolution_hours,
    round(avg(feedback_rating)::numeric,2) avg_rating FROM complaints WHERE ($1::date IS NULL OR created_at >= $1::date) AND ($2::date IS NULL OR created_at < $2::date + interval '1 day') AND ($3='admin' OR department_id=$4)`, [from, to,req.user.role,req.user.department_id||-1])).rows[0];
  const b = await buildingScores(req.user.role==='staff'?(req.user.department_id||-1):null), score = b.length ? Math.round(b.reduce((a, x) => a + x.score, 0) / b.length) : 100;
  res.json({ ...s, campus_score: score, campus_level: level(score), locations_requiring_attention: b.filter(x => x.score < 85).length, locations_monitored: b.length });
}));
router.get('/by-category', ah(async (req, res) => { const {from,to}=dateRange(req); res.json((await q('SELECT category,count(*)::int count FROM complaints WHERE ($1::date IS NULL OR created_at >= $1::date) AND ($2::date IS NULL OR created_at < $2::date + interval \'1 day\') AND ($3=\'admin\' OR department_id=$4) GROUP BY category ORDER BY count DESC',[from,to,req.user.role,req.user.department_id||-1])).rows); }));
router.get('/by-priority', ah(async (req, res) => { const {from,to}=dateRange(req); res.json((await q('SELECT priority,count(*)::int count FROM complaints WHERE ($1::date IS NULL OR created_at >= $1::date) AND ($2::date IS NULL OR created_at < $2::date + interval \'1 day\') AND ($3=\'admin\' OR department_id=$4) GROUP BY priority ORDER BY count DESC',[from,to,req.user.role,req.user.department_id||-1])).rows); }));
router.get('/timeseries', ah(async (req, res) => {
  const days = Math.min(Math.max(+req.query.days || 7, 1), 90);
  const { from, to } = dateRange(req);
  if (from || to) {
    const start = from || to, end = to || from;
    const span = Math.ceil((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    if (span > 366) { const { HttpError } = require('../utils'); throw new HttpError(400, 'Date range cannot exceed 366 days.'); }
    return res.json((await q(`SELECT d::date AS day,(SELECT count(*)::int FROM complaints WHERE created_at::date=d::date AND ($3='admin' OR department_id=$4)) submitted,(SELECT count(*)::int FROM complaints WHERE resolved_at::date=d::date AND ($3='admin' OR department_id=$4)) resolved FROM generate_series($1::date,$2::date,'1 day') d ORDER BY d`, [start,end,req.user.role,req.user.department_id||-1])).rows);
  }
  res.json((await q(`SELECT d::date AS day,(SELECT count(*)::int FROM complaints WHERE created_at::date=d::date AND ($2='admin' OR department_id=$3)) submitted,(SELECT count(*)::int FROM complaints WHERE resolved_at::date=d::date AND ($2='admin' OR department_id=$3)) resolved
    FROM generate_series(now()::date-($1::int-1),now()::date,'1 day') d ORDER BY d`, [days,req.user.role,req.user.department_id||-1])).rows);
}));
router.get('/locations', ah(async (req, res) => res.json((await locationScores(req.user.role==='staff'?(req.user.department_id||-1):null)).sort((a, b) => b.score - a.score))));
router.get('/scoring', role('admin'), ah(async(req,res)=>res.json(await factors())));
router.put('/scoring', role('admin'), ah(async(req,res)=>{
  const {z}=require('zod');
  const b=z.object({Low:z.number().int().min(0).max(30),Medium:z.number().int().min(0).max(50),High:z.number().int().min(0).max(70),Critical:z.number().int().min(0).max(90),floor:z.number().int().min(0).max(100)}).parse(req.body);
  if(!(b.Low<=b.Medium&&b.Medium<=b.High&&b.High<=b.Critical)) throw new HttpError(400,'Penalty values must increase from Low through Critical.');
  const client=await pool.connect();
  try{await client.query('BEGIN');await client.query('UPDATE scoring_configs SET active=false WHERE active=true');const v=(await client.query('SELECT COALESCE(MAX(version),0)+1 version FROM scoring_configs')).rows[0].version;
    const cfg=(await client.query('INSERT INTO scoring_configs(version,factors,active,created_by) VALUES($1,$2,true,$3) RETURNING *',[v,JSON.stringify(b),req.user.id])).rows[0];
    await audit(req.user.id,'scoring.configure','scoring:'+v,{factors:b},client);await client.query('COMMIT');res.status(201).json(cfg);
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));
router.get('/cleaners', ah(async (req, res) => res.json((await q(`SELECT u.id,u.name,count(t.*)::int tasks,count(t.*) FILTER (WHERE t.status IN ('Completed','Verified'))::int completed,
  round(avg(t.after_score-t.before_score) FILTER (WHERE t.after_score IS NOT NULL AND t.before_score IS NOT NULL)::numeric,1) avg_improvement
  FROM users u LEFT JOIN tasks t ON t.cleaner_id=u.id WHERE u.role='cleaner' AND ($1='admin' OR u.department_id=$2) GROUP BY u.id ORDER BY completed DESC`,[req.user.role,req.user.department_id||-1])).rows)));
module.exports = router;
