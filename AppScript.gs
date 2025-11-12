/**** =========================
 *  CONFIG
 * ========================= ***/
const FIREBASE_API_KEY = 'AIzaSyBXZzlGWEICRgxBp5RUO78E7Jp2nwvpDsg'; 
const SHEET_LOSSES = 'Losses';
const SHEET_USERS  = 'Users';   // header: email | role
const ENFORCE_WHITELIST = true;  // <— set true untuk blok user non-whitelist


// Header mapping (samakan dengan Sheet)
const H = {
  id:           'ID',
  date:         'Tanggal',
  shift:        'Shift',
  factory:      'Factory',
  line:         'Line',
  machine:      'Mesin',
  issue:        'Issue',
  category:     'Kategori',
  start:        'WAKTU START',
  finish:       'WAKTU FINISH',
  duration:     'Durasi Hilang',
  reporter:     'Pelapor',
  lastUpdated:  'lastUpdated',
  version:      'version',
};

// Role minimum per aksi
const ACTION_ROLES = {
  'list_losses':   'operator',
  'create_losses': 'operator',
  'update_losses': 'supervisor',
  'delete_losses': 'admin',
};
const ROLE_ORDER = ['guest', 'operator', 'supervisor', 'admin'];

/**** =========================
 *  HTTP ENTRYPOINTS
 * ========================= ***/
function doGet(e)  { return handle_(e, 'GET'); }
function doPost(e) { return handle_(e, 'POST'); }
function doOptions(e) {
  // untuk preflight bila ada, tidak perlu header khusus
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

/**** =========================
 *  CORE HANDLER
 * ========================= ***/
function handle_(e, method) {
  try {
    const token = getToken_(e);
    if (!token) return json_({ ok: false, error: 'NO_TOKEN' });

    const email = verifyFirebaseIdToken_(token);
    const role  = getUserRole_(email) || 'guest';

    const params = e.parameter || {};
    const action = (params.action || '').toLowerCase();

    const minRole = ACTION_ROLES[action];
    if (minRole && !roleGte_(role, minRole)) {
      return json_({ ok: false, error: 'ROLE_FORBIDDEN', role, needed: minRole, action });
    }

    if (method === 'GET') {
      if (action === 'whoami')      if (action === 'whoami') return json_({ ok:true, email, role: role || 'guest', allowed: !!role });
      if (action === 'list_losses') return listLosses_(params);
      return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    }

    const isWhitelisted = !!role; // role null => tidak terdaftar
    if (ENFORCE_WHITELIST && !isWhitelisted && action !== 'whoami') {
    return json_({ ok:false, error:'NOT_WHITELISTED', email });
}

    const body = parseBody_(e);
    if (action === 'create_losses') return createLosses_(body.data || body, email);
    if (action === 'update_losses') return updateLosses_(body.data || body, email);
    if (action === 'delete_losses') return deleteLosses_(body.data || body, email);

    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**** =========================
 *  TOKEN HANDLING (ANTI-CORS)
 * ========================= ***/
function getToken_(e) {
  // 1) query ?token=...
  if (e && e.parameter && e.parameter.token) return e.parameter.token;
  // 2) body JSON { token: "..." } atau form-encoded token=...
  if (e && e.postData && e.postData.contents) {
    const s = e.postData.contents;
    try {
      const obj = JSON.parse(s);
      if (obj && obj.token) return obj.token;
    } catch (_) {
      const kv = s.split('&').map(x => x.split('='));
      const hit = kv.find(p => decodeURIComponent(p[0]) === 'token');
      if (hit) return decodeURIComponent(hit[1] || '');
    }
  }
  // 3) fallback Authorization (kalau suatu saat dipakai server lain)
  const h = e && e.headers ? e.headers : {};
  const m = (h.Authorization || h.authorization || '').match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/**** =========================
 *  AUTH (Firebase verify)
 * ========================= ***/
function verifyFirebaseIdToken_(idToken) {
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(FIREBASE_API_KEY);
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ idToken })
  });
  const code = res.getResponseCode();
  const json = safeJSON_(res.getContentText());
  if (code !== 200) throw new Error('INVALID_TOKEN: ' + (json?.error?.message || code));
  const email = json?.users?.[0]?.email;
  if (!email) throw new Error('NO_EMAIL_IN_TOKEN');
  return email;
}

function getUserRole_(email) {
  const sh = getSheet_(SHEET_USERS);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return null;
  const headers = values.shift();
  const idxEmail = headers.indexOf('email');
  const idxRole  = headers.indexOf('role');
  const row = values.find(r => String(r[idxEmail]).toLowerCase() === String(email).toLowerCase());
  return row ? String(row[idxRole]).toLowerCase() : null;
}

function roleGte_(have, need) { return ROLE_ORDER.indexOf(have) >= ROLE_ORDER.indexOf(need); }

/**** =========================
 *  CRUD: LOSSES
 * ========================= ***/
