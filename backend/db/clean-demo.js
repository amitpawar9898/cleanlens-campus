const { pool } = require('../src/db'), cfg = require('../src/config');

const DEMO_EMAILS = [
  'admin@sit.edu',
  'staff@sit.edu',
  'cleaner1@sit.edu',
  'cleaner2@sit.edu',
  'cleaner.maintenance@sit.edu',
  'cleaner.waste@sit.edu',
  'cleaner.pest@sit.edu',
  'cleaner.adminoffice@sit.edu',
  'rahul.sharma@sit.edu'
];
const DEMO_COMPLAINTS = [
  ['Dirty washroom', 'Cleaning'],
  ['Overflowing bin', 'Waste'],
  ['Broken tap', 'Maintenance'],
  ['Unclean classroom', 'Cleaning'],
  ['Pest issue', 'Pest']
];
const DEMO_BUILDINGS = ['Academic Block A', 'Hostel Block A', 'Hostel Block B', 'Cafeteria', 'Library', 'Main Building'];

async function main() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('No data was changed. Review the project README, back up your database, then run npm run clean:demo -- --confirm.');
  }
  if (!cfg.seed.email) throw new Error('Set SEED_ADMIN_EMAIL to the administrator that must be preserved before cleaning legacy records.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const administrator = (await client.query('SELECT role,is_active FROM users WHERE email=lower($1)', [cfg.seed.email])).rows[0];
    if (!administrator || administrator.role !== 'admin' || !administrator.is_active)
      throw new Error('Configured SEED_ADMIN_EMAIL must be an active administrator before legacy data can be cleaned.');
    const demoUser = (await client.query('SELECT id FROM users WHERE email=lower($1)', ['rahul.sharma@sit.edu'])).rows[0];
    let complaintsRemoved = 0;
    if (demoUser) {
      for (const [title, category] of DEMO_COMPLAINTS) {
        const result = await client.query('DELETE FROM complaints WHERE reporter_id=$1 AND title=$2 AND category=$3', [demoUser.id, title, category]);
        complaintsRemoved += result.rowCount;
      }
    }
    let buildingsRemoved = 0;
    for (const name of DEMO_BUILDINGS) {
      const result = await client.query(`DELETE FROM buildings b WHERE b.name=$1
        AND NOT EXISTS(SELECT 1 FROM complaints c WHERE c.building_id=b.id) RETURNING b.id`, [name]);
      buildingsRemoved += result.rowCount;
    }
    let usersRemoved = 0, usersSkipped = 0;
    for (const email of DEMO_EMAILS) {
      if (email === String(cfg.seed.email).toLowerCase()) continue;
      const user = (await client.query('SELECT id FROM users WHERE email=lower($1)', [email])).rows[0];
      if (!user) continue;
      const referenced = await client.query(`SELECT
        EXISTS(SELECT 1 FROM complaints WHERE reporter_id=$1 OR assigned_to=$1) OR
        EXISTS(SELECT 1 FROM tasks WHERE cleaner_id=$1 OR reviewed_by=$1) OR
        EXISTS(SELECT 1 FROM inspections WHERE inspector_id=$1) AS used`, [user.id]);
      if (referenced.rows[0].used) { usersSkipped++; continue; }
      await client.query('UPDATE audit_log SET actor_id=NULL WHERE actor_id=$1', [user.id]);
      await client.query('UPDATE complaint_events SET actor_id=NULL WHERE actor_id=$1', [user.id]);
      await client.query('UPDATE task_events SET actor_id=NULL WHERE actor_id=$1', [user.id]);
      await client.query('DELETE FROM users WHERE id=$1', [user.id]);
      usersRemoved++;
    }
    await client.query('COMMIT');
    console.log(`Legacy demo cleanup complete: ${complaintsRemoved} sample complaints, ${buildingsRemoved} unused starter buildings and ${usersRemoved} unused demo accounts removed; ${usersSkipped} accounts retained because they have real records.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
