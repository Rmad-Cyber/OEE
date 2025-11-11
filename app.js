/* ==================================================
   Losses Tracker - app.js (FULL ONLINE + SAFE)
   - Sidebar toggle & tabs
   - SAFE/ONLINE switch (SAFE = localStorage, ONLINE = Google Apps Script)
   - Firebase token (if available) -> GAS: whoami, create_losses, list_losses
   - Username mgmt, duration auto-calc, validations
   - My Log + All Log (filters + CSV)
   - Pareto & Trend charts (from current dataset)
   ================================================== */
(function(){
  "use strict";

  // ====== CONFIG ======
  const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzCyTnL6icp_zYFANUgG5WlyntFcUOSlMsgNILYQLt2hGzw5sxNn0zNV_qtrVIcPg/exec";

  // If Firebase SDK exists on page, we'll init with this config
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBXZzlGWEICRgxBp5RUO78E7Jp2nwvpDsg",
    authDomain: "ciiapps.firebaseapp.com",
    projectId: "ciiapps",
    storageBucket: "ciiapps.firebasestorage.app",
    messagingSenderId: "1033692640361",
    appId: "1:1033692640361:web:6e69e8ed3cd2c7ef249ef8",
    measurementId: "G-ZCG384P9G7"
  };

  const STORAGE_KEY   = "oee_local_offline_log"; // SAFE storage
  const SAFE_MODE_KEY = "losses_safe_mode";
  const DEFAULT_MODE  = "true"; // default SAFE
  const MIN_ROLE_APP  = ["operator","supervisor","admin"]; // role gate in ONLINE

  // ====== STATE ======
  let isSafeMode = (localStorage.getItem(SAFE_MODE_KEY) || DEFAULT_MODE) === "true";
  let paretoChartInstance = null;
  let trendChartInstance  = null;
  let lastOnlineRows = []; // cache of ONLINE rows (for dashboard & re-filter)

  // ====== DOM HELPERS ======
  const qs  = (id)  => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const val = (id)  => { const e = qs(id); return e && e.value ? e.value.trim() : ""; };

  function showToast(type, message){
    const el = type === "success" ? qs("toast-success") : qs("toast-error");
    if(!el) return; el.textContent = message;
    el.classList.remove("hidden","translate-x-full");
    el.classList.add("translate-x-0");
    setTimeout(()=>{ el.classList.remove("translate-x-0"); el.classList.add("translate-x-full"); setTimeout(()=>el.classList.add("hidden"),220); }, 2400);
  }

  // ====== TIME / DURATION ======
  function diffMinutes(start, finish){
    if(!start||!finish) return null;
    const [sh, sm] = start.split(":").map(Number);
    const [fh, fm] = finish.split(":").map(Number);
    if([sh,sm,fh,fm].some(isNaN)) return null;
    return fh*60+fm - (sh*60+sm);
  }
  function computeDuration(){
    const s = val("fStart"); const f = val("fFinish"); const d = diffMinutes(s,f);
    const out = qs("fDurasi"); if(!out) return;
    if(!s||!f||d===null){ out.value=""; return; }
    if(d<=0){ out.value=""; showToast("error","Waktu Selesai harus > Waktu Mulai (durasi > 0)"); }
    else out.value = String(d);
  }

  // ====== USERNAME ======
  function changeUsername(){
    const cur = localStorage.getItem("losses_username")||"";
    const nu = prompt("Nama pelapor baru?", cur);
    if(!nu) return; const cleaned = nu.trim(); if(!cleaned){ showToast("error","Nama tidak boleh kosong."); return; }
    localStorage.setItem("losses_username", cleaned);
    refreshHeaderInfo(); const pf = qs("fPelapor"); if(pf) pf.value = cleaned; showToast("success","Nama pelapor diperbarui.");
  }
  function refreshHeaderInfo(){
    const uname = localStorage.getItem("losses_username") || "(Belum set nama)";
    const email = localStorage.getItem("losses_email") || "";
    const role  = localStorage.getItem("losses_role")  || (isSafeMode?"admin":"guest");
    const n=qs("sidebarUserName"), e=qs("sidebarUserEmail"), r=qs("sidebarUserRole");
    if(n) n.textContent = uname; if(e) e.textContent = email; if(r) r.textContent = role;
    const pf = qs("fPelapor"); if(pf) pf.value = uname === "(Belum set nama)" ? "" : uname;
  }

  // ====== SIDEBAR & TABS ======
  function toggleSidebar(){ const s=qs("sidebar"), o=qs("sidebar-overlay"); if(!s||!o) return; const hidden=s.classList.contains("-translate-x-full"); if(hidden){s.classList.remove("-translate-x-full");s.classList.add("translate-x-0");o.classList.remove("hidden");} else {s.classList.add("-translate-x-full");s.classList.remove("translate-x-0");o.classList.add("hidden");} }
  function switchTab(name){
    qsa('.tab-content').forEach(el=>el.classList.add('hidden'));
    const active = qs('tab-'+name); if(active) active.classList.remove('hidden');
    // active button + title
    qsa('.sidebar-nav-button').forEach(btn=>{ btn.classList.remove('active','bg-gray-900','text-white'); btn.classList.add('text-gray-300','hover:bg-gray-700'); });
    const ab = document.querySelector(`.sidebar-nav-button[data-tab="${name}"]`);
    if(ab){ ab.classList.add('active','bg-gray-900','text-white'); ab.classList.remove('text-gray-300','hover:bg-gray-700'); const t=qs('page-title'); if(t) t.textContent = ab.textContent.trim(); }
    const sb = qs('sidebar'); if(sb && !sb.classList.contains('-translate-x-full')) toggleSidebar();
    // lazy
    if(name==='dashboard') updateChartsFromRows(getActiveDataset());
    if(name==='mylog')     renderMyLog();
    if(name==='alllog')    applyAllFilters();
  }

  // ====== MODE ======
  function setModeLabel(){ const el=qs('mode-value'); if(!el) return; el.textContent = isSafeMode? 'SAFE' : 'ONLINE'; el.className = isSafeMode? 'font-medium text-green-700' : 'font-medium text-blue-700'; }
  function toggleMode(){ isSafeMode = !isSafeMode; localStorage.setItem(SAFE_MODE_KEY, isSafeMode?"true":"false"); setModeLabel(); showToast('success', isSafeMode? 'Safe Mode aktif' : 'Online Mode aktif'); if(!isSafeMode){ ensureFirebase(); onlineWhoAmI(); } }

  // ====== STORAGE (SAFE) ======
  function getAllLocal(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch{ return []; } }
  function setAllLocal(rows){ localStorage.setItem(STORAGE_KEY, JSON.stringify(rows||[])); }

  // ====== FIREBASE / TOKEN ======
  function ensureFirebase(){
    if(!window.firebase) return null;
    try{ if(firebase.apps && firebase.apps.length===0){ firebase.initializeApp(FIREBASE_CONFIG); } }catch(err){ /* ignore if already init */ }
    return firebase;
  }
  async function getIdTokenOrNull(){
    try{ const fb = ensureFirebase(); if(!fb || !fb.auth) return null; const u = fb.auth().currentUser; if(!u) return null; return await u.getIdToken(true); }catch{ return null; }
  }

  // ====== ONLINE CALLS ======
  async function onlineWhoAmI(){
    const token = await getIdTokenOrNull();
    if(!token){ showToast('error','Tidak login Firebase. ONLINE butuh login.'); return; }
    try{
      const res = await fetch(WEBAPP_URL+`?action=whoami&token=${encodeURIComponent(token)}`);
      const data = await res.json();
      if(!data.ok){ throw new Error(data.error||'whoami gagal'); }
      const role = (data.role||'guest').toLowerCase();
      localStorage.setItem('losses_email', data.email||'');
      localStorage.setItem('losses_role', role);
      refreshHeaderInfo();
      if(MIN_ROLE_APP.indexOf(role)===-1){ showToast('error',`Akses ditolak: ${role}`); }
    }catch(err){ showToast('error','ONLINE whoami error: '+err.message); }
  }

  async function onlineCreateLoss(row){
    const token = await getIdTokenOrNull(); if(!token){ throw new Error('Tidak login Firebase.'); }
    const payload = { token, data: [row] };
    const res = await fetch(WEBAPP_URL+"?action=create_losses", { method:'POST', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(payload) });
    const data = await res.json(); if(!data.ok){ throw new Error(data.error||'create_losses gagal'); }
    return data;
  }

  async function onlineListLosses(params){
    const token = await getIdTokenOrNull(); if(!token){ throw new Error('Tidak login Firebase.'); }
    const q = new URLSearchParams({ action:'list_losses', token,
      page: String(params.page||1), pageSize: String(params.pageSize||300), q: params.q||'', since: params.since||'' });
    const res = await fetch(WEBAPP_URL+"?"+q.toString());
    const data = await res.json(); if(!data.ok){ throw new Error(data.error||'list_losses gagal'); }
    return data.items || [];
  }

  // ====== SUBMIT ======
  async function submitLoss(e){
    e.preventDefault();
    const uname = (localStorage.getItem('losses_username')||'').trim();
    if(!uname){ showToast('error','Nama Pelapor belum diset (menu samping).'); return; }
    const duration = diffMinutes(val('fStart'), val('fFinish'));
    if(duration===null || duration<=0){ showToast('error','Durasi tidak valid (>0 menit).'); return; }

    const row = {
      Tanggal: val('fTanggal'), Shift: val('fShift'), Area: val('fArea'), Mesin: val('fMesin'),
      Pelapor: uname, Issue: val('fIssue'), Kategori: val('fKategori'),
      "WAKTU START": val('fStart'), "WAKTU FINISH": val('fFinish'), "Durasi Hilang": String(duration)
    };

    if(isSafeMode){
      const rows = getAllLocal(); rows.unshift(row); setAllLocal(rows);
      showToast('success','✅ Data tersimpan (SAFE).'); resetFormKeepPelapor(uname); return;
    }
    try{ await onlineCreateLoss(row); showToast('success','✅ Data tersimpan (ONLINE).'); resetFormKeepPelapor(uname); }
    catch(err){ showToast('error','Gagal ONLINE: '+err.message); }
  }
  function resetFormKeepPelapor(uname){ const f=qs('loss-form'); if(f) f.reset(); const t=qs('fTanggal'); if(t) t.valueAsDate=new Date(); const p=qs('fPelapor'); if(p) p.value=uname; const d=qs('fDurasi'); if(d) d.value=''; }

  // ====== RENDER HELPERS ======
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
  function renderRowsToTbody(tbodyId, rows, cols, colspan){
    const tbody = qs(tbodyId); if(!tbody) return; tbody.innerHTML='';
    if(!rows || rows.length===0){ const tr=document.createElement('tr'); tr.innerHTML=`<td colspan="${colspan}" class="px-6 py-4 text-center text-gray-500">Tidak ada data.</td>`; tbody.appendChild(tr); return; }
    rows.forEach(r=>{ const tr=document.createElement('tr'); tr.innerHTML=cols.map(c=>{ const v=r[c]||''; return c==='Issue' ? `<td class="max-w-xs truncate" title="${escapeHtml(v)}">${escapeHtml(v)}</td>` : `<td>${escapeHtml(v)}</td>`; }).join(''); tbody.appendChild(tr); });
  }

  // ====== DATASET PICKER ======
  function getActiveDataset(){ return isSafeMode ? getAllLocal() : lastOnlineRows; }

  // ====== MY LOG ======
  async function renderMyLog(){
    const me = (localStorage.getItem('losses_username')||'').trim();
    let rows = [];
    if(isSafeMode){
      rows = getAllLocal().filter(r => (r.Pelapor||'').trim()===me);
    } else {
      // ONLINE: ambil terbaru (tanpa filter), lalu filter di sisi klien untuk nama
      try { lastOnlineRows = await onlineListLosses({ page:1, pageSize:500 }); }
      catch(err){ showToast('error','Load ONLINE gagal: '+err.message); lastOnlineRows=[]; }
      rows = lastOnlineRows.filter(r => (r.Pelapor||'').trim()===me);
    }
    const sinceISO = val('mySince');
    if(sinceISO){ const t0=new Date(sinceISO); rows = rows.filter(r=>{ const t=new Date(r.Tanggal); return !isNaN(t) && t>=t0; }); }
    renderRowsToTbody('mylog-body', rows, ["Tanggal","Shift","Area","Mesin","Kategori","Issue","WAKTU START","WAKTU FINISH","Durasi Hilang"], 9);
  }

  // ====== ALL LOG ======
  async function applyAllFilters(){
    let rows = [];
    if(isSafeMode){ rows = getAllLocal(); }
    else {
      // ONLINE: use since + q minimal ke server untuk kurangi data
      const since = val('fltSince'); const q = buildAllLogQuery();
      try { lastOnlineRows = await onlineListLosses({ page:1, pageSize:800, since, q }); }
      catch(err){ showToast('error','Load ONLINE gagal: '+err.message); lastOnlineRows=[]; }
      rows = lastOnlineRows.slice();
    }

    // client-side refine (untuk konsistensi UI)
    const since = val('fltSince'); const until=val('fltUntil'); const shift=val('fltShift');
    const area = val('fltArea').toLowerCase(); const mesin=val('fltMesin').toLowerCase();
    const kategori=val('fltKategori'); const pelapor=val('fltPelapor').toLowerCase();

    if(since){ const t0=new Date(since); rows = rows.filter(r=>{ const t=new Date(r.Tanggal); return !isNaN(t) && t>=t0; }); }
    if(until){ const t1=new Date(until); t1.setHours(23,59,59,999); rows = rows.filter(r=>{ const t=new Date(r.Tanggal); return !isNaN(t) && t<=t1; }); }
    if(shift)    rows = rows.filter(r => (r.Shift||"")===shift);
    if(kategori) rows = rows.filter(r => (r.Kategori||"")===kategori);
    if(area)     rows = rows.filter(r => (r.Area ||"").toLowerCase().includes(area));
    if(mesin)    rows = rows.filter(r => (r.Mesin||"").toLowerCase().includes(mesin));
    if(pelapor)  rows = rows.filter(r => (r.Pelapor||"").toLowerCase().includes(pelapor));

    renderRowsToTbody('alllog-body', rows, ["Tanggal","Shift","Area","Mesin","Kategori","Issue","WAKTU START","WAKTU FINISH","Durasi Hilang","Pelapor"], 10);
  }
  function buildAllLogQuery(){
    // simple q builder (matches issue/mesin/area/pelapor text)
    const parts = [];
    const f = (s)=>s&&s.trim();
    const add = (label, v)=>{ if(!v) return; parts.push(`${label}:${v}`); };
    add('area', f(val('fltArea')));
    add('mesin', f(val('fltMesin')));
    add('pelapor', f(val('fltPelapor')));
    const raw = parts.join(' ');
    return raw; // GAS can ignore if unsupported
  }

  // ====== CSV ======
  function csvEscape(v){ const s=String(v??""); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
  function rowsToCsv(rows, headers){ const lines=[headers.join(",")]; rows.forEach(r=>lines.push(headers.map(h=>csvEscape(r[h])).join(","))); return lines.join("\n"); }
  function download(filename, content, mime="text/csv"){ const a=document.createElement('a'); const blob=new Blob([content],{type:mime}); const url=URL.createObjectURL(blob); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }
  function exportMyLogCsv(){
    const me=(localStorage.getItem('losses_username')||'').trim();
    let rows=getActiveDataset().filter(r=>(r.Pelapor||'').trim()===me);
    const sinceISO = val('mySince'); if(sinceISO){ const t0=new Date(sinceISO); rows=rows.filter(r=>{ const t=new Date(r.Tanggal); return !isNaN(t)&&t>=t0; }); }
    const headers=["Tanggal","Shift","Area","Mesin","Kategori","Issue","WAKTU START","WAKTU FINISH","Durasi Hilang"]; download('my_log.csv', rowsToCsv(rows, headers));
  }
  function exportAllLogCsv(){
    const tbody=qs('alllog-body'); if(!tbody) return; const rows=[]; Array.from(tbody.querySelectorAll('tr')).forEach(tr=>{ const tds=Array.from(tr.querySelectorAll('td')); if(tds.length===10){ rows.push({
      "Tanggal":tds[0].textContent, "Shift":tds[1].textContent, "Area":tds[2].textContent, "Mesin":tds[3].textContent,
      "Kategori":tds[4].textContent, "Issue":tds[5].textContent, "WAKTU START":tds[6].textContent, "WAKTU FINISH":tds[7].textContent,
      "Durasi Hilang":tds[8].textContent, "Pelapor":tds[9].textContent }); } });
    const headers=["Tanggal","Shift","Area","Mesin","Kategori","Issue","WAKTU START","WAKTU FINISH","Durasi Hilang","Pelapor"]; download('all_log.csv', rowsToCsv(rows, headers));
  }

  // ====== CHARTS ======
  function updateChartsFromRows(rows){ updateParetoChart(rows); updateTrendChart(rows); }
  function updateParetoChart(rows){ const cv=qs('pareto-chart'); if(!cv||typeof Chart==='undefined') return; const summary=rows.reduce((acc,r)=>{ const c=r["Kategori"]||'Lainnya'; const d=Number(r["Durasi Hilang"])||0; acc[c]=(acc[c]||0)+d; return acc; },{}); const sorted=Object.entries(summary).sort(([,a],[,b])=>b-a); const labels=sorted.map(([k])=>k); const data=sorted.map(([,v])=>v); if(window.__pareto__) window.__pareto__.destroy(); window.__pareto__=new Chart(cv.getContext('2d'),{ type:'bar', data:{labels, datasets:[{label:'Durasi Loss (Menit)', data, backgroundColor:'rgba(239,68,68,0.6)', borderColor:'rgba(239,68,68,1)', borderWidth:1}]}, options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{beginAtZero:true,title:{display:true,text:'Total Menit Loss'}}, x:{title:{display:true,text:'Kategori Kerugian'}} }, plugins:{legend:{display:false}} } }); }
  function updateTrendChart(rows){ const cv=qs('trend-chart'); if(!cv||typeof Chart==='undefined') return; const byDate=rows.reduce((acc,r)=>{ const t=r["Tanggal"]||''; const d=Number(r["Durasi Hilang"])||0; acc[t]=(acc[t]||0)+d; return acc; },{}); const labels=Object.keys(byDate).sort(); const data=labels.map(k=>byDate[k]); if(window.__trend__) window.__trend__.destroy(); window.__trend__=new Chart(cv.getContext('2d'),{ type:'line', data:{labels, datasets:[{label:'Total Loss (Menit)', data, borderColor:'rgb(59,130,246)', fill:false, tension:0.1}]}, options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{beginAtZero:true,title:{display:true,text:'Total Menit'}} } } }); }

  // ====== INIT ======
  document.addEventListener('DOMContentLoaded',()=>{
    setModeLabel(); refreshHeaderInfo(); const t=qs('fTanggal'); if(t) t.valueAsDate=new Date();
    const ob=qs('open-sidebar-button'), ov=qs('sidebar-overlay'); if(ob) ob.addEventListener('click',toggleSidebar); if(ov) ov.addEventListener('click',toggleSidebar);
    qsa('.sidebar-nav-button').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.getAttribute('data-tab')))); switchTab('input');
    const form=qs('loss-form'); if(form) form.addEventListener('submit',submitLoss); const s=qs('fStart'), f=qs('fFinish'); if(s) s.addEventListener('input',computeDuration); if(f) f.addEventListener('input',computeDuration);
    const tb=qs('toggleModeBtn'); if(tb) tb.addEventListener('click',toggleMode); const cu=qs('btnChangeUser'); if(cu) cu.addEventListener('click',changeUsername);
    const mA=qs('applyMyLogFilter'); if(mA) mA.addEventListener('click',renderMyLog); const mR=qs('refreshMyLog'); if(mR) mR.addEventListener('click',()=>{ qs('mySince')&& (qs('mySince').value=''); renderMyLog(); }); const mC=qs('downloadMyLogCsv'); if(mC) mC.addEventListener('click',exportMyLogCsv);
    const aA=qs('btnApplyAllFilters'); if(aA) aA.addEventListener('click',applyAllFilters); const aR=qs('btnResetAllFilters'); if(aR) aR.addEventListener('click',()=>{ ['fltSince','fltUntil','fltShift','fltArea','fltMesin','fltKategori','fltPelapor'].forEach(id=>{const el=qs(id); if(el) el.value='';}); applyAllFilters(); }); const aC=qs('downloadAllLogCsv'); if(aC) aC.addEventListener('click',exportAllLogCsv);

    // If ONLINE at load, ensure Firebase & whoami
    if(!isSafeMode){ ensureFirebase(); onlineWhoAmI(); }

    // Initial renders
    renderMyLog(); applyAllFilters();
  });
})();
