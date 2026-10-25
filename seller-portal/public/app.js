'use strict';
// Seller Service Portal — single-page client. Auth is via an httpOnly cookie,
// so this code never touches the token; a 401 just bounces back to the login view.

// ── tiny helpers ─────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const money = (n) => (n == null || n === '') ? '—' : '₹' + Number(n).toLocaleString('en-IN');
const badge = (s) => `<span class="badge b-${esc(s)}">${esc(String(s || '').replace(/_/g, ' '))}</span>`;

let TOAST_T;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(TOAST_T); TOAST_T = setTimeout(() => t.classList.add('hidden'), 2800);
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  if (res.status === 401) { showAuth(); throw new Error('unauthenticated'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
  return data;
}

// modal
function openModal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBox').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// ── auth view ────────────────────────────────────────────────
function showAuth() { $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); }
function showApp() { $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden'); }

$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  const which = t.dataset.authtab;
  $('#loginForm').classList.toggle('hidden', which !== 'login');
  $('#signupForm').classList.toggle('hidden', which !== 'signup');
}));

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  const f = e.target, btn = f.querySelector('button'); btn.disabled = true;
  try {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: f.email.value, password: f.password.value }) });
    await boot();
  } catch (err) { $('#loginErr').textContent = err.message; }
  finally { btn.disabled = false; }
});

$('#signupForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#signupErr').textContent = '';
  const f = e.target, btn = f.querySelector('button'); btn.disabled = true;
  try {
    await api('/auth/signup', { method: 'POST', body: JSON.stringify({
      business_name: f.business_name.value, contact_name: f.contact_name.value,
      email: f.email.value, phone: f.phone.value, password: f.password.value,
    }) });
    await boot();
  } catch (err) { $('#signupErr').textContent = err.message; }
  finally { btn.disabled = false; }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  showAuth();
});

$('#linksBtn').addEventListener('click', showLinksModal);

// ── session / permissions ────────────────────────────────────
let ME = null;
const can = (p) => !!(ME && Array.isArray(ME.permissions) && ME.permissions.includes(p));
const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', manager: 'Manager', support_agent: 'Support Agent', viewer: 'Viewer' };

// ── navigation ───────────────────────────────────────────────
const VIEWS = {};
let CURRENT = 'dashboard';
$('#hamburger').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$$('.navlink').forEach(a => a.addEventListener('click', () => go(a.dataset.view)));

function go(view) {
  CURRENT = view;
  $$('.navlink').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  $('#viewTitle').textContent = ({
    dashboard: 'Dashboard', support: 'Sales & Support', listings: 'Listings',
    products: 'Products', safety: 'Safety Claims', team: 'Team',
    roles: 'Roles & Permissions', settings: 'Settings',
  })[view] || view;
  $('.sidebar').classList.remove('open');
  (VIEWS[view] || (() => {}))();
}

// ── Dashboard ────────────────────────────────────────────────
VIEWS.dashboard = async () => {
  const root = $('#viewRoot'); root.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const d = await api('/dashboard');
    root.innerHTML = `
      <div class="cards">
        <div class="card"><div class="lbl">Open support tickets</div><div class="big">${d.tickets.open}</div><div class="sub">${d.tickets.total} total</div></div>
        <div class="card"><div class="lbl">Active listings</div><div class="big">${d.listings.active}</div><div class="sub">${d.listings.total} total · ${d.listings.suppressed} suppressed</div></div>
        <div class="card"><div class="lbl">Pending safety claims</div><div class="big">${d.safety_claims.pending}</div><div class="sub">${d.safety_claims.filed} filed · ${d.safety_claims.total} total</div></div>
        ${d.installations ? `<div class="card"><div class="lbl">Pending installations</div><div class="big">${d.installations.pending}</div><div class="sub">${d.installations.installed} installed · ${d.installations.total} total</div></div>` : ''}
      </div>
      <div class="panel" style="margin-top:20px;padding:20px">
        <b>Welcome 👋</b>
        <p class="muted" style="margin:8px 0 0">Use the left menu to manage <b>Sales &amp; Support</b>, your <b>Listings</b>, and <b>Safety Claims</b>. More modules are on the way.</p>
      </div>`;
  } catch (e) { root.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
};

