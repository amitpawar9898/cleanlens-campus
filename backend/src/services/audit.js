const { q } = require('../db');
exports.audit = (actor, action, target, detail, runner = q) => {
  const run = typeof runner === 'function' ? runner : runner.query.bind(runner);
  return run('INSERT INTO audit_log(actor_id,action,target,detail) VALUES($1,$2,$3,$4)', [actor, action, target || null, detail ? JSON.stringify(detail) : null]);
};
