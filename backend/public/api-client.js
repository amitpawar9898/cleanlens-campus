/* Drop-in browser client for the CleanLens API. Usage:
   const api = new CleanLensAPI('https://your-server.com/api');
   await api.login('your-registered-account@example.edu','your-password');
   const list = await api.get('/complaints?status=Open');
   const ai = await api.upload('/ai/analyze', {image: file});          // AI analysis, key stays on server
   await api.upload('/complaints', {photos:[file], category:'Waste', building_id:1, spot_id:2, description:'...'}); */
class CleanLensAPI {
  constructor(base) { this.base = base.replace(/\/$/, ''); this.t = JSON.parse(localStorage.getItem('cl_tokens') || 'null'); }
  save(t) { this.t = t; localStorage.setItem('cl_tokens', JSON.stringify(t)); }
  async login(email, password) { const t = await this.raw('POST', '/auth/login', { email, password }); this.save(t); return t.user; }
  logout() { if (this.t) this.raw('POST', '/auth/logout', { refresh_token: this.t.refresh_token }).catch(() => {}); this.t = null; localStorage.removeItem('cl_tokens'); }
  async raw(method, path, body, form, retry = true) {
    const h = {}; if (this.t) h.Authorization = 'Bearer ' + this.t.access_token;
    if (body && !form) h['content-type'] = 'application/json';
    const r = await fetch(this.base + path, { method, headers: h, body: form || (body ? JSON.stringify(body) : undefined) });
    if (r.status === 401 && retry && this.t && path !== '/auth/refresh' && path !== '/auth/login') {
      const rr = await fetch(this.base + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: this.t.refresh_token }) });
      if (rr.ok) { this.save(await rr.json()); return this.raw(method, path, body, form, false); } this.logout();
    }
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.status = r.status; e.details = j.details; throw e; } return j;
  }
  get(p) { return this.raw('GET', p); } post(p, b) { return this.raw('POST', p, b); } patch(p, b) { return this.raw('PATCH', p, b); } del(p) { return this.raw('DELETE', p); }
  upload(p, fields, method = 'POST') { const f = new FormData(); for (const [k, v] of Object.entries(fields)) (Array.isArray(v) ? v : [v]).forEach(x => x !== undefined && x !== null && f.append(k, x)); return this.raw(method, p, null, f); }
}