// ── Sales & Support (tabbed: Tickets | Installations) ────────
VIEWS.support = async () => {
  const root = $('#viewRoot');
  const tabs = [];
  if (can('support.read')) tabs.push({ k: 'tickets', label: 'Tickets' });
  if (can('installations.read')) tabs.push({ k: 'installations', label: 'Installations' });
  root.innerHTML = `
    <div class="tabs" style="max-width:320px;margin-bottom:18px">
      ${tabs.map((t, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-sstab="${t.k}">${t.label}</button>`).join('')}
    </div>
    <div id="ssBody"></div>`;
  $$('[data-sstab]').forEach(b => b.onclick = () => {
    $$('[data-sstab]').forEach(x => x.classList.toggle('active', x === b));
    renderSSTab(b.dataset.sstab);
  });
  renderSSTab(tabs[0] ? tabs[0].k : 'tickets');
};
function renderSSTab(k) {
  if (k === 'installations') renderInstallationsTab();
  else if (k === 'reviews') renderReviewsTab();
  else renderTicketsTab();
}

function renderTicketsTab() {
  $('#ssBody').innerHTML = `
    <div class="toolbar">
      <select id="tkStatus">
        <option value="">All statuses</option>
        ${['open','in_progress','waiting','resolved','closed'].map(s => `<option value="${s}">${s.replace('_',' ')}</option>`).join('')}
      </select>
      <input id="tkQ" placeholder="Search subject / order / customer" />
      <div class="spacer"></div>
      ${can('support.write') ? '<button class="btn primary" id="tkNew">+ New ticket</button>' : ''}
    </div>
    <div class="panel"><div id="tkList"><p class="empty">Loading…</p></div></div>`;
  const _tkNew = $('#tkNew'); if (_tkNew) _tkNew.onclick = ticketForm;
  $('#tkStatus').onchange = loadTickets; let dt;
  $('#tkQ').oninput = () => { clearTimeout(dt); dt = setTimeout(loadTickets, 250); };
  loadTickets();
}

function renderInstallationsTab() {
  $('#ssBody').innerHTML = `
    <div class="toolbar">
      <select id="inStatus">
        <option value="">All statuses</option>
        ${['pending','scheduled','installed','cancelled'].map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <input id="inQ" placeholder="Search customer / product / order" />
      <div class="spacer"></div>
      ${can('installations.write') ? '<button class="btn primary" id="inNew">+ New installation</button>' : ''}
    </div>
    <div class="panel"><div id="inList"><p class="empty">Loading…</p></div></div>`;
  const _inNew = $('#inNew'); if (_inNew) _inNew.onclick = () => installForm();
  $('#inStatus').onchange = loadInstallations; let dt;
  $('#inQ').oninput = () => { clearTimeout(dt); dt = setTimeout(loadInstallations, 250); };
  loadInstallations();
}
async function loadInstallations() {
  const p = new URLSearchParams();
  if ($('#inStatus')?.value) p.set('status', $('#inStatus').value);
  if ($('#inQ')?.value) p.set('q', $('#inQ').value);
  try {
    const rows = await api('/installations?' + p);
    const el = $('#inList'); if (!el) return;
    if (!rows.length) { el.innerHTML = '<p class="empty">No installation requests yet.</p>'; return; }
    el.innerHTML = `<table><thead><tr><th>Customer</th><th>Product</th><th>Location</th><th>Status</th><th>Source</th><th>Created</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td><b>${esc(r.customer_name || '—')}</b>${r.customer_phone ? `<br><span class="muted mono">${esc(r.customer_phone)}</span>` : ''}</td>
        <td>${esc(r.product_name || '—')}${r.order_id ? `<br><span class="muted mono">${esc(r.order_id)}</span>` : ''}</td>
        <td>${esc(r.city || '—')}${r.pincode ? ' · ' + esc(r.pincode) : ''}${installMapLink(r) ? ` · <a href="${esc(installMapLink(r))}" target="_blank" title="Open map">📍</a>` : ''}</td>
        <td>${badge(r.status)}${r.assigned_tech_name ? `<br><span class="muted" style="font-size:12px">👷 ${esc(r.assigned_tech_name)}</span>` : ''}</td>
        <td>${r.source === 'public' ? '<span class="pill">public</span>' : '<span class="muted">staff</span>'}</td>
        <td class="muted">${fmtDate(r.created_at)}</td>
        <td><button class="btn sm" data-manage="${r.id}">Manage</button></td></tr>`).join('')}
    </tbody></table>`;
    $$('#inList [data-manage]').forEach(b => b.onclick = () => installDetail(rows.find(x => x.id === b.dataset.manage)));
  } catch (e) { toast(e.message, true); }
}
async function installForm() {
  let active = [];
  try { active = (await api('/products')).filter(p => p.active); } catch (e) {}
  const prodField = active.length
    ? `<label>Product / model<select name="product_name"><option value="">—</option>${active.map(p => `<option>${esc(p.name)}</option>`).join('')}</select></label>`
    : `<label>Product / model<input name="product_name"></label>`;
  openModal(`<h3>New installation request</h3>
    <form id="inForm"><div class="formgrid">
      <label>Customer name<input name="customer_name" required></label>
      <label>Phone<input name="customer_phone"></label>
      <label>Email<input name="customer_email" type="email"></label>
      ${prodField}
      <label>Where did you buy it?<select name="purchased_from"><option value="">—</option><option>amazon</option><option>flipkart</option><option>website</option><option>offline dealer</option><option>other</option></select></label>
      <label>Order ID<input name="order_id"></label>
      <label class="full">Address<textarea name="address" rows="2"></textarea></label>
      <label>City<input name="city"></label>
      <label>Pincode<input name="pincode"></label>
      <label class="full">Google Maps link<input name="maps_link" placeholder="https://maps.google.com/…"></label>
      <label>Preferred date<input name="preferred_date" type="date"></label>
      <label>Preferred slot<input name="preferred_slot" placeholder="e.g. morning"></label>
      <label class="full">Notes<textarea name="notes" rows="2"></textarea></label>
    </div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Create</button></div></form>`);
  $('#inForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = f.querySelector('button.primary'); b.disabled = true;
    const body = {}; new FormData(f).forEach((v, k) => { if (v) body[k] = v; });
    try { await api('/installations', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Created'); loadInstallations(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
function installMapLink(r) {
  if (r.maps_link) return r.maps_link;
  if (r.latitude != null && r.longitude != null) return `https://www.google.com/maps?q=${r.latitude},${r.longitude}`;
  return '';
}
function installDetail(r) {
  if (!r) return;
  const w = can('installations.write');
  const statusSel = ['pending','scheduled','installed','cancelled'].map(s => `<option value="${s}"${s === r.status ? ' selected' : ''}>${s}</option>`).join('');
  openModal(`<h3>${esc(r.customer_name || 'Installation')}</h3>
    <p class="muted">${esc(r.customer_phone || '')}${r.customer_email ? ' · ' + esc(r.customer_email) : ''}</p>
    <div class="panel" style="padding:12px;margin-bottom:14px">
      <div><b>Product:</b> ${esc(r.product_name || '—')}${r.order_id ? ` · Order <span class="mono">${esc(r.order_id)}</span>` : ''} ${r.purchased_from ? `<span class="pill">${esc(r.purchased_from)}</span>` : (r.marketplace ? `<span class="pill">${esc(r.marketplace)}</span>` : '')}</div>
      ${r.customer_email ? `<div style="margin-top:6px"><b>Email:</b> ${esc(r.customer_email)}</div>` : ''}
      <div style="margin-top:6px"><b>Address:</b> ${esc(r.address || '—')}${r.city ? ', ' + esc(r.city) : ''}${r.pincode ? ' - ' + esc(r.pincode) : ''}</div>
      ${installMapLink(r) ? `<div style="margin-top:6px"><b>Location:</b> <a href="${esc(installMapLink(r))}" target="_blank">📍 Open map</a></div>` : ''}
      ${r.preferred_date ? `<div style="margin-top:6px"><b>Preferred:</b> ${esc(String(r.preferred_date).slice(0,10))} ${esc(r.preferred_slot || '')}</div>` : ''}
      <div style="margin-top:6px"><b>Source:</b> ${r.source === 'public' ? 'public form' : 'staff'}</div>
    </div>
    ${r.assigned_tech_name ? `<div class="panel" style="padding:12px;margin-bottom:14px;background:#eef6ff">
      <b>Assigned technician:</b> ${esc(r.assigned_tech_name)}${r.assigned_tech_phone ? ` · <span class="mono">${esc(r.assigned_tech_phone)}</span> · <a href="https://wa.me/${waNum(r.assigned_tech_phone)}" target="_blank">WhatsApp</a>` : ''}
    </div>` : ''}
    ${w ? `<div style="margin-bottom:14px">
      <button class="btn" id="findTech">🔍 Find nearest technician</button>
      <button class="btn" id="reviewReq"${r.customer_phone ? '' : ' disabled title="No customer phone on file"'}>⭐ Send review request</button>
      ${r.review_requested_at ? `<span class="muted" style="font-size:12px"> · requested ${fmtDate(r.review_requested_at)}</span>` : ''}
      <div id="techResults" style="margin-top:10px"></div>
    </div>` : ''}
    ${w ? `<div class="formgrid">
      <label>Status<select id="inStatusSel">${statusSel}</select></label>
      <label class="full">Notes<textarea id="inNotes" rows="3">${esc(r.notes || '')}</textarea></label>
    </div>` : `<div><b>Status:</b> ${badge(r.status)}</div>${r.notes ? `<p>${esc(r.notes)}</p>` : ''}`}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button>${w ? '<button class="btn primary" id="inSave">Save</button>' : ''}</div>`);
  const _ft = $('#findTech'); if (_ft) _ft.onclick = () => findNearestFor(r.id);
  const _rr = $('#reviewReq'); if (_rr) _rr.onclick = () => sendReviewRequest(r);
  if (w) $('#inSave').onclick = async () => {
    const b = $('#inSave'); b.disabled = true;
    try { await api('/installations/' + r.id, { method: 'PATCH', body: JSON.stringify({ status: $('#inStatusSel').value, notes: $('#inNotes').value }) }); closeModal(); toast('Saved'); loadInstallations(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
async function loadTickets() {
  const p = new URLSearchParams();
  if ($('#tkStatus')?.value) p.set('status', $('#tkStatus').value);
  if ($('#tkQ')?.value) p.set('q', $('#tkQ').value);
  try {
    const rows = await api('/tickets?' + p);
    const el = $('#tkList'); if (!el) return;
    if (!rows.length) { el.innerHTML = '<p class="empty">No tickets yet.</p>'; return; }
    el.innerHTML = `<table><thead><tr><th>Subject</th><th>Order</th><th>Customer</th><th>Category</th><th>Priority</th><th>Status</th><th>Created</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-id="${r.id}" style="cursor:pointer">
        <td><b>${esc(r.subject)}</b>${r.source === 'public' ? ' <span class="pill">public</span>' : ''}</td>
        <td><span class="mono">${esc(r.order_id || '—')}</span>${r.marketplace ? ` <span class="pill">${esc(r.marketplace)}</span>` : ''}</td>
        <td>${esc(r.customer_name || '—')}</td>
        <td>${esc(r.category || '—')}</td>
        <td>${esc(r.priority)}</td>
        <td>${badge(r.status)}</td>
        <td class="muted">${fmtDate(r.created_at)}</td></tr>`).join('')}
    </tbody></table>`;
    $$('#tkList tr[data-id]').forEach(tr => tr.onclick = () => ticketDetail(tr.dataset.id));
  } catch (e) { toast(e.message, true); }
}
function ticketForm() {
  openModal(`<h3>New support ticket</h3>
    <form id="tkForm"><div class="formgrid">
      <label class="full">Subject<input name="subject" required></label>
      <label>Marketplace<select name="marketplace"><option value="">—</option><option>amazon</option><option>flipkart</option></select></label>
      <label>Order ID<input name="order_id"></label>
      <label>Customer name<input name="customer_name"></label>
      <label>Customer contact<input name="customer_contact"></label>
      <label>Channel<select name="channel"><option value="">—</option><option>email</option><option>call</option><option>chat</option><option>marketplace</option></select></label>
      <label>Category<select name="category"><option value="">—</option><option>return</option><option>refund</option><option>replacement</option><option>complaint</option><option>query</option><option>other</option></select></label>
      <label>Priority<select name="priority"><option>normal</option><option>low</option><option>high</option><option>urgent</option></select></label>
      <label class="full">Description<textarea name="description" rows="3"></textarea></label>
    </div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Create</button></div></form>`);
  $('#tkForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = f.querySelector('button.primary'); b.disabled = true;
    const body = {}; new FormData(f).forEach((v, k) => body[k] = v);
    try { await api('/tickets', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Ticket created'); loadTickets(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
async function ticketDetail(id) {
  try {
    const t = await api('/tickets/' + id);
    const statusSel = ['open','in_progress','waiting','resolved','closed'].map(s => `<option value="${s}"${s===t.status?' selected':''}>${s.replace('_',' ')}</option>`).join('');
    const w = can('support.write');
    const contact = [t.customer_contact, t.customer_email].filter(Boolean).map(esc).join(' · ');
    const loc = [t.city, t.pincode].filter(Boolean).map(esc).join(' ');
    openModal(`<h3>${esc(t.subject)}</h3>
      <p class="muted">${esc(t.customer_name || 'no customer')}${contact ? ' · ' + contact : ''}${t.order_id ? ' · Order ' + esc(t.order_id) : ''}${t.marketplace ? ' · ' + esc(t.marketplace) : ''}${t.category ? ' · ' + esc(t.category) : ''}${loc ? ' · ' + loc : ''}</p>
      ${w ? `<div class="toolbar"><label>Status <select id="tdStatus">${statusSel}</select></label></div>` : `<div class="toolbar">Status: ${badge(t.status)}</div>`}
      ${t.description ? `<p>${esc(t.description)}</p>` : ''}
      <div class="panel" style="padding:12px;max-height:240px;overflow:auto">
        ${(t.messages||[]).map(m => `<div style="margin-bottom:8px"><b>${esc(m.author_type)}</b> <span class="muted">${fmtDate(m.created_at)}</span><br>${esc(m.body)}</div>`).join('') || '<p class="muted">No messages yet.</p>'}
      </div>
      ${w ? `<form id="tdMsg" style="display:flex;gap:8px;margin-top:12px"><input name="body" placeholder="Add a note / reply" required><button class="btn primary">Send</button></form>` : ''}
      <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`);
    const tdS = $('#tdStatus'); if (tdS) tdS.onchange = async e => { try { await api('/tickets/' + id, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }); toast('Updated'); loadTickets(); } catch (x) { toast(x.message, true); } };
    const tdM = $('#tdMsg'); if (tdM) tdM.onsubmit = async e => { e.preventDefault(); const v = e.target.body.value.trim(); if (!v) return; try { await api('/tickets/' + id + '/messages', { method: 'POST', body: JSON.stringify({ body: v }) }); ticketDetail(id); } catch (x) { toast(x.message, true); } };
  } catch (e) { toast(e.message, true); }
}

// ── Listings ─────────────────────────────────────────────────
VIEWS.listings = async () => {
  const root = $('#viewRoot');
  root.innerHTML = `
    <div class="toolbar">
      <select id="lsMkt"><option value="">All marketplaces</option><option>amazon</option><option>flipkart</option></select>
      <select id="lsStatus"><option value="">All statuses</option>${['active','inactive','suppressed','draft'].map(s=>`<option>${s}</option>`).join('')}</select>
      <input id="lsQ" placeholder="Search title / SKU / ID" />
      <div class="spacer"></div>
      ${can('listings.write') ? '<button class="btn primary" id="lsNew">+ Add listing</button>' : ''}
    </div>
    <div class="panel"><div id="lsList"><p class="empty">Loading…</p></div></div>`;
  const _lsNew = $('#lsNew'); if (_lsNew) _lsNew.onclick = () => listingForm();
  $('#lsMkt').onchange = $('#lsStatus').onchange = loadListings; let dt;
  $('#lsQ').oninput = () => { clearTimeout(dt); dt = setTimeout(loadListings, 250); };
  loadListings();
};
async function loadListings() {
  const p = new URLSearchParams();
  if ($('#lsMkt')?.value) p.set('marketplace', $('#lsMkt').value);
  if ($('#lsStatus')?.value) p.set('status', $('#lsStatus').value);
  if ($('#lsQ')?.value) p.set('q', $('#lsQ').value);
  try {
    const rows = await api('/listings?' + p);
    const el = $('#lsList'); if (!el) return;
    if (!rows.length) { el.innerHTML = '<p class="empty">No listings yet.</p>'; return; }
    el.innerHTML = `<table><thead><tr><th>Title</th><th>Marketplace</th><th>ID / SKU</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr data-id="${r.id}">
        <td><b>${esc(r.title || '—')}</b>${r.brand ? `<br><span class="muted">${esc(r.brand)}</span>` : ''}</td>
        <td><span class="pill">${esc(r.marketplace)}</span></td>
        <td><span class="mono">${esc(r.marketplace_id || '—')}</span>${r.sku ? `<br><span class="muted mono">${esc(r.sku)}</span>` : ''}</td>
        <td>${money(r.selling_price)}${r.mrp ? `<br><span class="muted"><s>${money(r.mrp)}</s></span>` : ''}</td>
        <td>${r.stock ?? '—'}</td>
        <td>${badge(r.status)}</td>
        <td><button class="btn sm" data-edit="${r.id}">Edit</button></td></tr>`).join('')}
    </tbody></table>`;
    $$('#lsList [data-edit]').forEach(b => b.onclick = () => { const row = rows.find(x => x.id === b.dataset.edit); listingForm(row); });
  } catch (e) { toast(e.message, true); }
}
function listingForm(row) {
  const r = row || {};
  openModal(`<h3>${row ? 'Edit' : 'Add'} listing</h3>
    <form id="lsForm"><div class="formgrid">
      <label>Marketplace<select name="marketplace"${row?' disabled':''}><option value="amazon"${r.marketplace==='amazon'?' selected':''}>amazon</option><option value="flipkart"${r.marketplace==='flipkart'?' selected':''}>flipkart</option></select></label>
      <label>Status<select name="status">${['active','inactive','suppressed','draft'].map(s=>`<option${r.status===s?' selected':''}>${s}</option>`).join('')}</select></label>
      <label class="full">Title<input name="title" value="${esc(r.title||'')}"></label>
      <label>Marketplace ID (ASIN/FSN)<input name="marketplace_id" value="${esc(r.marketplace_id||'')}"${row?' readonly':''}></label>
      <label>SKU<input name="sku" value="${esc(r.sku||'')}"></label>
      <label>Brand<input name="brand" value="${esc(r.brand||'')}"></label>
      <label>Category<input name="category" value="${esc(r.category||'')}"></label>
      <label>MRP<input name="mrp" type="number" step="0.01" value="${r.mrp??''}"></label>
      <label>Selling price<input name="selling_price" type="number" step="0.01" value="${r.selling_price??''}"></label>
      <label>Stock<input name="stock" type="number" value="${r.stock??''}"></label>
    </div><div class="modal-actions">
      ${row?`<button type="button" class="btn danger" id="lsDel">Delete</button>`:''}
      <div class="spacer" style="flex:1"></div>
      <button type="button" class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn primary">${row?'Save':'Add'}</button>
    </div></form>`);
  $('#lsForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = f.querySelector('button.primary'); b.disabled = true;
    const body = {}; new FormData(f).forEach((v, k) => body[k] = v);
    try {
      if (row) await api('/listings/' + r.id, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/listings', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Saved'); loadListings();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
  if (row) $('#lsDel').onclick = async () => { if (!confirm('Delete this listing?')) return; try { await api('/listings/' + r.id, { method: 'DELETE' }); closeModal(); toast('Deleted'); loadListings(); } catch (x) { toast(x.message, true); } };
}

function waNum(p) { let d = String(p || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d; return d; }
async function findNearestFor(id) {
  const box = $('#techResults'); if (!box) return;
  box.innerHTML = '<p class="muted">Locating & searching…</p>';
  try {
    const d = await api('/installations/' + id + '/nearest-technicians');
    const loc = d.location;
    box.innerHTML = `
      <p class="muted" style="font-size:12px">📍 ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} (${esc(loc.source)})</p>
      <div class="panel" style="max-height:240px;overflow:auto">
        <table><thead><tr><th>Technician</th><th>City</th><th>Dist</th><th>Rating</th><th></th></tr></thead><tbody>
        ${d.technicians.length ? d.technicians.map((t, i) => `<tr>
          <td><b>${esc(t.name || '—')}</b>${t.phone ? `<br><span class="muted mono">${esc(t.phone)}</span>` : ''} ${t.source === 'custom' ? '<span class="pill">yours</span>' : ''}</td>
          <td>${esc(t.city || '—')}</td>
          <td>${t.distance_km != null ? t.distance_km.toFixed(1) + ' km' : '—'}</td>
          <td>${t.rating ? '★ ' + t.rating : '—'}</td>
          <td><button class="btn sm" data-assign="${i}">Assign</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No technicians found nearby.</td></tr>'}
        </tbody></table>
      </div>
      <div class="toolbar" style="margin-top:10px">
        <input id="mtName" placeholder="…or assign manually: name" style="width:auto">
        <input id="mtPhone" placeholder="phone" style="width:auto">
        <button class="btn" id="mtAssign">Assign</button>
      </div>`;
    $$('#techResults [data-assign]').forEach(b => b.onclick = () => {
      const t = d.technicians[+b.dataset.assign];
      doAssign(id, { tech_name: t.name, tech_phone: t.phone, tech_source: t.source === 'custom' ? 'custom' : 'directory', place_id: t.place_id, distance_km: t.distance_km });
    });
    $('#mtAssign').onclick = () => {
      const n = $('#mtName').value.trim(); if (!n) return toast('Enter a technician name', true);
      doAssign(id, { tech_name: n, tech_phone: $('#mtPhone').value.trim(), tech_source: 'manual', save_to_roster: true });
    };
  } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
async function doAssign(id, payload) {
  try { await api('/installations/' + id + '/assign', { method: 'POST', body: JSON.stringify(payload) }); closeModal(); toast('Technician assigned'); loadInstallations(); }
  catch (e) { toast(e.message, true); }
}

// Send a review request to the customer over WhatsApp (Knite-style): one click
// opens wa.me with a prefilled message (incl. the product's review link), and
// stamps review_requested_at on the installation.
function sendReviewRequest(r) {
  if (!r || !r.customer_phone) return toast('No customer phone on file', true);
  const biz = (ME && ME.business_name) || 'us';
  const name = r.customer_name || 'there';
  const prod = r.product_name ? `your ${r.product_name}` : 'your purchase';
  let msg = `Hi ${name}, thank you for choosing ${biz}! We hope you're happy with ${prod}. Could you take a moment to leave us a quick review? It really helps us 🙏`;
  if (r.review_link) msg += `\n\n${r.review_link}`;
  window.open(`https://wa.me/${waNum(r.customer_phone)}?text=${encodeURIComponent(msg)}`, '_blank');
  api('/installations/' + r.id + '/review-request', { method: 'POST' }).then(() => loadInstallations()).catch(() => {});
  toast(r.review_link ? 'Review request opened in WhatsApp' : 'Opened WhatsApp — tip: add a review link to this product in Products');
  closeModal();
}

// ── Reviews (legacy manual-review view; no longer linked in nav) ──────────────
const stars = (n) => n ? ('★'.repeat(n) + '☆'.repeat(5 - n)) : '—';
function renderReviewsTab() {
  $('#ssBody').innerHTML = `
    <div class="toolbar">
      <select id="rvStatus"><option value="">All</option><option>published</option><option>pending</option><option>hidden</option></select>
      <input id="rvQ" placeholder="Search product / reviewer / text">
      <span id="rvSummary" class="muted"></span>
      <div class="spacer"></div>
      ${can('reviews.write') ? '<button class="btn primary" id="rvNew">+ Add review</button>' : ''}
    </div>
    <div class="panel"><div id="rvList"><p class="empty">Loading…</p></div></div>`;
  const _n = $('#rvNew'); if (_n) _n.onclick = () => reviewForm();
  $('#rvStatus').onchange = loadReviews; let dt;
  $('#rvQ').oninput = () => { clearTimeout(dt); dt = setTimeout(loadReviews, 250); };
  loadReviews();
}
async function loadReviews() {
  const p = new URLSearchParams();
  if ($('#rvStatus')?.value) p.set('status', $('#rvStatus').value);
  if ($('#rvQ')?.value) p.set('q', $('#rvQ').value);
  try {
    const d = await api('/reviews?' + p);
    const s = $('#rvSummary'); if (s) s.textContent = d.summary.count ? `★ ${d.summary.avg_rating} avg · ${d.summary.count} rated` : '';
    const el = $('#rvList'); if (!el) return;
    if (!d.reviews.length) { el.innerHTML = '<p class="empty">No reviews yet.</p>'; return; }
    el.innerHTML = `<table><thead><tr><th>Product</th><th>Rating</th><th>Review</th><th>By</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.reviews.map(r => `<tr>
        <td>${esc(r.product_name || '—')}${r.order_id ? `<br><span class="muted mono">${esc(r.order_id)}</span>` : ''}</td>
        <td style="color:#d97706;white-space:nowrap">${stars(r.rating)}</td>
        <td>${r.title ? `<b>${esc(r.title)}</b><br>` : ''}<span class="muted">${esc((r.body || '').slice(0, 80))}${(r.body || '').length > 80 ? '…' : ''}</span>${r.reply ? ' <span class="pill">replied</span>' : ''}</td>
        <td>${esc(r.reviewer_name || '—')}</td>
        <td>${badge(r.status)}</td>
        <td><button class="btn sm" data-rev="${r.id}">Open</button></td></tr>`).join('')}
    </tbody></table>`;
    $$('#rvList [data-rev]').forEach(b => b.onclick = () => reviewDetail(d.reviews.find(x => x.id === b.dataset.rev)));
  } catch (e) { toast(e.message, true); }
}
function reviewForm() {
  openModal(`<h3>Add review</h3><form id="rvForm"><div class="formgrid">
    <label>Product<input name="product_name"></label>
    <label>Rating<select name="rating"><option value="5">★★★★★ (5)</option><option value="4">★★★★ (4)</option><option value="3">★★★ (3)</option><option value="2">★★ (2)</option><option value="1">★ (1)</option></select></label>
    <label>Reviewer name<input name="reviewer_name"></label>
    <label>Order ID<input name="order_id"></label>
    <label>Marketplace<select name="marketplace"><option value="">—</option><option>amazon</option><option>flipkart</option></select></label>
    <label>Status<select name="status"><option>published</option><option>pending</option><option>hidden</option></select></label>
    <label class="full">Title<input name="title"></label>
    <label class="full">Review<textarea name="body" rows="3"></textarea></label>
  </div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Add</button></div></form>`);
  $('#rvForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = f.querySelector('button.primary'); b.disabled = true;
    const body = {}; new FormData(f).forEach((v, k) => { if (v) body[k] = v; });
    try { await api('/reviews', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Review added'); loadReviews(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
function reviewDetail(r) {
  if (!r) return;
  const w = can('reviews.write');
  openModal(`<h3>${esc(r.product_name || 'Review')}</h3>
    <p style="color:#d97706;font-size:18px;margin:4px 0">${stars(r.rating)}</p>
    ${r.title ? `<p><b>${esc(r.title)}</b></p>` : ''}
    <p>${esc(r.body || '')}</p>
    <p class="muted">— ${esc(r.reviewer_name || 'anonymous')}${r.order_id ? ` · Order ${esc(r.order_id)}` : ''}${r.marketplace ? ` · ${esc(r.marketplace)}` : ''}</p>
    ${w ? `<div class="formgrid" style="margin-top:12px">
      <label>Status<select id="rvStatusSel">${['published','pending','hidden'].map(s => `<option${r.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="full">Your reply<textarea id="rvReply" rows="2">${esc(r.reply || '')}</textarea></label>
    </div>` : (r.reply ? `<div class="panel" style="padding:10px;margin-top:10px"><b>Seller reply:</b> ${esc(r.reply)}</div>` : '')}
    <div class="modal-actions">${w ? '<button class="btn danger" id="rvDel">Delete</button>' : ''}<div style="flex:1"></div><button class="btn" onclick="closeModal()">Close</button>${w ? '<button class="btn primary" id="rvSave">Save</button>' : ''}</div>`);
  if (w) {
    $('#rvSave').onclick = async () => {
      const b = $('#rvSave'); b.disabled = true;
      try { await api('/reviews/' + r.id, { method: 'PATCH', body: JSON.stringify({ status: $('#rvStatusSel').value, reply: $('#rvReply').value }) }); closeModal(); toast('Saved'); loadReviews(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    };
    $('#rvDel').onclick = async () => { if (!confirm('Delete this review?')) return; try { await api('/reviews/' + r.id, { method: 'DELETE' }); closeModal(); toast('Deleted'); loadReviews(); } catch (e) { toast(e.message, true); } };
  }
}

// ── Safety Claims ────────────────────────────────────────────
const SAFET_URL = 'https://sellercentral.amazon.in/safet-claims/create-v2?ref_=ag_sfdcf_cont_safet';
VIEWS.safety = async () => {
  const root = $('#viewRoot');
  root.innerHTML = `
    <div class="toolbar">
      <select id="scStatus"><option value="">All</option><option value="pending">pending</option><option value="filed">filed</option></select>
      <div class="spacer"></div>
      ${can('safety.write') ? '<button class="btn primary" id="scNew">+ New claim</button>' : ''}
    </div>
    <div class="panel"><div id="scList"><p class="empty">Loading…</p></div></div>`;
  const _scNew = $('#scNew'); if (_scNew) _scNew.onclick = claimForm;
  $('#scStatus').onchange = loadClaims;
  loadClaims();
};
async function loadClaims() {
  const p = new URLSearchParams(); if ($('#scStatus')?.value) p.set('status', $('#scStatus').value);
  try {
    const rows = await api('/safety-claims?' + p);
    const el = $('#scList'); if (!el) return;
    if (!rows.length) { el.innerHTML = '<p class="empty">No safety claims yet.</p>'; return; }
    el.innerHTML = `<table><thead><tr><th>Order ID</th><th>Reason</th><th>Amount</th><th>Images</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td><a data-open="${esc(r.order_id)}" title="Open Amazon SAFE-T">${esc(r.order_id)}</a></td>
        <td>${esc(r.reason || '—')}</td>
        <td>${money(r.amount_claimed)}</td>
        <td>${r.images_expired ? '<span class="muted">expired</span>' : (r.image_count || 0)}</td>
        <td>${badge(r.status)}</td>
        <td class="muted">${fmtDate(r.created_at)}</td>
        <td style="white-space:nowrap">
          <button class="btn sm" data-manage="${esc(r.order_id)}">Manage</button>
        </td></tr>`).join('')}
    </tbody></table>`;
    $$('#scList [data-manage]').forEach(b => b.onclick = () => claimManage(b.dataset.manage));
    $$('#scList [data-open]').forEach(a => a.onclick = () => { navigator.clipboard?.writeText(a.dataset.open).catch(()=>{}); window.open(SAFET_URL, '_blank'); });
  } catch (e) { toast(e.message, true); }
}
function claimForm() {
  openModal(`<h3>New safety claim</h3>
    <form id="scForm"><div class="formgrid">
      <label class="full">Order ID<input name="order_id" required></label>
      <label>Reason<select name="reason"><option value="">—</option><option>return-abuse</option><option>refund-not-initiated</option><option>damaged-return</option><option>wrong-item</option><option>empty-box</option><option>other</option></select></label>
      <label>Amount claimed<input name="amount_claimed" type="number" step="0.01"></label>
      <label class="full">Notes<textarea name="notes" rows="2"></textarea></label>
    </div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Create</button></div></form>`);
  $('#scForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target, b = f.querySelector('button.primary'); b.disabled = true;
    const body = {}; new FormData(f).forEach((v, k) => body[k] = v);
    try { await api('/safety-claims', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Claim created'); loadClaims(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
async function claimManage(orderId) {
  try {
    const { images } = await api(`/safety-claims/${encodeURIComponent(orderId)}/images`);
    openModal(`<h3>Claim · <span class="mono">${esc(orderId)}</span></h3>
      <div class="thumbs" id="scThumbs">${images.map(n => `<img src="/api/safety-claims/${encodeURIComponent(orderId)}/image/${encodeURIComponent(n)}" alt="">`).join('') || '<span class="muted">No images uploaded.</span>'}</div>
      <div class="toolbar" style="margin-top:14px">
        <label class="btn">⬆ Upload images<input type="file" id="scUp" accept="image/*" multiple hidden></label>
        <button class="btn" id="scZip"${images.length?'':' disabled'}>⬇ Download ZIP</button>
        <a class="btn" href="${SAFET_URL}" target="_blank">↗ Open Amazon SAFE-T</a>
      </div>
      <div class="modal-actions">
        <button class="btn danger" id="scDel">Delete claim</button>
        <div style="flex:1"></div>
        <button class="btn" id="scFile">Mark as filed</button>
        <button class="btn" onclick="closeModal()">Close</button>
      </div>`);
    $('#scUp').onchange = async e => {
      const files = [...e.target.files]; if (!files.length) return;
      const lbl = e.target.closest('.btn'); const txt = lbl.textContent; lbl.style.pointerEvents = 'none';
      let i = 0;
      for (const file of files) {
        i++; lbl.textContent = `Uploading ${i}/${files.length}…`;
        const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
        try { await api(`/safety-claims/${encodeURIComponent(orderId)}/images`, { method: 'POST', body: JSON.stringify({ data, contentType: file.type }) }); }
        catch (x) { toast(x.message, true); }
      }
      toast('Uploaded'); claimManage(orderId); loadClaims();
    };
    $('#scZip').onclick = () => downloadZip(orderId, images);
    $('#scFile').onclick = async () => { try { await api(`/safety-claims/${encodeURIComponent(orderId)}/file`, { method: 'POST', body: JSON.stringify({ filed: true }) }); closeModal(); toast('Marked filed'); loadClaims(); } catch (x) { toast(x.message, true); } };
    $('#scDel').onclick = async () => { if (!confirm('Delete this claim and its images?')) return; try { await api('/safety-claims/' + encodeURIComponent(orderId), { method: 'DELETE' }); closeModal(); toast('Deleted'); loadClaims(); } catch (x) { toast(x.message, true); } };
  } catch (e) { toast(e.message, true); }
}
async function downloadZip(orderId, images) {
  if (!window.JSZip) return toast('ZIP library still loading…', true);
  const zip = new JSZip(); let i = 0;
  for (const n of images) {
    i++;
    const blob = await fetch(`/api/safety-claims/${encodeURIComponent(orderId)}/image/${encodeURIComponent(n)}`, { credentials: 'same-origin' }).then(r => r.blob());
    const ext = (n.split('.').pop() || 'jpg');
    zip.file(`${orderId}-${i}.${ext}`, blob);
  }
  const out = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(out); const a = document.createElement('a');
  a.href = url; a.download = `${orderId}.zip`; a.click(); URL.revokeObjectURL(url);
}

// ── Settings (marketplaces) ──────────────────────────────────
VIEWS.settings = async () => {
  const root = $('#viewRoot');
  root.innerHTML = `
    <div class="panel" style="padding:20px;max-width:720px;margin-bottom:18px">
      <b>Public request links</b>
      <p class="muted" style="margin:6px 0 14px">Share these with your customers to collect requests straight into the portal — no login needed on their side.</p>
      <div id="linkWrap"><p class="muted">Loading…</p></div>
    </div>
    <div class="panel" style="padding:20px;max-width:720px">
      <b>Marketplace accounts</b>
      <p class="muted" style="margin:6px 0 14px">Link the Amazon / Flipkart seller accounts you operate. (API auto-sync comes later.)</p>
      <div id="mkList"><p class="muted">Loading…</p></div>
      <form id="mkForm" class="toolbar" style="margin-top:16px">
        <select name="marketplace"><option value="amazon">amazon</option><option value="flipkart">flipkart</option></select>
        <input name="external_seller_id" placeholder="Seller / merchant ID (optional)">
        <input name="display_name" placeholder="Label (optional)">
        <button class="btn primary">Add</button>
      </form>
    </div>`;
  loadIntakeLinks();
  const load = async () => {
    try {
      const rows = await api('/marketplaces');
      $('#mkList').innerHTML = rows.length
        ? `<table><tbody>${rows.map(r => `<tr><td><span class="pill">${esc(r.marketplace)}</span></td><td>${esc(r.display_name || '—')}</td><td class="mono">${esc(r.external_seller_id || '')}</td><td>${badge(r.status)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No marketplaces linked yet.</p>';
    } catch (e) { $('#mkList').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('#mkForm').onsubmit = async e => {
    e.preventDefault(); const f = e.target; const body = {}; new FormData(f).forEach((v, k) => body[k] = v);
    try { await api('/marketplaces', { method: 'POST', body: JSON.stringify(body) }); f.reset(); toast('Added'); load(); }
    catch (err) { toast(err.message, true); }
  };
  load();
};

// ── Team (RBAC) ──────────────────────────────────────────────
let TEAM_META = { assignable_roles: [], role_labels: ROLE_LABELS };
VIEWS.team = async () => {
  const root = $('#viewRoot');
  root.innerHTML = `
    <div class="toolbar">
      <span class="muted">Add employees and assign roles. Permissions are enforced on every action.</span>
      <div class="spacer"></div>
      <button class="btn primary" id="tmNew">+ Add employee</button>
    </div>
    <div class="panel"><div id="tmList"><p class="empty">Loading…</p></div></div>`;
  $('#tmNew').onclick = () => employeeForm();
  loadTeam();
};
async function loadTeam() {
  try {
    const d = await api('/team');
    TEAM_META = { assignable_roles: d.assignable_roles || [], role_labels: d.role_labels || ROLE_LABELS };
    const el = $('#tmList'); if (!el) return;
    el.innerHTML = `<table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
      ${d.users.map(u => `<tr data-id="${u.id}">
        <td><b>${esc(u.name || '—')}</b>${u.id === ME.id ? ' <span class="pill">you</span>' : ''}</td>
        <td class="mono">${esc(u.email)}</td>
        <td>${esc(TEAM_META.role_labels[u.role] || u.role)}</td>
        <td>${u.status === 'active' ? '<span class="badge b-active">active</span>' : '<span class="badge b-inactive">disabled</span>'}</td>
        <td class="muted">${u.last_login_at ? fmtDate(u.last_login_at) : '—'}</td>
        <td>${(u.role === 'owner' && ME.role !== 'owner') ? '' : `<button class="btn sm" data-edit="${u.id}">Manage</button>`}</td>
      </tr>`).join('')}
    </tbody></table>`;
    $$('#tmList [data-edit]').forEach(b => b.onclick = () => employeeForm(d.users.find(x => x.id === b.dataset.edit)));
  } catch (e) { const el = $('#tmList'); if (el) el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function employeeForm(u) {
  const roleList = TEAM_META.assignable_roles || [];
  const defaultRole = roleList.some(r => r.key === 'support_agent') ? 'support_agent' : (roleList[0] && roleList[0].key);
  const roleOpts = (sel) => roleList.map(r => `<option value="${r.key}"${r.key === sel ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
  if (!u) {
    openModal(`<h3>Add employee</h3>
      <form id="tmForm"><div class="formgrid">
        <label>Name<input name="name"></label>
        <label>Email<input name="email" type="email" required></label>
        <label>Role<select name="role">${roleOpts(defaultRole)}</select></label>
        <label class="full">Temporary password <small>(min 8 chars)</small><input name="password" type="password" required minlength="8"></label>
      </div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Add</button></div></form>`);
    $('#tmForm').onsubmit = async e => {
      e.preventDefault(); const f = e.target, b = f.querySelector('button.primary'); b.disabled = true;
      const body = {}; new FormData(f).forEach((v, k) => body[k] = v);
      try { await api('/team', { method: 'POST', body: JSON.stringify(body) }); closeModal(); toast('Employee added'); loadTeam(); }
      catch (err) { toast(err.message, true); b.disabled = false; }
    };
    return;
  }
  const isSelf = u.id === ME.id, isOwner = u.role === 'owner';
  const locked = isSelf || isOwner;
  openModal(`<h3>Manage · ${esc(u.name || u.email)}</h3>
    ${locked ? `<p class="muted">${isSelf ? 'You cannot change your own role or status.' : 'The owner account is protected.'}</p>` : ''}
    <div class="formgrid">
      <label>Role<select id="tmRole" ${locked ? 'disabled' : ''}>${isOwner ? '<option selected>Owner</option>' : roleOpts(u.role)}</select></label>
      <label>Status<select id="tmStatus" ${locked ? 'disabled' : ''}>
        <option value="active"${u.status === 'active' ? ' selected' : ''}>active</option>
        <option value="disabled"${u.status !== 'active' ? ' selected' : ''}>disabled</option></select></label>
      <label class="full">Reset password <small>(min 8, blank = keep)</small><input id="tmPw" type="password" minlength="8" placeholder="leave blank to keep current"></label>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button><button class="btn primary" id="tmSave">Save</button></div>`);
  $('#tmSave').onclick = async () => {
    const b = $('#tmSave'); b.disabled = true;
    try {
      if (!locked) {
        await api('/team/' + u.id, { method: 'PATCH', body: JSON.stringify({ role: $('#tmRole').value, status: $('#tmStatus').value }) });
      }
      const pw = $('#tmPw').value;
      if (pw) await api('/team/' + u.id + '/reset-password', { method: 'POST', body: JSON.stringify({ password: pw }) });
      closeModal(); toast('Saved'); loadTeam();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
}

// ── Roles & permissions ──────────────────────────────────────
let ROLE_CATALOG = [];
VIEWS.roles = async () => {
  const root = $('#viewRoot');
  root.innerHTML = `
    <div class="toolbar">
      <span class="muted">Define what each role can do. Built-in roles can be edited; the Owner always has full access.</span>
      <div class="spacer"></div>
      <button class="btn primary" id="rlNew">+ New role</button>
    </div>
    <div class="panel"><div id="rlList"><p class="empty">Loading…</p></div></div>`;
  $('#rlNew').onclick = () => roleEditor(null);
  loadRolesView();
};
async function loadRolesView() {
  try {
    const d = await api('/roles');
    ROLE_CATALOG = d.catalog || [];
    const el = $('#rlList'); if (!el) return;
    el.innerHTML = `<table><thead><tr><th>Role</th><th>Type</th><th>Users</th><th>Permissions</th><th></th></tr></thead><tbody>
      ${d.roles.map(r => {
        const isOwner = r.key === 'owner';
        const permCount = isOwner ? ROLE_CATALOG.length : (r.permissions || []).length;
        return `<tr>
          <td><b>${esc(r.name)}</b> <span class="muted mono">${esc(r.key)}</span></td>
          <td>${r.is_system ? '<span class="pill">built-in</span>' : '<span class="pill">custom</span>'}</td>
          <td>${r.user_count}</td>
          <td>${permCount} / ${ROLE_CATALOG.length}</td>
          <td style="white-space:nowrap">${isOwner ? '<span class="muted">full access</span>' :
            `<button class="btn sm" data-edit="${esc(r.key)}">Edit</button>${r.is_system ? '' : ` <button class="btn sm danger" data-del="${esc(r.key)}">Delete</button>`}`}</td>
        </tr>`;
      }).join('')}
    </tbody></table>`;
    $$('#rlList [data-edit]').forEach(b => b.onclick = () => roleEditor(d.roles.find(x => x.key === b.dataset.edit)));
    $$('#rlList [data-del]').forEach(b => b.onclick = () => deleteRoleUI(d.roles.find(x => x.key === b.dataset.del)));
  } catch (e) { const el = $('#rlList'); if (el) el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function permCheckboxes(selected) {
  const sel = new Set(selected || []);
  const groups = {};
  ROLE_CATALOG.forEach(p => { (groups[p.group] = groups[p.group] || []).push(p); });
  return Object.entries(groups).map(([g, perms]) => `
    <div style="margin-bottom:14px">
      <div style="font-weight:600;margin-bottom:6px">${esc(g)}</div>
      ${perms.map(p => `<label style="display:flex;align-items:center;gap:8px;font-weight:400;margin:5px 0">
        <input type="checkbox" value="${esc(p.key)}" ${sel.has(p.key) ? 'checked' : ''} style="width:auto">
        ${esc(p.label)} <span class="muted mono">${esc(p.key)}</span></label>`).join('')}
    </div>`).join('');
}
function roleEditor(role) {
  const editing = !!role;
  openModal(`<h3>${editing ? 'Edit role' : 'New role'}</h3>
    <form id="rlForm">
      <label style="display:block;font-weight:600">Role name
        <input name="name" value="${esc(editing ? role.name : '')}" required style="margin-top:4px"></label>
      <div style="margin-top:14px;max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:14px">
        ${permCheckboxes(editing ? role.permissions : [])}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" onclick="closeModal()">Cancel</button>
        <button class="btn primary">${editing ? 'Save' : 'Create role'}</button>
      </div>
    </form>`);
  $('#rlForm').onsubmit = async e => {
    e.preventDefault();
    const b = e.target.querySelector('button.primary'); b.disabled = true;
    const nm = $('#rlForm input[name=name]').value.trim();
    const permissions = $$('#rlForm input[type=checkbox]:checked').map(c => c.value);
    try {
      if (editing) await api('/roles/' + encodeURIComponent(role.key), { method: 'PATCH', body: JSON.stringify({ name: nm, permissions }) });
      else await api('/roles', { method: 'POST', body: JSON.stringify({ name: nm, permissions }) });
      closeModal(); toast('Saved'); loadRolesView();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
async function deleteRoleUI(role) {
  if (!role) return;
  if (!confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
  try { await api('/roles/' + encodeURIComponent(role.key), { method: 'DELETE' }); toast('Role deleted'); loadRolesView(); }
  catch (e) { toast(e.message, true); }
}

// ── Public request links (Settings) ─────────────────────────
async function loadIntakeLinks() {
  const wrap = $('#linkWrap'); if (!wrap) return;
  try {
    const d = await api('/intake-links');
    if (!d.token) { wrap.innerHTML = '<p class="muted">No link token yet.</p>'; return; }
    const origin = location.origin;
    wrap.innerHTML =
      linkRow('🎧 Support request', `${origin}/r/${d.token}/support`) +
      linkRow('🔧 Installation request', `${origin}/r/${d.token}/install`) +
      `<button class="btn sm" id="regenLink" style="margin-top:12px">Regenerate links</button>
       <span class="muted" style="font-size:12px">— invalidates the current links</span>`;
    $$('#linkWrap [data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Link copied'); });
    const rg = $('#regenLink'); if (rg) rg.onclick = async () => {
      if (!confirm('Regenerate links? The current links will immediately stop working.')) return;
      try { await api('/intake-links/regenerate', { method: 'POST' }); toast('Links regenerated'); loadIntakeLinks(); }
      catch (e) { toast(e.message, true); }
    };
  } catch (e) { wrap.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function linkRow(label, url) {
  return `<div style="margin-bottom:12px">
    <div style="font-weight:600;margin-bottom:5px">${label}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input value="${esc(url)}" readonly onclick="this.select()" style="flex:1;min-width:220px;font-family:ui-monospace,Menlo,monospace;font-size:13px">
      <button class="btn sm" data-copy="${esc(url)}">Copy</button>
      <a class="btn sm" href="${esc(url)}" target="_blank">Open</a>
    </div></div>`;
}

// Top-bar "Request links" button → popup with both URLs (available to every role).
async function showLinksModal() {
  openModal(`<h3>Your public request links</h3>
    <p class="muted" style="margin-bottom:14px">Share these with your customers — no login needed on their side.</p>
    <div id="linkModalWrap"><p class="muted">Loading…</p></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`);
  try {
    const d = await api('/intake-links');
    const wrap = $('#linkModalWrap');
    if (!d.token) { wrap.innerHTML = '<p class="muted">No link available yet.</p>'; return; }
    const origin = location.origin;
    wrap.innerHTML =
      linkRow('🔧 Installation request', `${origin}/r/${d.token}/install`) +
      linkRow('🎧 Support request', `${origin}/r/${d.token}/support`) +
      (can('settings.manage') ? `<button class="btn sm" id="regenLink2" style="margin-top:8px">Regenerate</button> <span class="muted" style="font-size:12px">— invalidates the current links</span>` : '');
    $$('#linkModalWrap [data-copy]').forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Link copied'); });
    const rg = $('#regenLink2'); if (rg) rg.onclick = async () => {
      if (!confirm('Regenerate links? The current links will immediately stop working.')) return;
      try { await api('/intake-links/regenerate', { method: 'POST' }); toast('Links regenerated'); showLinksModal(); }
      catch (e) { toast(e.message, true); }
    };
  } catch (e) { const wrap = $('#linkModalWrap'); if (wrap) wrap.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}

// ── Products (catalog) ───────────────────────────────────────
VIEWS.products = async () => {
  const root = $('#viewRoot');
  root.innerHTML = `
    <div class="toolbar">
      <span class="muted">These populate the Product dropdown on your installation request form.</span>
      <div class="spacer"></div>
      <button class="btn primary" id="pdNew">+ Add product</button>
    </div>
    <div class="panel"><div id="pdList"><p class="empty">Loading…</p></div></div>`;
  $('#pdNew').onclick = () => productForm();
  loadProducts();
};
async function loadProducts() {
  try {
    const rows = await api('/products');
    const el = $('#pdList'); if (!el) return;
    if (!rows.length) { el.innerHTML = '<p class="empty">No products yet — add your first product.</p>'; return; }
    el.innerHTML = `<table><thead><tr><th>Product</th><th>SKU</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr>
        <td><b>${esc(p.name)}</b>${p.review_link ? ' <span class="pill">⭐ review link</span>' : ''}</td>
        <td class="mono">${esc(p.sku || '—')}</td>
        <td>${p.active ? '<span class="badge b-active">active</span>' : '<span class="badge b-inactive">inactive</span>'}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-edit="${p.id}">Edit</button> <button class="btn sm danger" data-del="${p.id}">Delete</button></td></tr>`).join('')}
    </tbody></table>`;
    $$('#pdList [data-edit]').forEach(b => b.onclick = () => productForm(rows.find(x => x.id === b.dataset.edit)));
    $$('#pdList [data-del]').forEach(b => b.onclick = () => deleteProduct(rows.find(x => x.id === b.dataset.del)));
  } catch (e) { const el = $('#pdList'); if (el) el.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function productForm(p) {
  const edit = !!p;
  openModal(`<h3>${edit ? 'Edit' : 'Add'} product</h3><form id="pdForm"><div class="formgrid">
    <label class="full">Product name<input name="name" value="${esc(edit ? p.name : '')}" required></label>
    <label>SKU (optional)<input name="sku" value="${esc((edit && p.sku) || '')}"></label>
    ${edit ? `<label>Status<select name="active"><option value="true"${p.active ? ' selected' : ''}>active</option><option value="false"${!p.active ? ' selected' : ''}>inactive</option></select></label>` : ''}
    <label class="full">Review link (optional)<input name="review_link" value="${esc((edit && p.review_link) || '')}" placeholder="Amazon/Flipkart review URL — used by Send review request"></label>
  </div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">${edit ? 'Save' : 'Add'}</button></div></form>`);
  $('#pdForm').onsubmit = async e => {
    e.preventDefault(); const b = e.target.querySelector('button.primary'); b.disabled = true;
    const body = { name: $('#pdForm [name=name]').value.trim(), sku: $('#pdForm [name=sku]').value.trim(), review_link: $('#pdForm [name=review_link]').value.trim() };
    if (edit) body.active = $('#pdForm [name=active]').value === 'true';
    try {
      if (edit) await api('/products/' + p.id, { method: 'PATCH', body: JSON.stringify(body) });
      else await api('/products', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); toast('Saved'); loadProducts();
    } catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
async function deleteProduct(p) {
  if (!p) return;
  if (!confirm(`Delete "${p.name}"?`)) return;
  try { await api('/products/' + p.id, { method: 'DELETE' }); toast('Deleted'); loadProducts(); }
  catch (e) { toast(e.message, true); }
}

// ── boot ─────────────────────────────────────────────────────
async function boot() {
  try {
    ME = await api('/auth/me');
    $('#bizName').textContent = ME.business_name || '';
    $('#userEmail').textContent = `${ME.email || ''}${ME.role ? ' · ' + (ROLE_LABELS[ME.role] || ME.role) : ''}`;
    // Hide nav items the user has no permission for.
    $$('.navlink[data-perm]').forEach(a => a.classList.toggle('hidden', !can(a.dataset.perm)));
    showApp(); go('dashboard');
  } catch (e) { showAuth(); }
}
window.closeModal = closeModal;
boot();
