const { Pool } = require('pg'), cfg = require('./config');
const pool = new Pool({ connectionString: cfg.dbUrl });
module.exports = { pool, q: (t, p) => pool.query(t, p) };
