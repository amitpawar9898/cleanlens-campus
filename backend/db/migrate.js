const fs = require('fs'), path = require('path'), { pool } = require('../src/db');
(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Schema applied.'); await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
