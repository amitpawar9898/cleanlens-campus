const bcrypt = require('bcryptjs'), { pool } = require('../src/db'), cfg = require('../src/config');
const DEPTS = ['Housekeeping', 'Maintenance', 'Waste Management', 'Pest Control', 'Admin Office'];
(async () => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.seed.email) || !cfg.seed.password || cfg.seed.password.length < 12) {
    throw new Error('Set a valid SEED_ADMIN_EMAIL and a unique SEED_ADMIN_PASSWORD (at least 12 characters) in .env before seeding.');
  }
  for (const d of DEPTS) await pool.query('INSERT INTO departments(name) VALUES($1) ON CONFLICT DO NOTHING', [d]);
  const existing = (await pool.query('SELECT role,is_active FROM users WHERE email=lower($1)', [cfg.seed.email])).rows[0];
  if (existing && (existing.role !== 'admin' || !existing.is_active))
    throw new Error('SEED_ADMIN_EMAIL already belongs to a non-admin or disabled account; choose a different administrator email.');
  if (!existing) await pool.query(
    "INSERT INTO users(name,email,password_hash,role) VALUES($1,lower($2),$3,'admin')",
    ['Campus Administrator', cfg.seed.email, await bcrypt.hash(cfg.seed.password, 10)]
  );
  console.log('Seed complete. Departments and the configured administrator are ready; no users, campus locations or complaints were added.');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
