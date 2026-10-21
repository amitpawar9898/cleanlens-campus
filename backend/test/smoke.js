// End-to-end API test. Start the server first (npm start), then: npm run smoke
const B = process.env.API || 'http://localhost:4000/api', ORIGIN = B.replace(/\/api$/, '');
const seed = require('../src/config').seed;
const { pool } = require('../src/db');
let adminToken, fixtureUsers = [], fixtureComplaint, fixtureBuilding, fixtureInspection, fixtureDepartment;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function call(method, path, body, token, form) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body && !form) h['content-type'] = 'application/json';
  const r = await fetch(B + path, { method, headers: h, body: form || (body ? JSON.stringify(body) : undefined) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j };
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const img = () => new Blob([PNG], { type: 'image/png' });
const login = async (e, p) => (await call('POST', '/auth/login', { email: e, password: p })).j;
async function cleanup() {
  if (fixtureInspection) await pool.query('DELETE FROM inspections WHERE id=$1', [fixtureInspection]);
  if (fixtureComplaint) await pool.query('DELETE FROM complaints WHERE id=$1', [fixtureComplaint]);
  if (fixtureBuilding) await pool.query('DELETE FROM buildings WHERE id=$1', [fixtureBuilding]);
  if (fixtureDepartment) await pool.query('DELETE FROM departments WHERE id=$1', [fixtureDepartment]);
  if (fixtureUsers.length) {
    await pool.query('DELETE FROM complaints WHERE reporter_id=ANY($1::int[])', [fixtureUsers]);
    await pool.query('UPDATE audit_log SET actor_id=NULL WHERE actor_id=ANY($1::int[])', [fixtureUsers]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::int[])', [fixtureUsers]);
  }
  await pool.end();
}
(async () => {
  if (!seed.email || !seed.password) throw new Error('Configure SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running smoke tests.');
  let r = await call('GET', '/health'); ok(r.s === 200 && r.j.ok, 'health');
  const adminLogin = await login(seed.email, seed.password), adm = adminToken = adminLogin.access_token;
  r = await call('GET','/ai/providers/status',null,adm); ok(r.s===200 && typeof r.j.configured==='boolean' && !JSON.stringify(r.j).includes('sk-'),'AI provider status is safe and does not return keys');
  const email = 'smoke' + Date.now() + '@sit.edu';
  if(require('../src/config').publicRegistration){r=await call('POST','/auth/register',{name:'Smoke Student',email,password:'Student@123'});ok(r.s===201,'public registration can be enabled');}
  else{r=await call('POST','/auth/register',{name:'Smoke Student',email,password:'Student@123'});ok(r.s===403,'public registration is disabled by default');r=await call('POST','/users',{name:'Smoke Student',email,password:'Student@123',role:'student'},adm);if(r.s!==201)throw new Error('Unable to create smoke test student: '+JSON.stringify(r.j));fixtureUsers.push(r.j.id);}
  const stu=await login(email,'Student@123');
  fixtureUsers.push(stu.user.id);
  if(require('../src/config').publicRegistration){r = await call('POST', '/auth/register', { name: 'x', email: 'bad', password: '1' }); ok(r.s === 400, 'validation rejects bad input');}
  r = await call('POST', '/auth/login', { email: seed.email, password: 'wrong' }); ok(r.s === 401, 'wrong password rejected');
  const departments = await call('GET', '/users/departments', null, adm);
  const housekeeping = departments.j.find(item => item.name === 'Housekeeping');
  const waste = departments.j.find(item => item.name === 'Waste Management');
  if (!housekeeping || !waste) throw new Error('Seeded campus departments are missing; run npm run seed.');
  const suffix = Date.now();
  const cleanerEmail = `smoke.cleaner.${suffix}@sit.edu`, otherCleanerEmail = `smoke.other.${suffix}@sit.edu`, staffEmail = `smoke.staff.${suffix}@sit.edu`, wasteCleanerEmail = `smoke.waste.${suffix}@sit.edu`;
  for (const [name, userEmail, role] of [
    ['Smoke Cleaner', cleanerEmail, 'cleaner'],
    ['Other Smoke Cleaner', otherCleanerEmail, 'cleaner'],
    ['Smoke Supervisor', staffEmail, 'staff']
  ]) {
    r = await call('POST', '/users', { name, email: userEmail, password: 'SmokePass@123', role, department_id: housekeeping.id }, adm);
    if (r.s !== 201) throw new Error('Unable to create workflow test account: ' + JSON.stringify(r.j));
    fixtureUsers.push(r.j.id);
  }
  r = await call('POST', '/users', { name: 'Waste Smoke Cleaner', email: wasteCleanerEmail, password: 'SmokePass@123', role: 'cleaner', department_id: waste.id }, adm);
  if (r.s !== 201) throw new Error('Unable to create cross-department test account: ' + JSON.stringify(r.j));
  fixtureUsers.push(r.j.id);
  const stf = (await login(staffEmail, 'SmokePass@123')).access_token;
  const cl = await login(cleanerEmail, 'SmokePass@123');
  r = await call('GET', '/complaints'); ok(r.s === 401, 'no token = 401');
  r = await call('GET', '/users', null, stu.access_token); ok(r.s === 403, 'student cannot list users');
  r = await call('PATCH', `/users/${stu.user.id}`, { role: 'admin' }, stu.access_token); ok(r.s === 403, 'student cannot change roles');
  r = await call('POST', '/locations/buildings', { name: `Smoke Campus ${suffix}`, department_id: housekeeping.id }, adm);
  if (r.s !== 201) throw new Error('Unable to create smoke-test building: ' + JSON.stringify(r.j));
  const b = r.j; fixtureBuilding = b.id;
  r = await call('POST', `/locations/buildings/${b.id}/spots`, { floor: 'Ground Floor', name: 'Test location', location_type:'Washroom' }, adm);
  if (r.s !== 201 || r.j.location_type!=='Washroom') throw new Error('Unable to create smoke-test spot: ' + JSON.stringify(r.j));
  const sp = r.j;
  r = await call('GET', '/locations/buildings', null, stu.access_token); ok(r.s === 200 && r.j.some(building => building.id === b.id), 'students can select configured campus locations');
  r = await call('GET','/analytics/locations',null,adm); ok(r.s===200 && r.j.some(location=>location.spot_id===sp.id && location.department_id===housekeeping.id),'location scores include assigned department and area type');
  r = await call('GET','/analytics/locations',null,stf); ok(r.s===200 && r.j.every(location=>location.department_id===housekeeping.id),'staff location rankings are department scoped');
  const inspectionForm = new FormData(); inspectionForm.append('image', img(), 'inspection.png'); inspectionForm.append('building_id', String(b.id)); inspectionForm.append('spot_id', String(sp.id)); inspectionForm.append('client_ai', JSON.stringify({relevant:true,condition:'Needs Improvement',confidence:76,issues:[{name:'Visible litter',severity:'Medium',confidence:76}],category:'Waste',priority:'Medium',title:'Visible litter',description:'Litter is visible on the floor.',building:b.name,floor:'Ground Floor',spot:sp.name,mode:'Smoke test'}));
  r=await call('POST','/inspections',null,stu.access_token,inspectionForm); ok(r.s===201&&r.j.condition==='Needs Improvement'&&r.j.confidence===76&&r.j.ai.issues.length===1,'student saves a location-linked inspection with on-device AI results'); fixtureInspection=r.j.id;
  r=await call('GET','/inspections',null,stu.access_token); ok(r.s===200&&r.j.some(i=>i.id===fixtureInspection),'student inspection history returns their saved records');
  r=await call('GET',`/inspections/${fixtureInspection}`,null,stu.access_token); ok(r.s===200&&r.j.spot===sp.name,'student can open their saved inspection detail');
  const invalidInspectionForm=new FormData(); invalidInspectionForm.append('image',img(),'inspection.png'); invalidInspectionForm.append('client_ai','{"condition":"made up"}');
  r=await call('POST','/inspections',null,stu.access_token,invalidInspectionForm); ok(r.s===400,'invalid client AI data is rejected');
  const f = new FormData(); f.append('description', 'Dirty washroom floor'); f.append('category', 'Cleaning'); f.append('priority', 'High'); f.append('building_id', b.id); f.append('spot_id', sp.id); f.append('photos', img(), 'a.png');
  r = await call('POST', '/complaints', null, stu.access_token, f); ok(r.s === 201 && r.j.code && r.j.status === 'Submitted', 'student creates a submitted complaint with photo'); const cid = fixtureComplaint = r.j.id;
  r = await call('GET', '/complaints/' + cid, null, stu.access_token); ok(r.s === 200 && r.j.photos.length === 1, 'student sees their complaint photo');
  r = await call('GET', '/notifications', null, stu.access_token); ok(r.s === 200 && r.j.items.some(n => /Complaint submitted/.test(n.title)), 'student receives submission notification');
  const noPhoto = new FormData(); noPhoto.append('description', 'Missing photo check');
  r = await call('POST', '/complaints', null, stu.access_token, noPhoto); ok(r.s === 400, 'complaint without a photo is rejected');
  const bad = new FormData(); bad.append('description', 'x'); bad.append('photos', new Blob(['not an image'], { type: 'text/plain' }), 'a.txt');
  r = await call('POST', '/complaints', null, stu.access_token, bad); ok(r.s === 400, 'non-image upload rejected');
  const spoof = new FormData(); spoof.append('description','Spoofed image content'); spoof.append('photos',new Blob(['not really a png'],{type:'image/png'}),'spoof.png');
  r=await call('POST','/complaints',null,stu.access_token,spoof);ok(r.s===400,'image MIME spoof with invalid file signature rejected');
  r = await call('PATCH', '/complaints/' + cid, { status: 'Resolved' }, stu.access_token); ok(r.s === 403, 'student cannot change status');
  r = await call('PATCH', '/complaints/' + cid, { status: 'In Progress' }, adm); ok(r.s === 400, 'invalid complaint status transition rejected');
  r = await call('POST', '/tasks', { complaint_id: cid, cleaner_id: 1 }, adm); ok(r.s === 400, 'admin cannot assign an unreviewed complaint');
  r = await call('PATCH', '/complaints/' + cid, { status: 'Reviewed' }, adm); ok(r.s === 200 && r.j.status === 'Reviewed', 'admin reviews submitted complaint');
  r = await call('PATCH', '/complaints/' + cid, { status: 'Rejected' }, adm); ok(r.s === 400, 'rejecting a complaint requires a reason');
  r = await call('POST', '/users', { name: 'Unassigned Cleaner', email: 'nobody' + Date.now() + '@sit.edu', password: 'Cleaner@123', role: 'cleaner' }, adm); ok(r.s === 400, 'staff and cleaner accounts require a department');
  const wasteCl = await login(wasteCleanerEmail, 'SmokePass@123');
  r = await call('POST', '/tasks', { complaint_id: cid, cleaner_id: wasteCl.user.id }, adm); ok(r.s === 400, 'admin cannot assign work outside the complaint department');
  const due = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  r = await call('POST', '/tasks', { complaint_id: cid, cleaner_id: cl.user.id, instructions: 'Mop and disinfect', due_at: due }, adm); ok(r.s === 201, 'admin assigns task with deadline and instructions'); const tid = r.j.id;
  const newDue = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  r = await call('PATCH', `/tasks/${tid}`, { due_at: newDue }, adm); ok(r.s === 200 && new Date(r.j.due_at).getTime() === new Date(newDue).getTime(), 'admin updates task deadline');
  r = await call('GET', '/tasks/' + tid, null, stu.access_token); ok(r.s === 403, 'student cannot access task details');
  const cl2 = await login(otherCleanerEmail, 'SmokePass@123');
  r = await call('GET', '/tasks/' + tid, null, cl2.access_token); ok(r.s === 403, 'cleaner cannot access another cleaner task');
  r = await call('GET', '/tasks/' + tid, null, cl.access_token); ok(r.s === 200 && r.j.complaint_description === 'Dirty washroom floor' && r.j.complaint_photos.length === 1 && r.j.checklist.length === 5, 'cleaner sees complaint details, photo, and checklist');
  r = await call('GET', '/notifications', null, cl.access_token); ok(r.j.items.some(n => /Deadline updated/.test(n.title)), 'cleaner receives task deadline update notification');
  r = await call('PATCH', `/tasks/${tid}/start`, null, adm); ok(r.s === 403, 'admin cannot perform cleaner work actions');
  r = await call('PATCH', `/tasks/${tid}/start`, null, cl.access_token); ok(r.s === 200, 'cleaner starts task');
  const missingBefore = new FormData(); missingBefore.append('after_photo', img(), 'b.png');
  r = await call('POST', `/tasks/${tid}/complete`, null, cl.access_token, missingBefore); ok(r.s === 400, 'task submission requires both before and after photos');
  const g = new FormData(); g.append('before_photo', img(), 'before.png'); g.append('after_photo', img(), 'after.png'); g.append('before_score', '40'); g.append('after_score', '90');
  r = await call('POST', `/tasks/${tid}/complete`, null, cl.access_token, g); ok(r.s === 400, 'task cannot be submitted with an incomplete checklist');
  r = await call('PATCH', `/tasks/${tid}/checklist`, { checklist: [
    { id: 'inspect', completed: true }, { id: 'debris', completed: true }, { id: 'surfaces', completed: true },
    { id: 'supplies', completed: true }, { id: 'safety', completed: true }
  ] }, cl.access_token); ok(r.s === 200 && r.j.checklist.every(x => x.completed), 'cleaner checklist is persisted');
  r = await call('POST', `/tasks/${tid}/complete`, null, cl.access_token, g); ok(r.s === 200 && r.j.status === 'Submitted for Verification', 'cleaner submits for verification');
  r = await call('POST', `/tasks/${tid}/complete`, null, cl.access_token, g); ok(r.s === 400, 'task cannot be submitted twice without restarting');
  r = await call('GET', '/notifications', null, stf); ok(r.j.items.some(n => /needs verification/.test(n.title)), 'reviewer receives verification notification');
  r = await call('GET', '/complaints/' + cid, null, stu.access_token); ok(r.j.status === 'Pending Verification', 'complaint waits for supervisor (not resolved yet)');
  r = await call('GET', '/tasks/' + tid, null, stf); ok(r.s === 200 && r.j.before_url.startsWith('/files/') && r.j.after_url.startsWith('/files/') && r.j.checklist.every(x => x.completed), 'reviewer sees private before/after evidence and completed checklist');
  r = await call('POST', `/tasks/${tid}/verify`, { approve: true }, cl.access_token); ok(r.s === 403, 'cleaner cannot verify their own work');
  r = await call('POST', `/tasks/${tid}/verify`, { approve: false }, stf); ok(r.s === 400, 'rejecting needs a reason');
  r = await call('POST', `/tasks/${tid}/verify`, { approve: false, reason: 'Corners still dirty' }, stf); ok(r.s === 200 && r.j.status === 'Correction Required', 'supervisor returns work for correction');
  r = await call('GET', '/notifications', null, cl.access_token); ok(r.j.items.some(n => /corrections/.test(n.title)), 'cleaner notified of corrections');
  r = await call('PATCH', `/tasks/${tid}/start`, null, cl.access_token); ok(r.s === 200, 'cleaner restarts task after correction');
  const resubmit = new FormData(); resubmit.append('before_photo', img(), 'before-c.png'); resubmit.append('after_photo', img(), 'after-c.png');
  r = await call('POST', `/tasks/${tid}/complete`, null, cl.access_token, resubmit); ok(r.s === 200, 'cleaner resubmits with both photos and completed checklist');
  r = await call('POST', `/tasks/${tid}/verify`, { approve: true }, stf); ok(r.s === 200 && r.j.status === 'Verified', 'supervisor verifies');
  r = await call('GET', '/complaints/' + cid, null, stu.access_token); ok(r.j.status === 'Resolved' && r.j.events.length >= 5, 'complaint Resolved with full history');
  r = await call('GET', '/notifications', null, stu.access_token); ok(r.j.items.some(n => /resolved/.test(n.title)), 'student receives final resolution notification');
  r = await call('GET', '/tasks/' + tid, null, stf); ok(r.s === 200 && r.j.history.some(e => e.to_status === 'Verified'), 'task transition history records verification');
  const url = r.j.complaint_photos[0].url; ok(/^\/files\/[a-f0-9]{24}\.png\?exp=\d+&sig=[a-f0-9]{64}$/.test(url), 'photo URL is signed');
  const raw = await fetch(ORIGIN + url); ok(raw.status === 200 && (raw.headers.get('content-type') || '').includes('image'), 'signed link serves the photo');
  const tam = await fetch(ORIGIN + url.replace(/sig=./, 'sig=0')); ok(tam.status === 403, 'tampered link rejected');
  const pub = await fetch(ORIGIN + '/uploads/' + url.split('/files/')[1].split('?')[0]); ok(pub.status === 404, 'photos are not public at /uploads');
  const trav = await fetch(ORIGIN + '/files/..%2F..%2Fpackage.json?exp=9999999999&sig=' + '0'.repeat(64)); ok(trav.status === 403, 'path traversal blocked');
  r = await call('POST', `/complaints/${cid}/feedback`, { rating: 5 }, stu.access_token); ok(r.s === 200, 'student rates resolved complaint');
  r = await call('GET', '/analytics/summary', null, adm); ok(r.s === 200 && r.j.total >= 1, 'analytics summary');
  r = await call('GET','/analytics/summary?from=not-a-date',null,adm);ok(r.s===400,'analytics rejects invalid date filters');
  r = await call('GET','/analytics/summary?from=2020-01-01&to=2020-01-31',null,adm);ok(r.s===200,'analytics accepts a valid date range');
  r = await call('GET','/analytics/scoring',null,adm);ok(r.s===200&&r.j.version>=1,'admin reads the active scoring configuration');
  r = await call('PUT','/analytics/scoring',{Low:10,Medium:5,High:20,Critical:30,floor:30},adm);ok(r.s===400,'scoring configuration rejects out-of-order penalties');
  r = await call('GET', '/analytics/summary', null, stu.access_token); ok(r.s === 403, 'student blocked from analytics');
  r = await call('GET', '/admin/audit', null, adm); ok(r.s === 200 && r.j.some(a => a.action === 'task.verify') && r.j.some(a => a.action === 'task.reject'), 'audit log records verification decisions');
  r = await call('GET', '/admin/audit', null, stf); ok(r.s === 403, 'audit log is admin only');
  r = await call('POST','/users/departments',{name:`Smoke Department ${Date.now()}`},adm);ok(r.s===201,'admin can create departments');fixtureDepartment=r.j.id;
  r = await call('PATCH',`/users/departments/${fixtureDepartment}`,{name:`Smoke Renamed ${Date.now()}`},adm);ok(r.s===200,'admin can rename departments');
  r = await call('DELETE',`/users/departments/${fixtureDepartment}`,null,adm);ok(r.s===200,'admin can delete an unused department');fixtureDepartment=null;
  r=await call('PATCH',`/inspections/${fixtureInspection}/checklist`,{items:[1,2,3,4,5].map(i=>({id:`check-${i}`,completed:i<4})),note:'Smoke test review'},adm);ok(r.s===200&&r.j.score===80,'admin inspection checklist saves a calculated score');
  r=await call('POST',`/inspections/${fixtureInspection}/feedback`,{decision:'corrected',corrected:{condition:'Good',issues:[]},note:'Human correction'},adm);ok(r.s===201,'human AI inspection corrections persist');
  r=await call('GET',`/inspections/${fixtureInspection}`,null,adm);ok(r.s===200&&r.j.feedback.length===1&&r.j.score===80,'inspection history shows score and saved human feedback');
  r = await call('GET', '/admin/export/complaints.csv', null, adm); ok(r.s === 200 && String(r.j).includes('CLN-'), 'CSV export (admin)');
  r = await call('POST', '/auth/refresh', { refresh_token: stu.refresh_token }); ok(r.s === 200, 'refresh token works');
  r = await call('POST', '/auth/refresh', { refresh_token: stu.refresh_token }); ok(r.s === 401, 'used refresh token rejected');
  if(!require('../src/config').prod&&require('../src/config').emailProvider==='console'){
    r=await call('POST','/auth/forgot-password',{email},adm);ok(r.s===200&&!!r.j.dev_token,'development password reset issues a temporary token');
    const resetToken=r.j.dev_token;
    r=await call('POST','/auth/reset-password',{token:resetToken,new_password:'Student@456'},adm);ok(r.s===200,'password reset token can be used once');
    r=await call('POST','/auth/login',{email,password:'Student@456'});ok(r.s===200,'reset password can sign in');
    r=await call('POST','/auth/reset-password',{token:resetToken,new_password:'Student@789'},adm);ok(r.s===400,'password reset token is one use only');
  }
  const a = new FormData(); a.append('image', img(), 'c.png'); r = await call('POST', '/ai/analyze', null, adm, a); ok([200, 503].includes(r.s), 'AI analyze (503 = no server key configured)');
  await cleanup();
  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed'); process.exit(fails ? 1 : 0);
})().catch(async e => { console.error(e); try { await cleanup(); } catch (cleanupError) { console.error('Test cleanup failed:', cleanupError); } process.exit(1); });
