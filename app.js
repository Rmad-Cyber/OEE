// app.js - SAFE/ONLINE with Firebase + Apps Script connectivity
;(function () {
  "use strict";

  const STORAGE_KEY = "oee_local_offline_log";
  const MODE_KEY = "oee_mode"; // 'SAFE' or 'ONLINE'
  const DEFAULT_MODE = "SAFE";

  const firebaseConfig = {
    apiKey: "AIzaSyBXZzlGWEICRgxBp5RUO78E7Jp2nwvpDsg",
    authDomain: "ciiapps.firebaseapp.com",
    projectId: "ciiapps",
    storageBucket: "ciiapps.firebasestorage.app",
    messagingSenderId: "1033692640361",
    appId: "1:1033692640361:web:6e69e8ed3cd2c7ef249ef8",
    measurementId: "G-ZCG384P9G7"
  };

  const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzCyTnL6icp_zYFANUgG5WlyntFcUOSlMsgNILYQLt2hGzw5sxNn0zNV_qtrVIcPg/exec";
  const MIN_ROLE_APP = ["operator","supervisor","admin"];

  const qs  = (id)  => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const val = (id)  => { const e = qs(id); return e && e.value ? e.value.trim() : ""; };

  let auth = null;
  let currentRole = "guest";
  let currentMode = localStorage.getItem(MODE_KEY) || DEFAULT_MODE;

  function showToast(type, msg){
    const el = type === 'success' ? qs('toast-success') : qs('toast-error');
    if(!el) return;
    el.textContent = msg;
    el.classList.remove('hidden','translate-x-full');
    el.classList.add('translate-x-0');
    setTimeout(()=>{
      el.classList.remove('translate-x-0');
      el.classList.add('translate-x-full');
      setTimeout(()=> el.classList.add('hidden'), 180);
    }, 2200);
  }

  function toggleSidebar(){
    const s = qs('sidebar'), o = qs('sidebar-overlay');
    if(!s || !o) return;
    const hidden = s.classList.contains('-translate-x-full');
    if(hidden){
      s.classList.remove('-translate-x-full');
      s.classList.add('translate-x-0');
      o.classList.remove('hidden');
    } else {
      s.classList.add('-translate-x-full');
      s.classList.remove('translate-x-0');
      o.classList.add('hidden');
    }
  }

  function switchTab(name){
    qsa('.tab-content').forEach((el)=> el.classList.add('hidden'));
    const active = qs('tab-' + name);
    if(active) active.classList.remove('hidden');

    qsa('.sidebar-nav-button').forEach((btn)=>{
      btn.classList.remove('active','bg-gray-900','text-white');
      btn.classList.add('text-gray-300','hover:bg-gray-700');
    });
    const ab = document.querySelector('.sidebar-nav-button[data-tab="' + name + '"]');
    if(ab){
      ab.classList.add('active','bg-gray-900','text-white');
      ab.classList.remove('text-gray-300','hover:bg-gray-700');
      const t = qs('page-title');
      if(t) t.textContent = ab.textContent.trim();
    }
    const sb = qs('sidebar');
    if(sb && !sb.classList.contains('-translate-x-full')) toggleSidebar();

    if(name === 'dashboard') updateChartsFromRows(getAllLocal());
    if(name === 'mylog') renderMyLog();
    if(name === 'alllog') applyAllFilters();
  }

  function changeUsername(){
    const cur = localStorage.getItem('losses_username') || '';
    const nu = window.prompt('Nama pelapor baru?', cur);
    if(!nu) return;
    const cleaned = nu.trim();
    if(!cleaned){ showToast('error','Nama tidak boleh kosong.'); return; }
    localStorage.setItem('losses_username', cleaned);
    refreshHeaderInfo();
    const pf = qs('fPelapor');
    if(pf) pf.value = cleaned;
    showToast('success','Nama pelapor diperbarui.');
  }

  function refreshHeaderInfo(){
    const uname = localStorage.getItem('losses_username') || '(Belum set nama)';
    const nameEl = qs('sidebarUserName');
    if(nameEl) nameEl.textContent = uname;
    const pf = qs('fPelapor');
    if(pf) pf.value = (uname === '(Belum set nama)') ? '' : uname;

    const modeEl = qs('mode-value');
    if(modeEl){
      modeEl.textContent = currentMode;
      modeEl.classList.toggle('text-green-700', currentMode === 'SAFE');
      modeEl.classList.toggle('text-blue-700', currentMode === 'ONLINE');
    }
  }

  function diffMinutes(s,f){
    if(!s || !f) return null;
    const a = s.split(':').map(Number);
    const b = f.split(':').map(Number);
    if(a.length < 2 || b.length < 2) return null;
    const sh = a[0], sm = a[1], fh = b[0], fm = b[1];
    if([sh,sm,fh,fm].some(isNaN)) return null;
    return fh*60 + fm - (sh*60 + sm);
  }
  function computeDuration(){
    const s = val('fStart');
    const f = val('fFinish');
    const d = diffMinutes(s,f);
    const out = qs('fDurasi');
    if(!out) return;
    if(!s || !f || d === null){ out.value = ''; return; }
    if(d <= 0){ out.value = ''; showToast('error','Waktu Selesai harus > Waktu Mulai (durasi > 0)'); }
    else { out.value = String(d); }
  }

  function getAllLocal(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  function setAllLocal(rows){ localStorage.setItem(STORAGE_KEY, JSON.stringify(rows || [])); }

  async function ensureFirebase(){
    if(!auth){
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      try{
        if(!auth.currentUser) await auth.signInAnonymously();
      }catch(e){
        console.warn("Anon auth failed:", e);
      }
    }
    return auth;
  }

  async function whoAmI(){
    await ensureFirebase();
    const u = auth.currentUser;
    if(!u) return { ok:false, error:"No user" };
    const token = await u.getIdToken(true);
    const res = await fetch(WEBAPP_URL + "?action=whoami&token=" + encodeURIComponent(token));
    const data = await res.json();
    return data;
  }

  async function onlineCreateLoss(payload){
    await ensureFirebase();
    const u = auth.currentUser;
    if(!u) throw new Error("Sesi berakhir.");
    const token = await u.getIdToken(true);
    const res = await fetch(WEBAPP_URL + "?action=create_losses", {
      method:"POST",
      headers:{"Content-Type":"text/plain"},
      body: JSON.stringify({ token, data: payload })
    });
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || "Gagal create");
    return data;
  }

  async function submitLoss(e){
    e.preventDefault();
    const uname = (localStorage.getItem('losses_username') || '').trim();
    if(!uname){ showToast('error','Nama Pelapor belum diset.'); return; }
    const d = diffMinutes(val('fStart'), val('fFinish'));
    if(d === null || d <= 0){ showToast('error','Durasi tidak valid (>0 menit).'); return; }

    const payloadRow = {
      "Tanggal":       val('fTanggal'),
      "Shift":         val('fShift'),
      "Factory":       "",
      "Line":          "",
      "Mesin":         val('fMesin'),
      "Area":          val('fArea'),
      "Pelapor":       uname,
      "Issue":         val('fIssue'),
      "Kategori":      val('fKategori'),
      "WAKTU START":   val('fStart'),
      "WAKTU FINISH":  val('fFinish'),
      "Durasi Hilang": String(d)
    };

    if(currentMode === 'ONLINE'){
      try{
        const who = await whoAmI();
        if(!who.ok || !who.role){ throw new Error(who.error || "Gagal whoami"); }
        currentRole = (who.role||"guest").toLowerCase();
        if(!["operator","supervisor","admin"].includes(currentRole)){
          showToast('error', 'Akses ditolak ('+ currentRole +') — fallback SAFE');
          currentMode = 'SAFE';
          localStorage.setItem(MODE_KEY, currentMode);
          refreshHeaderInfo();
        }else{
          await onlineCreateLoss([payloadRow]);
          showToast('success','✅ Data tersimpan (ONLINE).');
        }
      }catch(err){
        console.error(err);
        showToast('error','ONLINE gagal: ' + err.message);
        const rows = getAllLocal(); rows.unshift(payloadRow); setAllLocal(rows);
      }
    } else {
      const rows = getAllLocal();
      rows.unshift(payloadRow);
      setAllLocal(rows);
      showToast('success','✅ Data tersimpan (SAFE).');
    }

    const form = qs('loss-form'); if(form) form.reset();
    const t = qs('fTanggal'); if(t) t.valueAsDate = new Date();
    const p = qs('fPelapor'); if(p) p.value = uname;
    const du = qs('fDurasi'); if(du) du.value = '';

    renderMyLog();
    applyAllFilters();
    updateChartsFromRows(getAllLocal());
  }

  function escapeHtml(s){
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#039;');
  }
  function renderRowsToTbody(tbodyId, rows, cols, colspan){
    const tbody = qs(tbodyId);
    if(!tbody) return;
    tbody.innerHTML = '';
    if(!rows || rows.length === 0){
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="' + colspan + '" class="px-6 py-4 text-center text-gray-500">Tidak ada data.</td>';
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = cols.map((c)=>{
        const v = r[c] || '';
        if(c === 'Issue'){
          return '<td class="max-w-xs truncate" title="' + escapeHtml(v) + '">' + escapeHtml(v) + '</td>';
        }
        return '<td>' + escapeHtml(v) + '</td>';
      }).join('');
      tbody.appendChild(tr);
    });
  }

  function renderMyLog(){
    const me = (localStorage.getItem('losses_username') || '').trim();
    const sinceISO = val('mySince');
    let rows = getAllLocal().filter((r)=> (r.Pelapor || '').trim() === me);
    if(sinceISO){
      const t0 = new Date(sinceISO);
      rows = rows.filter((r)=>{ const t = new Date(r.Tanggal); return !isNaN(t) && t >= t0; });
    }
    renderRowsToTbody('mylog-body', rows, [
      'Tanggal','Shift','Area','Mesin','Kategori','Issue','WAKTU START','WAKTU FINISH','Durasi Hilang'
    ], 9);
  }

  function applyAllFilters(){
    let rows = getAllLocal();
    const since    = val('fltSince');
    const until    = val('fltUntil');
    const shift    = val('fltShift');
    const area     = val('fltArea').toLowerCase();
    const mesin    = val('fltMesin').toLowerCase();
    const kategori = val('fltKategori');
    const pelapor  = val('fltPelapor').toLowerCase();

    if(since){ const t0 = new Date(since); rows = rows.filter((r)=>{ const t = new Date(r.Tanggal); return !isNaN(t) && t >= t0; }); }
    if(until){ const t1 = new Date(until); t1.setHours(23,59,59,999); rows = rows.filter((r)=>{ const t = new Date(r.Tanggal); return !isNaN(t) && t <= t1; }); }
    if(shift)    rows = rows.filter((r)=> (r.Shift    || '') === shift);
    if(kategori) rows = rows.filter((r)=> (r.Kategori || '') === kategori);
    if(area)     rows = rows.filter((r)=> (r.Area     || '').toLowerCase().includes(area));
    if(mesin)    rows = rows.filter((r)=> (r.Mesin    || '').toLowerCase().includes(mesin));
    if(pelapor)  rows = rows.filter((r)=> (r.Pelapor  || '').toLowerCase().includes(pelapor));

    renderRowsToTbody('alllog-body', rows, [
      'Tanggal','Shift','Area','Mesin','Kategori','Issue','WAKTU START','WAKTU FINISH','Durasi Hilang','Pelapor'
    ], 10);
  }

  function csvEscape(v){
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
  }
  function rowsToCsv(rows, headers){
    const lines = [headers.join(',')];
    rows.forEach((r)=> lines.push(headers.map((h)=> csvEscape(r[h])).join(',')) );
    return lines.join('\n');
  }
  function download(filename, content, mime){
    const a = document.createElement('a');
    const blob = new Blob([content], {type: (mime || 'text/csv')});
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename; document.body.appendChild(a);
    a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function exportMyLogCsv(){
    const me = (localStorage.getItem('losses_username') || '').trim();
    const sinceISO = val('mySince');
    let rows = getAllLocal().filter((r)=> (r.Pelapor || '').trim() === me);
    if(sinceISO){
      const t0 = new Date(sinceISO);
      rows = rows.filter((r)=>{ const t = new Date(r.Tanggal); return !isNaN(t) && t >= t0; });
    }
    const headers = ['Tanggal','Shift','Area','Mesin','Kategori','Issue','WAKTU START','WAKTU FINISH','Durasi Hilang'];
    download('my_log.csv', rowsToCsv(rows, headers), 'text/csv');
  }
  function exportAllLogCsv(){
    const tbody = qs('alllog-body'); if(!tbody) return;
    const rows = [];
    Array.from(tbody.querySelectorAll('tr')).forEach((tr)=>{
      const tds = Array.from(tr.querySelectorAll('td'));
      if(tds.length === 10){
        rows.push({
          'Tanggal': tds[0].textContent,
          'Shift': tds[1].textContent,
          'Area': tds[2].textContent,
          'Mesin': tds[3].textContent,
          'Kategori': tds[4].textContent,
          'Issue': tds[5].textContent,
          'WAKTU START': tds[6].textContent,
          'WAKTU FINISH': tds[7].textContent,
          'Durasi Hilang': tds[8].textContent,
          'Pelapor': tds[9].textContent
        });
      }
    });
    const headers = ['Tanggal','Shift','Area','Mesin','Kategori','Issue','WAKTU START','WAKTU FINISH','Durasi Hilang','Pelapor'];
    download('all_log.csv', rowsToCsv(rows, headers), 'text/csv');
  }

  function updateChartsFromRows(rows){ updatePareto(rows); updateTrend(rows); }
  function updatePareto(rows){
    const cv = qs('pareto-chart');
    if(!cv || typeof Chart === 'undefined') return;
    const sum = rows.reduce((a,r)=>{
      const c = r.Kategori || 'Lainnya';
      const d = Number(r['Durasi Hilang']) || 0;
      a[c] = (a[c] || 0) + d; return a;
    }, {});
    const sorted = Object.entries(sum).sort((x,y)=> y[1]-x[1]);
    const labels = sorted.map(it => it[0]);
    const data   = sorted.map(it => it[1]);
    if(window.__pareto__) window.__pareto__.destroy();
    window.__pareto__ = new Chart(cv.getContext('2d'), {
      type:'bar',
      data:{ labels, datasets:[{ label:'Durasi Loss (Menit)', data, backgroundColor:'rgba(239,68,68,0.6)', borderColor:'rgba(239,68,68,1)', borderWidth:1 }]},
      options:{ responsive:true, maintainAspectRatio:false,
        scales:{ y:{beginAtZero:true, title:{display:true, text:'Total Menit Loss'}}, x:{title:{display:true, text:'Kategori Kerugian'}} },
        plugins:{ legend:{display:false} } }
    });
  }
  function updateTrend(rows){
    const cv = qs('trend-chart');
    if(!cv || typeof Chart === 'undefined') return;
    const by = rows.reduce((a,r)=>{
      const t = r.Tanggal || '';
      const d = Number(r['Durasi Hilang']) || 0;
      a[t] = (a[t] || 0) + d; return a;
    }, {});
    const labels = Object.keys(by).sort();
    const data   = labels.map(k => by[k]);
    if(window.__trend__) window.__trend__.destroy();
    window.__trend__ = new Chart(cv.getContext('2d'), {
      type:'line',
      data:{ labels, datasets:[{ label:'Total Loss (Menit)', data, borderColor:'rgb(59,130,246)', fill:false, tension:0.1 }]},
      options:{ responsive:true, maintainAspectRatio:false,
        scales:{ y:{beginAtZero:true, title:{display:true, text:'Total Menit'}} } }
    });
  }

  function setMode(mode){
    currentMode = mode;
    localStorage.setItem(MODE_KEY, mode);
    refreshHeaderInfo();
  }

  async function handleToggleMode(){
    const next = currentMode === 'SAFE' ? 'ONLINE' : 'SAFE';
    if(next === 'ONLINE'){
      try{
        const who = await whoAmI();
        if(!who.ok || !who.role) throw new Error(who.error || 'whoami gagal');
        currentRole = (who.role||'guest').toLowerCase();
        if(!MIN_ROLE_APP.includes(currentRole)){
          showToast('error','Akses ONLINE ditolak (' + currentRole + ')');
          return;
        }
        localStorage.setItem('losses_email', who.email || '');
        localStorage.setItem('losses_role', currentRole);
        setMode('ONLINE');
        showToast('success','Mode ONLINE aktif.');
      }catch(e){
        showToast('error','Gagal ONLINE: ' + e.message);
        return;
      }
    }else{
      setMode('SAFE');
      showToast('success','Mode SAFE aktif.');
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    const t = qs('fTanggal'); if(t) t.valueAsDate = new Date();
    refreshHeaderInfo();

    const ob = qs('open-sidebar-button');
    const ov = qs('sidebar-overlay');
    if(ob) ob.addEventListener('click', toggleSidebar);
    if(ov) ov.addEventListener('click', toggleSidebar);

    qsa('.sidebar-nav-button').forEach(btn=>{
      btn.addEventListener('click', ()=> switchTab(btn.getAttribute('data-tab')));
    });
    switchTab('input');

    const toggle = qs('toggleModeBtn');
    if(toggle) toggle.addEventListener('click', handleToggleMode);

    const form = qs('loss-form'); if(form) form.addEventListener('submit', submitLoss);
    const s = qs('fStart'), f = qs('fFinish');
    if(s) s.addEventListener('input', computeDuration);
    if(f) f.addEventListener('input', computeDuration);

    const cu = qs('btnChangeUser'); if(cu) cu.addEventListener('click', changeUsername);

    const myA = qs('applyMyLogFilter'); if(myA) myA.addEventListener('click', renderMyLog);
    const myR = qs('refreshMyLog'); if(myR) myR.addEventListener('click', ()=>{ const d = qs('mySince'); if(d) d.value = ''; renderMyLog(); });
    const myC = qs('downloadMyLogCsv'); if(myC) myC.addEventListener('click', exportMyLogCsv);

    const aA = qs('btnApplyAllFilters'); if(aA) aA.addEventListener('click', applyAllFilters);
    const aR = qs('btnResetAllFilters'); if(aR) aR.addEventListener('click', ()=>{
      ['fltSince','fltUntil','fltShift','fltArea','fltMesin','fltKategori','fltPelapor']
        .forEach(id => { const el = qs(id); if(el) el.value = ''; });
      applyAllFilters();
    });
    const aC = qs('downloadAllLogCsv'); if(aC) aC.addEventListener('click', exportAllLogCsv);

    renderMyLog();
    applyAllFilters();
    updateChartsFromRows(getAllLocal());
  });
})();
