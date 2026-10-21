const { JSDOM, VirtualConsole } = require('jsdom');
const seed = require('../src/config').seed;
const { pool } = require('../src/db');
const API = process.env.API || 'http://localhost:4000/api';
const ORIGIN = API.replace(/\/api\/?$/, '');
const fixtures = { users: [], building: null, complaint: null };
const errs = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errs.push('JSDOM: ' + (e.detail && e.detail.message || e.message))); vc.on('error', m => errs.push('console.error: ' + m));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function request(path, body) {
  const response = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`);
  return result;
}
(async () => {
  if (!seed.email || !seed.password) throw new Error('Configure SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running UI tests.');
  const adminSession = await request('/auth/login', { email: seed.email, password: seed.password });
  const suffix = Date.now();
  const studentEmail = `ui.student.${suffix}@sit.edu`, cleanerEmail = `ui.cleaner.${suffix}@sit.edu`;
  // Registration is disabled by default; provision test users through the admin API.
  const student = await fetch(API + '/users', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + adminSession.access_token },
    body: JSON.stringify({ name: 'UI Test Student', email: studentEmail, password: 'UiStudent@123', role: 'student' })
  }).then(async response => {
    if (!response.ok) throw new Error('Unable to provision UI student: ' + await response.text());
    return response.json();
  });
  fixtures.users.push(student.id);
  const departments = await fetch(API + '/users/departments', { headers: { Authorization: 'Bearer ' + adminSession.access_token } }).then(r => r.json());
  const waste = departments.find(item => item.name === 'Waste Management');
  if (!waste) throw new Error('Seeded departments are missing; run npm run seed.');
  const location = await fetch(API + '/locations/buildings', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + adminSession.access_token },
    body: JSON.stringify({ name: `UI Test Campus ${suffix}` })
  }).then(async response => {
    if (!response.ok) throw new Error('Unable to provision UI building: ' + await response.text());
    return response.json();
  });
  fixtures.building = location.id;
  const spot = await fetch(API + `/locations/buildings/${location.id}/spots`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + adminSession.access_token },
    body: JSON.stringify({ floor: 'Ground Floor', name: `Test location ${suffix}` })
  });
  if (!spot.ok) throw new Error('Unable to provision UI location: ' + await spot.text());
  const cleanerCreate = await fetch(API + '/users', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + adminSession.access_token },
    body: JSON.stringify({ name: 'UI Test Cleaner', email: cleanerEmail, password: 'UiCleaner@123', role: 'cleaner', department_id: waste.id })
  });
  if (!cleanerCreate.ok) throw new Error('Unable to provision UI cleaner: ' + await cleanerCreate.text());
  fixtures.users.push((await cleanerCreate.json()).id);
  const dom = await JSDOM.fromURL(ORIGIN + '/', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => typeof u === 'string' && u.startsWith('data:image/png;base64,')
        ? Promise.resolve(new Response(Buffer.from(u.split(',')[1], 'base64'), { headers: { 'content-type': 'image/png' } }))
        : fetch(u, o);
      w.FormData = FormData; w.Blob = Blob; w.scrollTo = () => {}; w.confirm = () => true;
    } });
  const w = dom.window, $ = s => w.document.querySelector(s); await sleep(800);
  let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  async function login(email, pw) { w.logout && w.logout(); $('#em').value = email; $('#pw').value = pw; await w.enter(); await sleep(1200); }
  const view = () => $('#view').textContent;
  await login(studentEmail, 'UiStudent@123');
  ok($('#app').style.display === 'flex' && /Report a Cleanliness Issue/.test(view()), 'student dashboard shows the report form');
  ok(!/Dirty washroom|Overflowing bin|Broken tap|Unclean classroom|Pest issue/.test(view()), 'student dashboard contains no hard-coded demo complaints');
  for (const p of ['Report Issue', 'Complaints', 'Inspections', 'Locations', 'Notifications', 'Profile']) { w.go(p); await sleep(150); ok(view().length > 40, 'student screen renders: ' + p); }
  w.go('Inspections'); await sleep(500); ok(/Inspection history/.test(view()), 'student can open their saved inspection history');
  w.go('Locations'); await sleep(100); ok($('#map').querySelectorAll('.pin').length >= 1, 'map has pins from server');
  ok(![...w.document.querySelectorAll('#nav .nb')].some(b => /Analytics|Admin/.test(b.textContent)), 'student nav hides Analytics/Admin');
  // submit complaint through the wizard
  w.go('Report Issue'); await sleep(100); w.eval("R.cat='Waste';R.pri='High';R.desc='Test overflowing bin';R.bld=Object.keys(BL)[0];R.fl='Ground Floor';R.loc=Object.values(BL[R.bld])[0][0];R.photos=['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='];step=4"); w.go('Report Issue'); await sleep(100);
  await w.nx(1); await sleep(1500); ok(view().includes('Test overflowing bin') || w.eval('C').some(c => c.t.includes('Test overflowing')), 'wizard submit creates complaint on server');
  // admin
  await login(seed.email, seed.password); ok(w.eval('role') === 'Admin', 'admin login');
  for (const p of ['Dashboard', 'Complaints', 'Analytics', 'Cleaning Tasks', 'Admin', 'Inspections', 'Locations']) { w.go(p); await sleep(150); ok(view().length > 40, 'admin screen renders: ' + p); }
  w.go('Analytics'); ok(/Complaints by Category/.test(view()) && /Location Cleanliness/.test(view()), 'analytics charts from server data');
  for (const t of ['Users', 'Locations', 'AI settings', 'Assign']) { w.eval("af='"+t+"'"); w.go('Admin'); await sleep(250); ok(view().length > 60, 'admin tab: ' + t); }
  w.eval("af='AI settings'"); w.go('Admin'); await sleep(250); ok(!!$('#mu')&&!!$('#cn'), 'admin can configure an on-device custom model and class labels');
  const C_=()=>w.eval('C'),T_=()=>w.eval('T'),N_=()=>w.eval('N'); const c = C_().find(x => x.t === 'Test overflowing bin'); ok(!!c, 'new student complaint appears in the admin portal');
  fixtures.complaint = c?._id;
  w.eval("af='Assign'"); w.go('Admin'); await sleep(500); await w.reviewComplaint(c._id); await sleep(400); await w.markComplaintReviewed(c._id); await sleep(700);
  ok(C_().find(x => x.id === c.id).st === 'Reviewed', 'admin reviews a complaint via API');
  w.eval("af='Assign'"); w.go('Admin'); const o = C_().find(x => x.id === c.id); await w.ap(o.id, 'Critical'); await sleep(600);
  const sel = w.document.getElementById('as_' + o.id); ok(sel && sel.value, 'assign dropdown lists cleaners'); await w.as_(o.id); await sleep(1200); ok(T_().length >= 1, 'assigning creates a task');
  // cleaner
  await login(cleanerEmail, 'UiCleaner@123'); ok(w.eval('role') === 'Cleaner', 'cleaner login');
  ok([...w.document.querySelectorAll('#nav .nb')].map(b => b.textContent.trim()).join('|') === 'Dashboard|Cleaning Tasks|Notifications|Profile', 'cleaner has a dedicated navigation menu');
  w.go('Cleaning Tasks'); await sleep(200); ok(/My Cleaning Tasks|Task/.test(view()), 'cleaner sees assigned task');
  ok(T_().length >= 1, 'cleaner has tasks from server'); await w.startTask(T_()[0]._id); await sleep(1000); ok(T_()[0].s === 'In Progress', 'cleaner starts task');
  w.go('Notifications'); await sleep(100); ok(N_().length >= 1, 'cleaner got notification');
  await w.rall(); await sleep(600); ok(N_().every(n => !n.u), 'mark all as read works');
  w.logout(); ok($('#login').style.display === 'flex' && !w.eval('api.t'), 'logout clears the authenticated session');
  await login(studentEmail, 'wrongpass'); ok(/Wrong email or password/.test($('#err').textContent), 'wrong password message shown');
  await cleanup();
  console.log(errs.length ? '\nJS ERRORS:\n' + errs.join('\n') : '\nNo JS errors'); console.log(fails ? fails + ' FAILED' : 'UI test passed'); process.exit(fails || errs.length ? 1 : 0);
})().catch(async e => { console.error(e); try { await cleanup(); } catch (cleanupError) { console.error('Test cleanup failed:', cleanupError); } process.exit(1); });

async function cleanup() {
  if (fixtures.complaint) await pool.query('DELETE FROM complaints WHERE id=$1', [fixtures.complaint]);
  if (fixtures.building) await pool.query('DELETE FROM buildings WHERE id=$1', [fixtures.building]);
  if (fixtures.users.length) {
    await pool.query('DELETE FROM complaints WHERE reporter_id=ANY($1::int[])', [fixtures.users]);
    await pool.query('UPDATE audit_log SET actor_id=NULL WHERE actor_id=ANY($1::int[])', [fixtures.users]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [fixtures.users]);
  }
  await pool.end();
}
