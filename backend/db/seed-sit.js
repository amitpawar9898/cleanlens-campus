const { pool } = require('../src/db');
// SIT department floors. Each floor has wings A–E holding 7 classrooms (A and B two each, C–E one each)
// and 5 labs (one per wing), plus 2 toilets. Rooms are numbered by floor: 101.., 401.., 501... Safe to re-run.
const FLOORS = [['Civil', '1st Floor', 1], ['CSE', '4th Floor', 4], ['AIML', '5th Floor', 5]];
const WINGS = [['A', 2], ['B', 2], ['C', 1], ['D', 1], ['E', 1]];
const areas = n => {
  const out = []; let room = 1;
  WINGS.forEach(([w, classes], i) => {
    for (let c = 0; c < classes; c++) out.push([`Wing ${w} · Classroom ${n * 100 + room++}`, 'Classroom']);
    out.push([`Wing ${w} · Lab ${n}L0${i + 1}`, 'Laboratory']);
  });
  return [...out, ['Toilet 1', 'Washroom'], ['Toilet 2', 'Washroom']];
};
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [dept, floor, n] of FLOORS) {
      await client.query('INSERT INTO departments(name) VALUES($1) ON CONFLICT DO NOTHING', [dept]);
      const deptId = (await client.query('SELECT id FROM departments WHERE name=$1', [dept])).rows[0].id;
      const building = (await client.query(
        `INSERT INTO buildings(name,department_id) VALUES($1,$2)
         ON CONFLICT(name) DO UPDATE SET department_id=EXCLUDED.department_id,is_active=true RETURNING id`,
        [`${dept} Department`, deptId])).rows[0].id;
      const list = areas(n);
      for (const [name, type] of list) await client.query(
        `INSERT INTO spots(building_id,floor,name,location_type) VALUES($1,$2,$3,$4)
         ON CONFLICT(building_id,floor,name) DO UPDATE SET location_type=EXCLUDED.location_type,is_active=true`,
        [building, floor, name, type]);
      // Remove areas from earlier layouts; keep (but hide) any that reports or inspections already point to.
      const names = list.map(a => a[0]), stale = 'building_id=$1 AND NOT (floor=$2 AND name=ANY($3))';
      await client.query(`DELETE FROM spots s WHERE ${stale} AND NOT EXISTS (SELECT 1 FROM complaints c WHERE c.spot_id=s.id)
        AND NOT EXISTS (SELECT 1 FROM inspections i WHERE i.spot_id=s.id)`, [building, floor, names]);
      await client.query(`UPDATE spots SET is_active=false WHERE ${stale}`, [building, floor, names]);
      console.log(`${dept} Department · ${floor}: ${list.map(a => a[0]).join(', ')}`);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
