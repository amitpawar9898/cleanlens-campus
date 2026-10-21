(() => {
  const loginHelp = document.querySelector('#demo');
  if (loginHelp) loginHelp.textContent = 'Students can register. Staff and cleaners need an account created by an administrator. Complaints and tasks are stored in the connected campus database.';
  const apiGet = api.get.bind(api);
  let taskRows = [];
  let complaintRows = [];
  api.get = async path => {
    const result = await apiGet(path);
    if (path.startsWith('/tasks')) taskRows = result.items || [];
    if (path.startsWith('/complaints?')) complaintRows = result.items || [];
    return result;
  };
  const baseRefresh = refresh;
  refresh = async () => {
    await baseRefresh();
    T.forEach(task => {
      const source = taskRows.find(item => item.id === task._id);
      if (source) {
        task.department_id = source.department_id;
        task.p = source.priority;
        task.cleaner_id = source.cleaner_id;
        task.checklist = source.checklist;
        task.review_note = source.review_note;
        task.complaint_photos = source.complaint_photos;
      }
    });
    C.forEach(complaint => {
      const source = complaintRows.find(item => item.id === complaint._id);
      if (source) complaint.department_id = source.department_id;
    });
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
  const allowed = {
    Admin: ['Dashboard', 'Complaints', 'Cleaning Tasks', 'Inspections', 'Locations', 'Analytics', 'Notifications', 'Profile', 'Admin'],
    Staff: ['Dashboard', 'Complaints', 'Cleaning Tasks', 'Inspections', 'Locations', 'Analytics', 'Notifications', 'Profile'],
    Cleaner: ['Dashboard', 'Cleaning Tasks', 'Notifications', 'Profile'],
    Student: ['Dashboard', 'Report Issue', 'Complaints', 'Inspections', 'Locations', 'Notifications', 'Profile']
  };
  const baseGo = go;
  const searchBox = document.createElement('input');
  searchBox.type = 'search';
  searchBox.className = 'cl-global-search';
  searchBox.placeholder = 'Search current page…';
  searchBox.setAttribute('aria-label', 'Search rows and task cards on the current page');
  document.querySelector('.tb .x')?.after(searchBox);
  const filterCurrentPage = () => {
    const query = searchBox.value.trim().toLocaleLowerCase();
    document.querySelectorAll('#view tbody tr, #view .cl-task-card').forEach(item => {
      item.hidden = !!query && !item.textContent.toLocaleLowerCase().includes(query);
    });
  };
  searchBox.addEventListener('input', filterCurrentPage);
  navOk = name => (allowed[role] || allowed.Student).includes(name);
  go = page => {
    if (!navOk(page)) page = 'Dashboard';
    baseGo(page);
    searchBox.value = '';
    if (page === 'Cleaning Tasks') document.querySelector('#view').innerHTML = I['Cleaning Tasks']();
    document.body.dataset.portal = String(role || 'Student').toLowerCase();
    if (role === 'Admin' && page === 'Admin') {
      if (af === 'Assign') { addAssignmentOptions(); addComplaintReviewButtons(); syncCleaners(); }
      if (af === 'Users') syncUsers();
    }
  };

  function addComplaintReviewButtons() {
    const rows = document.querySelectorAll('#view .tw tr');
    rows.forEach((row, index) => {
      const complaint = C[index - 1];
      if (!complaint || complaint.st !== 'Submitted' || row.querySelector('.cl-review-complaint')) return;
      const cell = row.lastElementChild;
      if (!cell) return;
      const button = document.createElement('button');
      button.className = 'btn o s cl-review-complaint';
      button.textContent = 'Review';
      button.type = 'button';
      button.addEventListener('click', () => reviewComplaint(complaint._id));
      cell.prepend(button);
    });
  }

  function addAssignmentOptions() {
    const table = document.querySelector('#view .tw');
    if (!table || document.querySelector('.cl-assignment-options')) return;
    const options = document.createElement('div');
    options.className = 'cl-assignment-options';
    options.innerHTML = '<label>Task instructions<input id="cl-task-instructions" maxlength="500" placeholder="Describe the cleaning required"></label>' +
      '<label>Deadline<input id="cl-task-deadline" type="datetime-local"></label>';
    table.parentNode.insertBefore(options, table);
  }

  async function syncCleaners() {
    try {
      const cleaners = await api.get('/users/cleaners');
      cleaners.forEach(cleaner => {
        const user = U.find(item => item._id === cleaner.id);
        if (user) user.department_id = cleaner.department_id;
      });
      document.querySelectorAll('#view .tw tr').forEach((row, index) => {
        const complaint = C[index - 1];
        const select = row.querySelector('select[id^="as_"]');
        if (!complaint || !select) return;
        const available = cleaners.filter(cleaner => cleaner.department_id === complaint.department_id);
        const selected = select.value;
        select.innerHTML = available.map(cleaner =>
          `<option value="${Number(cleaner.id)}">${escape(cleaner.name)}</option>`
        ).join('');
        if (available.some(cleaner => String(cleaner.id) === selected)) select.value = selected;
      });
    } catch (error) { toast(errMsg(error)); }
  }

  as_ = async id => {
    const complaint = C.find(item => item.id === id);
    const cleaner = document.getElementById('as_' + id);
    if (!complaint || !cleaner || !cleaner.value) return toast('Select an active cleaner first.');
    const due = document.getElementById('cl-task-deadline')?.value;
    const instructions = document.getElementById('cl-task-instructions')?.value.trim();
    try {
      await api.post('/tasks', {
        complaint_id: complaint._id,
        cleaner_id: Number(cleaner.value),
        instructions: instructions || undefined,
        due_at: due ? new Date(due).toISOString() : undefined
      });
      toast('Task assigned with its deadline and instructions.');
      await refresh();
      bell();
      go('Admin');
    } catch (error) { toast(errMsg(error)); }
  };

  const baseSubmitComplaint = ssub;
  ssub = async () => {
    if (role === 'Student' && !SPH) {
      const error = document.querySelector('#se');
      if (error) error.textContent = 'Add a complaint photo before submitting.';
      return;
    }
    return baseSubmitComplaint();
  };
  du = async index => {
    const user = U[index];
    if (!user) return;
    const active = user.active !== false;
    if (!confirm(`${active ? 'Deactivate' : 'Activate'} ${user.n}?`)) return;
    try {
      await api.patch('/users/' + user._id, { is_active: !active });
      toast(`Account ${active ? 'deactivated' : 'activated'}.`);
      await refresh(); go('Admin');
    } catch (error) { toast(errMsg(error)); }
  };
  async function syncUsers() {
    const select = document.querySelector('#ur');
    if (select && ![...select.options].some(option => option.value === 'staff'))
      select.add(new Option('Staff', 'staff'));
    try {
      const [result, departments] = await Promise.all([api.get('/users?limit=100'), api.get('/users/departments')]);
      result.items.forEach(user => {
        const entry = U.find(item => item._id === user.id);
        if (entry) Object.assign(entry, {
          active: user.is_active, email: user.email, department_id: user.department_id, phone: user.phone
        });
      });
      const form = document.querySelector('#view .row.f');
      if (form && !document.querySelector('#cl-user-department')) {
        const department = document.createElement('select');
        department.id = 'cl-user-department';
        department.style.cssText = 'flex:1;width:auto';
        department.innerHTML = '<option value="">Department</option>' + departments.map(item =>
          `<option value="${Number(item.id)}">${escape(item.name)}</option>`
        ).join('');
        form.insertBefore(department, form.querySelector('button'));
      }
      document.querySelectorAll('#view table tr').forEach((row, index) => {
        const entry = U[index - 1];
        const button = row.querySelector('button');
        if (!entry || !button) return;
        button.textContent = entry.active ? 'Deactivate' : 'Activate';
        const actions = button.parentElement;
        if (!actions.querySelector('.cl-edit-user')) {
          const edit = document.createElement('button');
          edit.className = 'btn o s cl-edit-user';
          edit.textContent = 'Edit';
          edit.addEventListener('click', () => editUser(entry._id));
          actions.prepend(edit);
        }
      });
    } catch (error) { toast(errMsg(error)); }
  }
  au = async () => {
    const name = document.querySelector('#un2')?.value.trim();
    const email = document.querySelector('#ue')?.value.trim();
    const password = document.querySelector('#up')?.value;
    const roleName = document.querySelector('#ur')?.value.toLowerCase();
    const departmentId = Number(document.querySelector('#cl-user-department')?.value) || undefined;
    if (['staff', 'cleaner'].includes(roleName) && !departmentId) return toast('Select a department for staff and cleaner accounts.');
    try {
      await api.post('/users', { name, email, password, role: roleName, department_id: departmentId });
      toast('User account created.');
      await refresh(); go('Admin');
    } catch (error) { toast(errMsg(error)); }
  };
  async function editUser(id) {
    try {
      const user = U.find(item => item._id === id);
      if (!user) return;
      const departments = await api.get('/users/departments');
      const overlay = document.createElement('div');
      overlay.className = 'cl-task-overlay';
      overlay.innerHTML = `<section class="cl-task-dialog" role="dialog" aria-modal="true" aria-labelledby="cl-edit-user-title">
        <button class="cl-modal-close" aria-label="Close user editor" onclick="this.closest('.cl-task-overlay').remove()">×</button>
        <h2 id="cl-edit-user-title">Edit user account</h2><p class="mu">${escape(user.email || '')}</p>
        <label class="cl-notes">Full name<input id="cl-edit-name" maxlength="80" value="${escape(user.n)}"></label>
        <label class="cl-notes">Role<select id="cl-edit-role">${['student', 'staff', 'cleaner', 'admin'].map(value => `<option value="${value}" ${value === (user.r || '').toLowerCase() ? 'selected' : ''}>${escape(value)}</option>`).join('')}</select></label>
        <label class="cl-notes">Department<select id="cl-edit-department"><option value="">No department</option>${departments.map(item =>
          `<option value="${Number(item.id)}" ${item.id === user.department_id ? 'selected' : ''}>${escape(item.name)}</option>`
        ).join('')}</select></label>
        <button class="btn" id="cl-save-user">Save changes</button>
      </section>`;
      overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
      overlay.querySelector('#cl-save-user').addEventListener('click', async () => {
        const roleName = overlay.querySelector('#cl-edit-role').value;
        const departmentId = Number(overlay.querySelector('#cl-edit-department').value) || undefined;
        if (['staff', 'cleaner'].includes(roleName) && !departmentId) return toast('Select a department for staff and cleaner accounts.');
        try {
          await api.patch('/users/' + id, { name: overlay.querySelector('#cl-edit-name').value.trim(), role: roleName, department_id: departmentId });
          overlay.remove(); toast('User account updated.'); await refresh(); go('Admin');
        } catch (error) { toast(errMsg(error)); }
      });
    } catch (error) { toast(errMsg(error)); }
  }

  function taskButton(task) {
    if (task.s === 'Assigned') return 'Start task';
    if (task.s === 'Correction Required' || task.s === 'Rejected') return 'Review feedback and retry';
    if (task.s === 'In Progress') return 'Continue task';
    if (task.s === 'Submitted for Verification' && ['Admin', 'Staff'].includes(role)) return 'Review submission';
    if (task.s === 'Submitted for Verification') return 'Awaiting verification';
    return 'View task';
  }
  I['Cleaning Tasks'] = () => {
    const tasks = T;
    const tabs = ['All', 'Assigned', 'In Progress', 'Submitted for Verification', 'Correction Required', 'Verified'];
    const filtered = tasks.filter(task => tf === 'All' || task.s === tf);
    return hd(role === 'Cleaner' ? 'My Cleaning Tasks' : 'Cleaning Tasks', 'Review the report, location, deadline and evidence for each assigned task.') +
      `<div class="cl-task-filters">${tabs.map(tab => `<button class="chip ${tf === tab ? 'on' : ''}" onclick="tf='${escape(tab)}';go('Cleaning Tasks')">${escape(tab)} (${tab === 'All' ? tasks.length : tasks.filter(task => task.s === tab).length})</button>`).join('')}</div>` +
      `<div class="cl-task-grid">${filtered.length ? filtered.map(task => `<article class="card cl-task-card">
        <div class="row sp"><b>${escape(task.code)}</b>${pill(escape(task.p))}</div>
        <h3>${escape(task.ttl)}</h3><p class="mu">${escape(task.loc)} · ${escape(task.d)}</p>
        <div class="row sp"><span>${pill(escape(task.s))}</span><span class="mu">${task.due ? 'Due ' + escape(new Date(task.due).toLocaleString()) : 'No deadline set'}</span></div>
        <button class="btn s" type="button" onclick="adv(${Number(task._id)})">${escape(taskButton(task))}</button>
      </article>`).join('') : '<div class="card mu">No tasks in this status yet.</div>'}</div>`;
  };

  function closeTask() {
    document.querySelector('.cl-task-overlay')?.remove();
  }
  async function reviewComplaint(id) {
    try {
      const complaint = await api.get('/complaints/' + encodeURIComponent(id));
      const overlay = document.createElement('div');
      overlay.className = 'cl-task-overlay';
      const photos = (complaint.photos || []).map(photo =>
        `<a href="${escape(photo.url)}" target="_blank" rel="noopener"><img src="${escape(photo.url)}" alt="Complaint photograph"></a>`
      ).join('');
      overlay.innerHTML = `<section class="cl-task-dialog" role="dialog" aria-modal="true" aria-labelledby="cl-complaint-title">
        <button class="cl-modal-close" aria-label="Close complaint review" onclick="this.closest('.cl-task-overlay').remove()">×</button>
        <p class="mu">${escape(complaint.code)} · ${escape(complaint.status)}</p><h2 id="cl-complaint-title">${escape(complaint.title)}</h2>
        <div class="cl-task-facts"><span><b>Category</b>${escape(complaint.category)}</span><span><b>Priority</b>${pill(escape(complaint.priority))}</span><span><b>Location</b>${escape([complaint.building, complaint.floor, complaint.spot].filter(Boolean).join(' · ') || 'Not specified')}</span></div>
        <h3>Student description</h3><p>${escape(complaint.description || 'No description provided.')}</p>
        <h3>Photographs</h3><div class="cl-evidence">${photos || '<p class="mu">No photographs attached.</p>'}</div>
        <h3>Complaint history</h3><ol class="cl-history">${(complaint.events || []).map(event => `<li><b>${escape(event.type)}</b><span>${escape(event.note || '')} · ${escape(event.actor || 'System')} · ${escape(new Date(event.created_at).toLocaleString())}</span></li>`).join('')}</ol>
        ${complaint.status === 'Submitted' ? `<button class="btn" onclick="markComplaintReviewed(${Number(complaint.id)})">Mark reviewed</button>` : '<p class="mu">This complaint has already been reviewed.</p>'}
      </section>`;
      overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    } catch (error) { toast(errMsg(error)); }
  }
  window.reviewComplaint = reviewComplaint;
  window.markComplaintReviewed = async id => {
    try {
      await api.patch('/complaints/' + id, { status: 'Reviewed' });
      toast('Complaint reviewed. It can now be assigned.');
      document.querySelector('.cl-task-overlay')?.remove();
      await refresh(); bell(); go('Admin');
    } catch (error) { toast(errMsg(error)); }
  };
  async function showTask(id) {
    try {
      const task = await api.get('/tasks/' + encodeURIComponent(id));
      closeTask();
      const overlay = document.createElement('div');
      overlay.className = 'cl-task-overlay';
      const photos = (task.complaint_photos || []).map(photo =>
        `<a href="${escape(photo.url)}" target="_blank" rel="noopener"><img src="${escape(photo.url)}" alt="Student complaint photo (${escape(photo.kind)})"></a>`
      ).join('');
      const evidence = [
        task.before_url && `<a href="${escape(task.before_url)}" target="_blank" rel="noopener"><img src="${escape(task.before_url)}" alt="Before cleaning evidence"><span>Before cleaning</span></a>`,
        task.after_url && `<a href="${escape(task.after_url)}" target="_blank" rel="noopener"><img src="${escape(task.after_url)}" alt="After cleaning evidence"><span>After cleaning</span></a>`
      ].filter(Boolean).join('');
      const editable = role === 'Cleaner' && task.status === 'In Progress';
      const checklist = (task.checklist || []).map(item =>
        `<label class="cl-check-item"><input type="checkbox" data-check-id="${escape(item.id)}" ${item.completed ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>${escape(item.label)}</span></label>`
      ).join('');
      const actions = role === 'Cleaner' && ['Assigned', 'Correction Required', 'Rejected'].includes(task.status)
        ? `<button class="btn" onclick="startTask(${Number(task.id)})">Start / resume cleaning</button>`
        : editable
          ? `<label class="cl-file">Before photo<input id="cl-before" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label>
             <label class="cl-file">After photo<input id="cl-after" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"></label>
             <label class="cl-notes">Completion notes<textarea id="cl-notes" maxlength="500" placeholder="Describe the work completed"></textarea></label>
             <button class="btn" onclick="submitTask(${Number(task.id)})">Submit for verification</button>`
          : role !== 'Cleaner' && task.status === 'Submitted for Verification'
            ? `<label class="cl-notes">Review note (required for corrections)<textarea id="cl-review-note" maxlength="500" placeholder="Record the verification decision"></textarea></label>
               <div class="row"><button class="btn" onclick="verifyTask(${Number(task.id)},true)">Approve work</button><button class="btn r" onclick="verifyTask(${Number(task.id)},false)">Return for correction</button></div>`
            : '<p class="mu">No action is available for this task status.</p>';
      overlay.innerHTML = `<section class="cl-task-dialog" role="dialog" aria-modal="true" aria-labelledby="cl-task-title">
        <button class="cl-modal-close" aria-label="Close task details" onclick="closeTask()">×</button>
        <p class="mu">${escape(task.code)} · ${escape(task.status)}</p><h2 id="cl-task-title">${escape(task.title)}</h2>
        <div class="cl-task-facts"><span><b>Location</b>${escape([task.building, task.spot].filter(Boolean).join(' · ') || 'Not specified')}</span>
        <span><b>Priority</b>${pill(escape(task.priority))}</span><span><b>Deadline</b>${task.due_at ? escape(new Date(task.due_at).toLocaleString()) : 'Not set'}</span></div>
        <h3>Complaint details</h3><p>${escape(task.complaint_description || 'No additional description.')}</p>
        <h3>Student photographs</h3><div class="cl-evidence">${photos || '<p class="mu">No complaint photographs were attached.</p>'}</div>
        <h3>Cleaner checklist</h3><div class="cl-checklist">${checklist || '<p class="mu">No checklist is available.</p>'}</div>
        ${editable ? '<p class="mu cl-save-state" aria-live="polite">Checklist changes are saved automatically.</p>' : ''}
        ${task.review_note ? `<p class="cl-review-note"><b>Reviewer feedback:</b> ${escape(task.review_note)}</p>` : ''}
        <h3>Cleaning evidence</h3><div class="cl-evidence">${evidence || '<p class="mu">Before and after evidence will appear here after submission.</p>'}</div>
        ${task.notes ? `<h3>Completion notes</h3><p>${escape(task.notes)}</p>` : ''}
        <h3>Task history</h3><ol class="cl-history">${(task.history || []).map(event => `<li><b>${escape(event.to_status || event.note || 'Update')}</b><span>${escape(event.note || '')} · ${escape(event.actor || 'System')} · ${escape(new Date(event.created_at).toLocaleString())}</span></li>`).join('') || '<li>Task assigned</li>'}</ol>
        <div class="cl-task-actions">${actions}</div>
      </section>`;
      overlay.addEventListener('click', event => { if (event.target === overlay) closeTask(); });
      document.body.appendChild(overlay);
      overlay.querySelectorAll('[data-check-id]').forEach(input => input.addEventListener('change', () => saveChecklist(task.id, overlay)));
      overlay.querySelector('.cl-modal-close').focus();
    } catch (error) { toast(errMsg(error)); }
  }

  const baseAdminView = V.Admin;
  V.Admin = () => {
    if (role !== 'Admin') return baseAdminView();
    if (['Departments', 'Scoring', 'Locations','Audit'].includes(af))
      return dashboardTitle(af === 'Scoring' ? 'Cleanliness scoring' : af === 'Departments' ? 'Departments' : af==='Audit'?'Audit history':'Campus locations', 'Manage campus data and review changes made in the system.') +
        `<div class="cl-admin-tabs">${['Assign','Users','Locations','Departments','Scoring','Audit','AI settings'].map(t=>`<button class="chip ${af===t?'on':''}" onclick="af='${t}';go('Admin')">${t}</button>`).join('')}</div><div id="cl-admin-workspace" class="card"><p class="mu">Loading…</p></div>`;
    return baseAdminView().replace("['Assign','Users','Locations','Appearance','AI settings']", "['Assign','Users','Locations','Departments','Scoring','Audit','Appearance','AI settings']");
  };
  const baseAdminInit = I.Admin;
  I.Admin = () => {
    baseAdminInit?.();
    if (role !== 'Admin') return;
    const target = document.querySelector('#cl-admin-workspace');
    if (!target) return;
    if (af === 'Departments') loadDepartments(target);
    if (af === 'Locations') loadLocations(target);
    if (af === 'Scoring') loadScoring(target);
    if (af === 'Audit') loadAudit(target);
  };
  async function loadDepartments(target) {
    try {
      const rows = await api.get('/users/departments');
      target.innerHTML = `<h2>Department directory</h2><form id="cl-dept-form" class="row"><input name="name" required minlength="2" maxlength="80" placeholder="New department name"><button class="btn">Add department</button></form>
        <div class="tw"><table><thead><tr><th>Department</th><th>ID</th><th>Actions</th></tr></thead><tbody>${rows.map(d=>`<tr><td>${escape(d.name)}</td><td>${d.id}</td><td><button class="btn o s" data-rename="${d.id}" data-name="${escape(d.name)}">Rename</button> <button class="btn r s" data-delete="${d.id}" data-name="${escape(d.name)}">Delete</button></td></tr>`).join('')||'<tr><td colspan="3">No departments yet.</td></tr>'}</tbody></table></div>`;
      target.querySelector('#cl-dept-form').onsubmit=async e=>{e.preventDefault();try{await api.post('/users/departments',{name:new FormData(e.currentTarget).get('name')});toast('Department added');loadDepartments(target)}catch(x){toast(errMsg(x))}};
      target.querySelectorAll('[data-rename]').forEach(button=>button.onclick=async()=>{const name=prompt('Department name',button.dataset.name);if(!name)return;try{await api.patch('/users/departments/'+button.dataset.rename,{name});toast('Department updated');loadDepartments(target)}catch(x){toast(errMsg(x))}});
      target.querySelectorAll('[data-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('Delete department '+button.dataset.name+'?'))return;try{await api.del('/users/departments/'+button.dataset.delete);toast('Department deleted');loadDepartments(target)}catch(x){toast(errMsg(x))}});
    } catch(e) { target.innerHTML=`<p class="cl-error">${escape(errMsg(e))}</p>`; }
  }
  async function loadLocations(target) {
    try {
      const [rows,departments]=await Promise.all([api.get('/locations/buildings'),api.get('/users/departments')]);
      const types=['Classroom','Laboratory','Washroom','Hostel','Canteen','Library','Office','Outdoor','Other'];
      target.innerHTML=`<h2>Add campus location</h2><p class="mu">Add coordinates if you want the map pin to reflect the building's actual position. Leave both blank to use the campus overview layout.</p><form id="cl-building-form" class="row"><input name="building" required placeholder="Building name"><select name="department_id"><option value="">Assign department</option>${departments.map(d=>`<option value="${d.id}">${escape(d.name)}</option>`).join('')}</select><input name="lat" type="number" step="any" min="-90" max="90" placeholder="Latitude (optional)"><input name="lng" type="number" step="any" min="-180" max="180" placeholder="Longitude (optional)"><button class="btn o">Add building</button></form>
        <form id="cl-spot-form" class="row"><select name="building_id" required><option value="">Select building</option>${rows.filter(b=>b.is_active).map(b=>`<option value="${b.id}">${escape(b.name)}</option>`).join('')}</select><input name="floor" placeholder="Floor" value="Ground Floor"><input name="name" required placeholder="Room or area"><select name="location_type">${types.map(x=>`<option>${x}</option>`).join('')}</select><button class="btn">Add location</button></form>
        ${rows.map(b=>`<section class="cl-location-group"><div class="row sp"><div><h3>${escape(b.name)} ${b.is_active?'':'(inactive)'}</h3><label class="mu">Department <select data-building-department="${b.id}"><option value="">Unassigned</option>${departments.map(d=>`<option value="${d.id}" ${d.id===b.department_id?'selected':''}>${escape(d.name)}</option>`).join('')}</select></label><p class="mu">Map coordinates: ${b.lat==null||b.lng==null?'not set':`${escape(b.lat)}, ${escape(b.lng)}`}</p></div><div class="row"><button class="btn o s" data-building-coordinates="${b.id}" data-lat="${b.lat??''}" data-lng="${b.lng??''}">Set map coordinates</button><button class="btn o s" data-save-building-department="${b.id}">Save department</button><button class="btn o s" data-building="${b.id}" data-active="${!b.is_active}">${b.is_active?'Deactivate':'Activate'}</button></div></div><div class="tw"><table><thead><tr><th>Floor</th><th>Area</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>${b.spots.map(s=>`<tr><td>${escape(s.floor)}</td><td>${escape(s.name)}</td><td>${escape(s.location_type||'Other')}</td><td>${s.is_active?'Active':'Inactive'}</td><td><button class="btn o s" data-spot-edit="${s.id}" data-name="${escape(s.name)}" data-floor="${escape(s.floor)}" data-type="${escape(s.location_type||'Other')}">Edit</button> <button class="btn r s" data-spot-active="${s.id}" data-active="${!s.is_active}">${s.is_active?'Deactivate':'Activate'}</button></td></tr>`).join('')||'<tr><td colspan="5">No areas added.</td></tr>'}</tbody></table></div></section>`).join('')}`;
      target.querySelector('#cl-building-form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget)),hasLat=d.lat.trim()!=='',hasLng=d.lng.trim()!=='';if(hasLat!==hasLng)return toast('Enter both latitude and longitude, or leave both blank.');try{await api.post('/locations/buildings',{name:d.building,department_id:d.department_id?Number(d.department_id):null,...(hasLat?{lat:Number(d.lat),lng:Number(d.lng)}:{})});toast('Building added');loadLocations(target);await refresh()}catch(x){toast(errMsg(x))}};
      target.querySelector('#cl-spot-form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));try{await api.post(`/locations/buildings/${d.building_id}/spots`,{floor:d.floor||'Ground Floor',name:d.name,location_type:d.location_type});toast('Campus area added');loadLocations(target);await refresh()}catch(x){toast(errMsg(x))}};
      target.querySelectorAll('[data-building]').forEach(button=>button.onclick=async()=>{try{await api.patch(`/locations/buildings/${button.dataset.building}/active`,{is_active:button.dataset.active==='true'});loadLocations(target);await refresh()}catch(x){toast(errMsg(x))}});
      target.querySelectorAll('[data-building-coordinates]').forEach(button=>button.onclick=async()=>{const lat=prompt('Building latitude (−90 to 90)',button.dataset.lat),lng=prompt('Building longitude (−180 to 180)',button.dataset.lng);if(lat===null||lng===null)return;const y=Number(lat),x=Number(lng);if(!Number.isFinite(y)||!Number.isFinite(x)||y < -90||y > 90||x < -180||x > 180)return toast('Enter valid latitude and longitude values.');try{await api.patch(`/locations/buildings/${button.dataset.building}`,{lat:y,lng:x});toast('Map coordinates saved');loadLocations(target);await refresh()}catch(error){toast(errMsg(error))}});
      target.querySelectorAll('[data-save-building-department]').forEach(button=>button.onclick=async()=>{const id=button.dataset.saveBuildingDepartment,department_id=Number(target.querySelector(`[data-building-department="${id}"]`).value)||null;try{await api.patch(`/locations/buildings/${id}`,{department_id});toast('Area assignment saved');loadLocations(target)}catch(x){toast(errMsg(x))}});
      target.querySelectorAll('[data-spot-active]').forEach(button=>button.onclick=async()=>{try{await api.patch(`/locations/spots/${button.dataset.spotActive}`,{is_active:button.dataset.active==='true'});loadLocations(target);await refresh()}catch(x){toast(errMsg(x))}});
      target.querySelectorAll('[data-spot-edit]').forEach(button=>button.onclick=async()=>{const name=prompt('Area name',button.dataset.name);if(!name)return;const floor=prompt('Floor',button.dataset.floor)||button.dataset.floor;const type=prompt('Type (Classroom, Laboratory, Washroom, Hostel, Canteen, Library, Office, Outdoor, Other)',button.dataset.type)||button.dataset.type;try{await api.patch(`/locations/spots/${button.dataset.spotEdit}`,{name,floor,location_type:type});toast('Campus area updated');loadLocations(target);await refresh()}catch(x){toast(errMsg(x))}});
    } catch(e) { target.innerHTML=`<p class="cl-error">${escape(errMsg(e))}</p>`; }
  }
  async function loadScoring(target) {
    try {
      const cfg=await api.get('/analytics/scoring'), f=cfg.factors;
      target.innerHTML=`<h2>Active scoring model · version ${cfg.version}</h2><p class="mu">Set the penalty per open complaint and the minimum cleanliness score. Higher-priority issues should carry larger penalties.</p><form id="cl-score-form" class="cl-scoring-form">${['Low','Medium','High','Critical','floor'].map(k=>`<label>${k==='floor'?'Minimum score':k+' priority penalty'}<input name="${k}" type="number" min="0" max="100" required value="${f[k]}"></label>`).join('')}<button class="btn">Save new scoring version</button></form>`;
      target.querySelector('form').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries([...new FormData(e.currentTarget)].map(([k,v])=>[k,Number(v)]));try{const next=await api.raw('PUT','/analytics/scoring',data);toast('Scoring model v'+next.version+' is active');loadScoring(target)}catch(x){toast(errMsg(x))}};
    } catch(e) { target.innerHTML=`<p class="cl-error">${escape(errMsg(e))}</p>`; }
  }
  async function loadAudit(target) {
    try { const rows=await api.get('/admin/audit?limit=100');target.innerHTML=`<h2>Recent administrative actions</h2><p class="mu">Sensitive account, complaint, task, location and scoring changes.</p><div class="tw"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${escape(new Date(x.created_at).toLocaleString())}</td><td>${escape(x.actor||'System')}</td><td>${escape(x.action)}</td><td>${escape(x.target||'')}</td><td>${escape(JSON.stringify(x.detail||{}))}</td></tr>`).join('')||'<tr><td colspan="5">No administrative activity recorded yet.</td></tr>'}</tbody></table></div>`; }
    catch(e){target.innerHTML=`<p class="cl-error">${escape(errMsg(e))}</p>`}
  }
  const baseInspectionInit = I.Inspections;
  I.Inspections = () => {
    baseInspectionInit?.();
    const view=document.querySelector('#view');
    if(!view||view.querySelector('#cl-inspection-history'))return;
    const section=document.createElement('section'); section.id='cl-inspection-history'; section.className='card cl-inspection-history'; section.innerHTML='<h2>Inspection history</h2><p class="mu">Loading saved inspection records…</p>';
    view.appendChild(section); loadInspectionHistory(section);
  };
  async function loadInspectionHistory(section) {
    try {
      const rows=await api.get('/inspections?limit=30');
      section.innerHTML=`<div class="row sp"><div><h2>Inspection history</h2><p class="mu">Saved photo inspections and their reviewed scores</p></div><input id="cl-inspection-filter" type="search" placeholder="Filter by building or inspector" aria-label="Filter inspections"></div><div class="tw"><table><thead><tr><th>When</th><th>Building / area</th><th>Inspector</th><th>Condition</th><th>Score</th><th>Details</th></tr></thead><tbody>${rows.map(r=>`<tr data-inspection-row><td>${escape(new Date(r.created_at).toLocaleString())}</td><td>${escape([r.building,r.spot].filter(Boolean).join(' · ')||'Unassigned')}</td><td>${escape(r.inspector||'')}</td><td>${escape(r.condition||'AI unavailable')}</td><td>${r.score==null?'—':r.score+'/100'}</td><td><button class="btn o s" data-inspection-detail="${r.id}">${['Admin','Staff'].includes(role)?'Review':'View'}</button></td></tr>`).join('')||'<tr><td colspan="6">No saved inspections yet.</td></tr>'}</tbody></table></div><div id="cl-inspection-detail"></div>`;
      section.querySelector('#cl-inspection-filter').oninput=e=>section.querySelectorAll('[data-inspection-row]').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(e.target.value.toLowerCase()));
      section.querySelectorAll('[data-inspection-detail]').forEach(button=>button.onclick=()=>loadInspectionDetail(button.dataset.inspectionDetail,section.querySelector('#cl-inspection-detail')));
    } catch(e) { section.innerHTML=`<h2>Inspection history</h2><p class="cl-error">${escape(errMsg(e))}</p>`; }
  }
  async function loadInspectionDetail(id,target) {
    try {
      const r=await api.get('/inspections/'+id), items=r.checklist||[];
      const canReview=['Admin','Staff'].includes(role);
      target.innerHTML=`<article class="cl-inspection-review"><h3>${escape([r.building,r.spot].filter(Boolean).join(' · ')||'Campus inspection')} · ${escape(r.condition||'Unrated')}</h3>${r.image_url?`<img class="cl-inspection-photo" src="${escape(r.image_url)}" alt="Saved campus inspection photo">`:''}<p>${escape(r.ai?.description||'No AI description was saved.')}</p>${r.ai?.issues?.length?`<p><b>Detected:</b> ${r.ai.issues.map(i=>escape(i.name)).join(', ')} · ${Number(r.confidence)||0}% confidence</p>`:''}${canReview?`<form id="cl-inspection-checklist" data-id="${r.id}">${items.map(i=>`<label><input type="checkbox" name="${escape(i.id)}" ${i.completed?'checked':''}> ${escape(i.label)}</label>`).join('')}<label>Reviewer notes<textarea name="note" maxlength="500">${escape(r.review_note||'')}</textarea></label><p class="mu">Current score: ${r.score==null?'Not scored':r.score+'/100'}</p><button class="btn">Save inspection review</button></form>`:`<p class="mu">Review score: ${r.score==null?'Not reviewed':r.score+'/100'}${r.review_note?' · '+escape(r.review_note):''}</p>`}</article>`;
      if(!canReview)return;
      target.querySelector('form').onsubmit=async e=>{e.preventDefault();const data=new FormData(e.currentTarget);const body={items:items.map(i=>({id:i.id,completed:data.has(i.id)})),note:data.get('note')||undefined};try{await api.patch('/inspections/'+id+'/checklist',body);toast('Inspection checklist saved');loadInspectionHistory(document.querySelector('#cl-inspection-history'))}catch(x){toast(errMsg(x))}};
    } catch(e) { target.innerHTML=`<p class="cl-error">${escape(errMsg(e))}</p>`; }
  }
  V.Analytics=()=>dashboardTitle('Campus analytics','Live complaint, resolution and location performance.')+
    `<section class="card"><form id="cl-analytics-filters" class="row"><label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label><button class="btn">Apply dates</button>${role==='Admin'?'<button class="btn o" type="button" id="cl-export-csv">Export CSV</button>':''}</form></section><div id="cl-analytics-data"><div class="card mu">Loading campus data…</div></div>`;
  I.Analytics=()=>{
    const form=document.querySelector('#cl-analytics-filters'); if(!form)return;
    const render=async()=>{
      const values=new FormData(form),from=values.get('from'),to=values.get('to');
      if(from&&to&&from>to)return toast('Start date must be before end date.');
      const qs=new URLSearchParams();if(from)qs.set('from',from);if(to)qs.set('to',to);const suffix=qs.toString()?'?'+qs.toString():'';
      const box=document.querySelector('#cl-analytics-data');box.innerHTML='<div class="card mu">Loading filtered report…</div>';
      try{
        const [summary,categories,priorities,trend,locations,cleaners]=await Promise.all([api.get('/analytics/summary'+suffix),api.get('/analytics/by-category'+suffix),api.get('/analytics/by-priority'+suffix),api.get('/analytics/timeseries'+(suffix?suffix+'&':'?')+'days=90'),api.get('/analytics/locations'),api.get('/analytics/cleaners')]);
        const bar=(rows,label,color)=>rows.length?rows.map(x=>`<div class="cl-analytics-bar"><span>${escape(x[label])}</span><div class="bar"><i style="width:${Math.min(100,(x.count/Math.max(1,...rows.map(y=>y.count)))*100)}%;background:${color}"></i></div><b>${x.count}</b></div>`).join(''):'<p class="mu">No records in this date range.</p>';
        const max=Math.max(1,...trend.flatMap(x=>[x.submitted,x.resolved]));
        box.innerHTML=`<section class="cl-dashboard-stats">${dashboardStat('▦','Complaints',summary.total,'green','In selected period')}${dashboardStat('◷','Open',summary.open,'orange','Awaiting assignment')}${dashboardStat('✓','Resolved',summary.resolved,'mint','Verified and closed')}${dashboardStat('◉','Average resolution',summary.avg_resolution_hours==null?'—':(summary.avg_resolution_hours/24).toFixed(1)+' days','blue','For completed reports')}</section>
        <section class="cl-dashboard-panels"><article class="card"><h2>Complaints by category</h2>${bar(categories,'category','#16845e')}</article><article class="card"><h2>Complaints by priority</h2>${bar(priorities,'priority','#d96c25')}</article></section>
        <section class="card cl-analytics-trend"><h2>Daily activity</h2><p class="mu">Submitted and resolved complaint counts</p><div class="tw"><table><thead><tr><th>Date</th><th>Submitted</th><th>Resolved</th></tr></thead><tbody>${trend.map(x=>`<tr><td>${escape(new Date(x.day).toLocaleDateString())}</td><td>${x.submitted}</td><td>${x.resolved}</td></tr>`).join('')||'<tr><td colspan="3">No records for this period.</td></tr>'}</tbody></table></div></section>
        <section class="cl-dashboard-panels"><article class="card"><h2>Campus area cleanliness rankings</h2>${locations.length?locations.map(x=>`<div class="cl-analytics-bar"><span>${escape(x.building+' · '+x.spot)}</span><div class="bar"><i style="width:${x.score}%;background:${x.score>=85?'#16845e':x.score>=70?'#d99b26':'#c94444'}"></i></div><b>${x.score}/100</b></div>`).join(''):'<p class="mu">Add active areas to see rankings.</p>'}</article><article class="card"><h2>Cleaner performance</h2>${cleaners.length?`<div class="tw"><table><thead><tr><th>Cleaner</th><th>Tasks</th><th>Verified</th><th>Quality change</th></tr></thead><tbody>${cleaners.map(x=>`<tr><td>${escape(x.name)}</td><td>${x.tasks}</td><td>${x.completed}</td><td>${x.avg_improvement==null?'—':x.avg_improvement}</td></tr>`).join('')}</tbody></table></div>`:'<p class="mu">No cleaner task data yet.</p>'}</article></section>`;
      }catch(e){box.innerHTML=`<div class="card cl-error">${escape(errMsg(e))}</div>`}
    };
    form.onsubmit=e=>{e.preventDefault();render()};render();
    document.querySelector('#cl-export-csv')?.addEventListener('click',async()=>{try{const data=new FormData(form),p=new URLSearchParams();if(data.get('from'))p.set('from',data.get('from'));if(data.get('to'))p.set('to',data.get('to'));const response=await fetch(API+'/admin/export/complaints.csv'+(p.toString()?'?'+p:''),{headers:{Authorization:'Bearer '+api.t.access_token}});if(!response.ok)throw new Error('CSV export failed ('+response.status+')');const a=document.createElement('a');a.href=URL.createObjectURL(await response.blob());a.download='cleanlens-complaints.csv';a.click();URL.revokeObjectURL(a.href)}catch(e){toast(errMsg(e))}});
  };
  window.closeTask = closeTask;
  window.adv = id => showTask(id);
  window.rv2 = id => showTask(id);
  window.startTask = async id => {
    try {
      await api.patch('/tasks/' + id + '/start');
      await refresh(); bell(); go('Cleaning Tasks'); await showTask(id);
    } catch (error) { toast(errMsg(error)); }
  };
  async function saveChecklist(id, overlay) {
    const checklist = [...overlay.querySelectorAll('[data-check-id]')].map(input => ({ id: input.dataset.checkId, completed: input.checked }));
    const message = overlay.querySelector('.cl-save-state');
    const submit = overlay.querySelector('.cl-task-actions > .btn');
    if (submit) submit.disabled = true;
    if (message) message.textContent = 'Saving checklist…';
    try {
      await api.patch('/tasks/' + id + '/checklist', { checklist });
      if (message) message.textContent = 'Checklist saved.';
    } catch (error) {
      if (message) message.textContent = errMsg(error);
      toast(errMsg(error));
    } finally { if (submit) submit.disabled = false; }
  }
  window.submitTask = async id => {
    const before = document.querySelector('#cl-before')?.files[0];
    const after = document.querySelector('#cl-after')?.files[0];
    if (!before || !after) return toast('Choose both before and after photos.');
    if (before.size > 5 * 1024 * 1024 || after.size > 5 * 1024 * 1024) return toast('Each photo must be 5 MB or smaller.');
    const form = new FormData();
    form.append('before_photo', before, before.name);
    form.append('after_photo', after, after.name);
    form.append('notes', document.querySelector('#cl-notes')?.value.trim() || '');
    try {
      await api.raw('POST', '/tasks/' + id + '/complete', null, form);
      toast('Work submitted for supervisor verification.');
      closeTask(); await refresh(); bell(); go('Cleaning Tasks');
    } catch (error) { toast(errMsg(error)); }
  };
  window.verifyTask = async (id, approve) => {
    const reason = document.querySelector('#cl-review-note')?.value.trim();
    if (!approve && (!reason || reason.length < 3)) return toast('Add a correction reason (at least 3 characters).');
    try {
      await api.post('/tasks/' + id + '/verify', { approve, reason: reason || undefined });
      toast(approve ? 'Cleaning verified; complaint resolved.' : 'Task returned to the cleaner for correction.');
      closeTask(); await refresh(); bell(); go('Cleaning Tasks');
    } catch (error) { toast(errMsg(error)); }
  };
  const dashboardStat = (icon, title, value, tone, detail) =>
    `<article class="cl-stat"><span class="cl-stat-icon ${tone}">${icon}</span><div><span class="cl-stat-title">${title}</span><strong>${value}</strong><small>${detail}</small></div></article>`;
  const dashboardTitle = (title, subtitle, action) =>
    `<header class="cl-dashboard-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action || ''}</header>`;
  const dashboardEmpty = message => `<div class="cl-dashboard-empty">${message}</div>`;
  function adminDashboard() {
    const submitted = C.filter(item => item.st === 'Submitted');
    const awaiting = T.filter(item => item.s === 'Submitted for Verification');
    const active = T.filter(item => ['Assigned', 'In Progress', 'Correction Required'].includes(item.s));
    const categories = AN?.cc?.length
      ? AN.cc.reduce((counts, item) => { counts[item.category] = item.count; return counts; }, {})
      : C.reduce((counts, item) => { counts[item.cat] = (counts[item.cat] || 0) + 1; return counts; }, {});
    const maximum = Math.max(1, ...Object.values(categories));
    const trend = AN?.ts || [];
    const trendMaximum = Math.max(1, ...trend.flatMap(item => [item.submitted || 0, item.resolved || 0]));
    const points = key => trend.map((item, index) =>
      `${20 + index * (260 / Math.max(1, trend.length - 1))},${96 - ((item[key] || 0) / trendMaximum) * 76}`
    ).join(' ');
    const chart = trend.some(item => item.submitted || item.resolved)
      ? `<svg class="cl-trend-chart" viewBox="0 0 300 110" role="img" aria-label="Seven day complaint and resolution trend">
          <g class="cl-chart-grid">${[20, 45, 70, 95].map(y => `<line x1="12" x2="292" y1="${y}" y2="${y}"/>`).join('')}</g>
          <polyline class="cl-line-submitted" points="${points('submitted')}"/>
          <polyline class="cl-line-resolved" points="${points('resolved')}"/>
        </svg><div class="cl-chart-legend"><span><i class="submitted"></i> Submitted</span><span><i class="resolved"></i> Resolved</span></div>`
      : dashboardEmpty('Complaint activity will appear here when reports are submitted.');
    const recent = C.slice(0, 5);
    return dashboardTitle('Admin Dashboard', 'Campus cleanliness overview · Live system data',
      "<button class=\"btn\" onclick=\"go('Admin')\">Manage campus</button>") +
      `<section class="cl-dashboard-stats">
        ${dashboardStat('▣', 'Total complaints', SUM.total, 'green', 'All recorded reports')}
        ${dashboardStat('!', 'Awaiting review', submitted.length, 'orange', 'New student reports')}
        ${dashboardStat('⟳', 'Active tasks', active.length, 'blue', 'Assigned or in progress')}
        ${dashboardStat('✓', 'Resolved', SUM.Resolved, 'mint', 'Verified and completed')}
      </section>
      <section class="cl-dashboard-stats cl-dashboard-stats-secondary">
        ${dashboardStat('♙', 'Active cleaners', U.filter(user => user.r === 'Cleaner' && user.active !== false).length, 'mint', 'Available campus team')}
        ${dashboardStat('★', 'Supervisors', U.filter(user => user.r === 'Staff' && user.active !== false).length, 'blue', 'Department reviewers')}
        ${dashboardStat('◷', 'Pending verification', awaiting.length, 'red', 'Work awaiting your review')}
        ${dashboardStat('⌖', 'Campus locations', PIN.length, 'slate', 'Configured buildings')}
        ${dashboardStat('!', 'Overdue tasks', odue().length, 'orange', 'Past their due date')}
        ${dashboardStat('☺', 'Active users', U.filter(user => user.active !== false).length, 'slate', 'Enabled accounts')}
      </section>
      <section class="cl-dashboard-panels">
        <article class="card cl-dashboard-panel"><div class="row sp"><div><h2>Complaints trend</h2><p class="mu">Submitted and resolved · last 7 days</p></div><a href="#" onclick="go('Analytics');return false">View analytics</a></div>${chart}</article>
        <article class="card cl-dashboard-panel"><div class="row sp"><div><h2>Reports by category</h2><p class="mu">Distribution of recorded complaints</p></div><a href="#" onclick="go('Complaints');return false">View reports</a></div>
          ${Object.keys(categories).length ? Object.entries(categories).sort((a, b) => b[1] - a[1]).map(([category, count]) =>
            `<div class="cl-category-row"><div><span>${escape(category)}</span><b>${count}</b></div><div class="bar"><i style="width:${count / maximum * 100}%;background:#16845e"></i></div></div>`
          ).join('') : dashboardEmpty('No complaints have been submitted yet.')}
        </article>
      </section>
      <section class="card cl-dashboard-panel cl-dashboard-recent">
        <div class="row sp"><div><h2>Recent complaints</h2><p class="mu">Latest reports from across campus</p></div><button class="btn o s" onclick="go('Complaints')">View all</button></div>
        ${recent.length ? `<div class="tw"><table><thead><tr><th>Complaint</th><th>Location</th><th>Category</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead><tbody>
          ${recent.map(item => `<tr><td><b>${escape(item.id)}</b><span class="cl-cell-subtitle">${escape(item.t)}</span></td><td>${escape(item.loc || '—')}</td><td>${escape(item.cat)}</td><td>${pill(escape(item.pri))}</td><td>${pill(escape(item.st))}</td><td><button class="btn o s" onclick="go('Complaints')">Review</button></td></tr>`).join('')}
        </tbody></table></div>` : dashboardEmpty('No complaints yet. New student reports will appear here.')}
      </section>`;
  }
  function cleanerDashboard() {
    const pending = T.filter(task => ['Assigned', 'Correction Required', 'Rejected'].includes(task.s)).length;
    const active = T.filter(task => task.s === 'In Progress').length;
    const completed = T.filter(task => ['Verified', 'Completed'].includes(task.s)).length;
    const rows = T.slice(0, 6);
    return dashboardTitle('My Dashboard', `Welcome back, ${escape(who.split(' ')[0])}. Here are your assigned cleaning tasks.`,
      "<button class=\"btn\" onclick=\"go('Cleaning Tasks')\">View all tasks</button>") +
      `<section class="cl-dashboard-stats">
        ${dashboardStat('▣', 'Total tasks', T.length, 'green', 'Assigned to you')}
        ${dashboardStat('!', 'To do', pending, 'orange', 'Ready to start')}
        ${dashboardStat('⟳', 'In progress', active, 'blue', 'Currently being cleaned')}
        ${dashboardStat('✓', 'Completed', completed, 'mint', 'Verified tasks')}
      </section>
      <section class="card cl-dashboard-panel cl-dashboard-recent">
        <div class="row sp"><div><h2>My tasks</h2><p class="mu">Check the location, priority and due date before starting work.</p></div>
          <a href="#" onclick="go('Cleaning Tasks');return false">View all</a></div>
        ${rows.length ? `<div class="tw"><table><thead><tr><th>Task ID</th><th>Location</th><th>Cleaning task</th><th>Priority</th><th>Status</th><th>Due date</th><th>Action</th></tr></thead><tbody>
          ${rows.map(task => `<tr><td><b>${escape(task.code)}</b></td><td>${escape(task.loc || '—')}</td><td>${escape(task.ttl)}</td><td>${pill(escape(task.p))}</td><td>${pill(escape(task.s))}</td><td>${task.due ? escape(new Date(task.due).toLocaleString()) : 'Not set'}</td><td><button class="btn s" onclick="adv(${Number(task._id)})">${escape(taskButton(task))}</button></td></tr>`).join('')}
        </tbody></table></div>` : dashboardEmpty('No cleaning tasks are assigned to you yet. New assignments will appear here.')}
      </section>
      <section class="cl-dashboard-tip"><span>✓</span><div><b>Remember to capture before and after photos</b><p>Both photos and a completed checklist are required before submitting work for verification.</p></div></section>`;
  }
  function supervisorDashboard() {
    const submitted = T.filter(task => task.s === 'Submitted for Verification');
    const review = C.filter(item => item.st === 'Submitted');
    return dashboardTitle('Supervisor Dashboard', `Welcome back, ${escape(who.split(' ')[0])}. Review your department's work.`,
      "<button class=\"btn\" onclick=\"go('Cleaning Tasks')\">Open task queue</button>") +
      `<section class="cl-dashboard-stats">
        ${dashboardStat('▣', 'Complaints to review', review.length, 'orange', 'New department reports')}
        ${dashboardStat('⟳', 'Active tasks', T.filter(task => ['Assigned', 'In Progress', 'Correction Required'].includes(task.s)).length, 'blue', 'Assigned to your team')}
        ${dashboardStat('◷', 'Pending verification', submitted.length, 'red', 'Submitted by cleaners')}
        ${dashboardStat('!', 'Overdue tasks', odue().length, 'slate', 'Past their due date')}
      </section>
      <section class="card cl-dashboard-panel cl-dashboard-recent"><div class="row sp"><div><h2>Verification queue</h2><p class="mu">Review submitted cleaning work and evidence</p></div><a href="#" onclick="go('Cleaning Tasks');return false">View task queue</a></div>
        ${submitted.length ? `<div class="tw"><table><thead><tr><th>Task ID</th><th>Cleaner</th><th>Location</th><th>Submitted</th><th>Action</th></tr></thead><tbody>${submitted.slice(0, 6).map(task => `<tr><td><b>${escape(task.code)}</b></td><td>${escape(task.cn || '—')}</td><td>${escape(task.loc || '—')}</td><td>${task.sub ? escape(fd(task.sub)) : '—'}</td><td><button class="btn s" onclick="rv2(${Number(task._id)})">Review work</button></td></tr>`).join('')}</tbody></table></div>` : dashboardEmpty('No cleaning tasks are waiting for verification.')}
      </section>`;
  }
  V.Dashboard = () => role === 'Admin' ? adminDashboard()
    : role === 'Cleaner' ? cleanerDashboard()
      : role === 'Staff' ? supervisorDashboard()
        : stuDash();
})();