function listLosses_(params) {
  const page     = Math.max(1, parseInt(params.page || '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(params.pageSize || '100', 10)));
  const q        = (params.q || '').toLowerCase();
  const sinceStr = params.since || '';  // "YYYY-MM-DD" atau ISO
  const since    = sinceStr ? new Date(sinceStr) : null;

  const sh = getSheet_(SHEET_LOSSES);
  const data = readObjects_(sh);

  let arr = data;

  // filter since terhadap lastUpdated bila ada
  if (since && hasHeader_(sh, H.lastUpdated)) {
    arr = arr.filter(o => {
      if (!o[H.lastUpdated]) return false;
      const t = new Date(o[H.lastUpdated]);
      return t > since;
    });
  }

  // keyword di semua kolom text
  if (q) {
    arr = arr.filter(o => Object.keys(o).some(k => String(o[k]).toLowerCase().includes(q)));
  }

  const total = arr.length;
  const start = (page - 1) * pageSize;
  const end   = Math.min(total, start + pageSize);
  const items = start < total ? arr.slice(start, end) : [];

  return json_({ ok: true, page, pageSize, total, items });
}

function createLosses_(body, email) {
  const items = Array.isArray(body) ? body : [body];
  const sh = getSheet_(SHEET_LOSSES);
  const headers = getHeaders_(sh);
  const now = nowIso_();

  const rows = items.map(it => {
    const o = sanitizeLossObj_(it);
    if (!o[H.id])       o[H.id] = Utilities.getUuid();
    if (!o[H.reporter]) o[H.reporter] = email;
    o[H.lastUpdated] = now;
    o[H.version]     = (Number(o[H.version])|0) + 1;
    return headers.map(h => normalizeCell_(o[h]));
  });

  appendRows_(sh, rows, headers.length);
  return json_({ ok: true, inserted: rows.length });
}

function updateLosses_(body, email) {
  const items = Array.isArray(body) ? body : [body];
  const sh = getSheet_(SHEET_LOSSES);
  const values = sh.getDataRange().getValues();
  if (!values.length) return json_({ ok:false, error:'EMPTY_SHEET' });
  const headers = values.shift();

  const idxId = headers.indexOf(H.id);
  const idxLastUpdated = headers.indexOf(H.lastUpdated);
  const idxVersion = headers.indexOf(H.version);
  if (idxId < 0) return json_({ ok: false, error: 'NO_ID_COLUMN' });

  const map = new Map(values.map((r, i) => [String(r[idxId]), { row: i + 2, data: r }]));
  let updated = 0;
  const now = nowIso_();

  items.forEach(it => {
    const id = String(it[H.id] || '');
    if (!id) return;
    const rec = map.get(id);
    if (!rec) return;

    headers.forEach((h, i) => {
      if (h === H.id) return;
      if (h === H.lastUpdated && idxLastUpdated >= 0) rec.data[i] = now;
      else if (h === H.version && idxVersion >= 0)   rec.data[i] = (Number(rec.data[i])|0) + 1;
      else if (it[h] !== undefined)                  rec.data[i] = it[h];
    });
    sh.getRange(rec.row, 1, 1, headers.length).setValues([rec.data]);
    updated++;
  });

  return json_({ ok: true, updated });
}

function deleteLosses_(body) {
  const ids = Array.isArray(body) ? body : [body];
  const sh = getSheet_(SHEET_LOSSES);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const idxId = headers.indexOf(H.id);
  if (idxId < 0) return json_({ ok:false, error:'NO_ID_COLUMN' });

  const rows = [];
  values.forEach((r, i) => { if (ids.includes(String(r[idxId]))) rows.push(i + 2); });
  rows.sort((a,b)=>b-a).forEach(r => sh.deleteRow(r));
  return json_({ ok:true, deleted: rows.length });
}

/**** =========================
 *  SHEET HELPERS
 * ========================= ***/
function getSheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('SHEET_NOT_FOUND: ' + name);
  return sh;
}
function getHeaders_(sh) {
  return sh.getRange(1,1,1, sh.getLastColumn()).getValues()[0];
}
function hasHeader_(sh, headerName) {
  return getHeaders_(sh).indexOf(headerName) >= 0;
}
function readObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values.shift();
  return values.map(r => {
    const o = {};
    headers.forEach((h,i) => o[h] = r[i]);
    return o;
  });
}
function appendRows_(sh, rows, width) {
  if (!rows.length) return;
  const startRow = sh.getLastRow() + 1;
  sh.insertRowsAfter(sh.getLastRow() || 1, rows.length);
  sh.getRange(startRow, 1, rows.length, width).setValues(rows);
}
function sanitizeLossObj_(o) {
  const out = {};
  Object.values(H).forEach(h => { if (o[h] !== undefined) out[h] = o[h]; });
  return out;
}
function normalizeCell_(v) { return v === undefined ? '' : v; }
function nowIso_() { return new Date().toISOString(); }
function parseBody_(e) {
  if (!e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); } catch(_) { return {}; }
}
function safeJSON_(s) { try { return JSON.parse(s); } catch(_) { return null; } }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
