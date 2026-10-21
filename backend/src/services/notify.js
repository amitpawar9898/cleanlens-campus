const { q } = require('../db');
async function notify(userIds, title, body, data, runner = q) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const run = typeof runner === 'function' ? runner : runner.query.bind(runner);
  for (const id of ids) await run('INSERT INTO notifications(user_id,title,body,data) VALUES($1,$2,$3,$4)', [id, title, body || null, data ? JSON.stringify(data) : null]);
}
const staffFor = async dept => (await q("SELECT id FROM users WHERE is_active AND (role='admin' OR (role='staff' AND department_id=$1))", [dept])).rows.map(r => r.id);
const event = (cid, actor, type, note, runner = q) => {
  const run = typeof runner === 'function' ? runner : runner.query.bind(runner);
  return run('INSERT INTO complaint_events(complaint_id,actor_id,type,note) VALUES($1,$2,$3,$4)', [cid, actor, type, note || null]);
};
module.exports = { notify, staffFor, event };
