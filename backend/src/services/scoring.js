const { q } = require('../db');
const level = s => s >= 85 ? 'Good' : s >= 70 ? 'Needs Attention' : s >= 55 ? 'Poor' : 'Critical';
async function factors() {
  const { rows } = await q('SELECT version,factors FROM scoring_configs WHERE active=true ORDER BY version DESC LIMIT 1');
  return rows[0] || { version: 1, factors: { Low: 3, Medium: 6, High: 10, Critical: 15, floor: 30 } };
}
async function buildingScores(departmentId = null) {
  const config = await factors(), W = config.factors;
  const { rows } = await q(`SELECT b.id,b.name,b.lat,b.lng,
    COALESCE(json_agg(c.priority) FILTER (WHERE c.id IS NOT NULL),'[]') pri
    FROM buildings b LEFT JOIN complaints c ON c.building_id=b.id AND c.status NOT IN ('Resolved','Closed','Rejected') WHERE b.is_active AND ($1::int IS NULL OR b.department_id=$1) GROUP BY b.id ORDER BY b.name`,[departmentId]);
  return rows.map(r => { const pen = r.pri.reduce((a, p) => a + (W[p] || 0), 0), score = Math.max(W.floor || 30, 100 - pen);
    return { id: r.id, name: r.name, lat: r.lat, lng: r.lng, open_complaints: r.pri.length, score, level: level(score), scoring_version: config.version }; });
}
async function locationScores(departmentId = null) {
  const config = await factors(), W = config.factors;
  const { rows } = await q(`SELECT s.id spot_id,s.name spot,s.floor,s.location_type,b.id building_id,b.name building,b.department_id,
    count(c.id) FILTER (WHERE c.id IS NOT NULL)::int open_complaints,
    COALESCE(sum(CASE WHEN c.id IS NOT NULL THEN COALESCE(( $1::jsonb ->> c.priority)::int,0) ELSE 0 END),0)::int penalty
    FROM spots s JOIN buildings b ON b.id=s.building_id LEFT JOIN complaints c ON c.spot_id=s.id AND c.status NOT IN ('Resolved','Closed','Rejected')
    WHERE b.is_active AND s.is_active AND ($2::int IS NULL OR b.department_id=$2) GROUP BY s.id,b.id ORDER BY b.name,s.floor,s.name`, [JSON.stringify(W), departmentId]);
  return rows.map(r => { const score = Math.max(W.floor || 30,100-r.penalty); return { ...r, score, level: level(score), scoring_version: config.version }; });
}
module.exports = { buildingScores, locationScores, factors, level };
