// app.js - SAFE/ONLINE with Firebase + Apps Script connectivity
;(function () {
  "use strict";

  const STORAGE_KEY = "oee_local_offline_log";
  const MODE_KEY = "oee_mode"; // 'SAFE' or 'ONLINE'
  const DEFAULT_MODE = "ONLINE";
  // pastikan mode selalu ONLINE
  let currentMode = "ONLINE";
  localStorage.setItem(MODE_KEY, currentMode);

  const firebaseConfig = {
    apiKey: "AIzaSyBXZzlGWEICRgxBp5RUO78E7Jp2nwvpDsg",
    authDomain: "ciiapps.firebaseapp.com",
    projectId: "ciiapps",
    storageBucket: "ciiapps.firebasestorage.app",
    messagingSenderId: "1033692640361",
    appId: "1:1033692640361:web:6e69e8ed3cd2c7ef249ef8",
    measurementId: "G-ZCG384P9G7"
  };

  const WEBAPP_URL = "https://oee-api-839375767453.asia-southeast2.run.app"; // Sesuaikan saat deploy
  const MIN_ROLE_APP = ["operator","supervisor","admin"];

  const qs  = (id)  => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const val = (id)  => { const e = qs(id); return e && e.value ? e.value.trim() : ""; };

  let auth = null;
  let currentRole = "guest";

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
    showChangeUserModal();
  }

  function refreshHeaderInfo(){
    const userName = localStorage.getItem('losses_username') || '(Belum set nama)';
    const userEmail = localStorage.getItem('losses_email') || '';
    const userRole = localStorage.getItem('losses_role') || 'guest';
    
    const nameEl = qs('sidebarUserName');
    const emailEl = qs('sidebarUserEmail');
    const roleEl = qs('sidebarUserRole');
    const pelapor = qs('fPelapor');
    
    if (nameEl) nameEl.textContent = userName;
    if (emailEl) emailEl.textContent = userEmail;
    if (roleEl) {
      roleEl.textContent = userRole;
      currentRole = userRole;
    }
    if (pelapor) pelapor.value = userName;
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
      mode: 'cors', // important
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

  // sinkronisasi data login dari index.html (url ?email=...&name=...)
  function syncLoginFromIndex(){
    try {
      const params = new URLSearchParams(window.location.search);
      const email = (params.get('email') || params.get('e') || '').trim();
      const name  = (params.get('name')  || params.get('username') || '').trim();
      if(email) localStorage.setItem('losses_email', email);
      if(name)  localStorage.setItem('losses_username', name);
    } catch (err) {
      console.warn('syncLoginFromIndex:', err);
    }
  }

  async function validateUserFromDatabase(){
    const userName = localStorage.getItem('losses_username') || '';
    const userEmail = localStorage.getItem('losses_email') || '';

    // jika email belum ada -> paksa input email+name
    if(!userEmail){
      showChangeUserModal('');
      return false;
    }

    // jika nama belum ada -> minta username (email sudah tersedia)
    if(!userName){
      showChangeUserModal(userEmail);
      return false;
    }

    // cek ke server secara tegas (JANGAN fallback ke allow)
    try {
      const resp = await fetch(WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'checkUserExists', email: userEmail, name: userName })
      });
      const j = await resp.json();
      
      // jika response tidak ok atau tidak valid
      if(!j || !j.ok) {
        showToast('error','Gagal validasi user, coba lagi');
        showChangeUserModal(userEmail);
        return false;
      }
      
      // jika user tidak ada di database
      if(!j.exists){
        showToast('error','User tidak terdaftar atau nama tidak cocok');
        showChangeUserModal(userEmail);
        return false;
      }
      
      // valid user -> simpan role jika ada dan lanjut
      if(j.role) localStorage.setItem('losses_role', j.role);
      return true;
    } catch (err) {
      console.error('validateUserFromDatabase fetch error:', err);
      showToast('error','Tidak dapat menghubungi server, periksa koneksi');
      showChangeUserModal(userEmail);
      return false;  // JANGAN return true di sini!
    }
  }

  function showChangeUserModal(prefillEmail = ''){
    // Hapus modal lama jika ada
    const oldModal = qs('user-modal-overlay');
    if(oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.id = 'user-modal-overlay';
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 class="text-lg font-semibold text-gray-800 mb-4">Verifikasi Data Pelapor</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" id="modalUserEmail" class="input w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="user@example.com" value="${prefillEmail}" ${prefillEmail ? 'disabled' : ''} />
            <p id="emailError" class="text-xs text-red-500 mt-1 hidden"></p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Nama Pelapor</label>
            <input type="text" id="modalUserName" class="input w-full px-3 py-2 border border-gray-300 rounded-md" placeholder="Nama lengkap" />
            <p id="nameError" class="text-xs text-red-500 mt-1 hidden"></p>
          </div>
          <button id="modalSubmitBtn" class="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700">Simpan & Masuk</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    const submitBtn = qs('modalSubmitBtn');
    const nameInput = qs('modalUserName');
    const emailInput = qs('modalUserEmail');
    const nameError = qs('nameError');
    const emailError = qs('emailError');
    
    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = prefillEmail || emailInput.value.trim();
      
      // Reset error messages
      nameError.classList.add('hidden');
      emailError.classList.add('hidden');
      nameError.textContent = '';
      emailError.textContent = '';
      
      // Validasi
      if(!name){
        nameError.textContent = 'Nama pelapor harus diisi';
        nameError.classList.remove('hidden');
        return;
      }
      
      if(!email){
        emailError.textContent = 'Email harus diisi';
        emailError.classList.remove('hidden');
        return;
      }
      
      if(!email.includes('@')){
        emailError.textContent = 'Format email tidak valid';
        emailError.classList.remove('hidden');
        return;
      }
      
      // Cek user ke database
      try {
        const response = await fetch(WEBAPP_URL, {
          method: 'POST',
          body: JSON.stringify({
            action: 'checkUserExists',
            email: email,
            name: name
          })
        });
        
        const result = await response.json();
        
        if(!result.exists){
          nameError.textContent = 'Username tidak terdaftar di sistem';
          nameError.classList.remove('hidden');
          nameInput.value = ''; // Kosongkan field username
          return;
        }
        
        // Simpan ke localStorage
        localStorage.setItem('losses_username', name);
        localStorage.setItem('losses_email', email);
        localStorage.setItem('losses_role', result.role || 'operator');
        
        modal.remove();
        refreshHeaderInfo();
        showToast('success', 'Data pelapor berhasil disimpan');
        
        // Reload tab content jika sudah di app.html
        if(window.location.pathname.includes('app.html')){
          renderMyLog();
          applyAllFilters();
          updateChartsFromRows(getAllLocal());
        }
      } catch (err) {
        console.error('Error:', err);
        nameError.textContent = 'Gagal validasi user: ' + err.message;
        nameError.classList.remove('hidden');
      }
    });
    
    // Focus ke field username
    nameInput.focus();
  }

  document.addEventListener('DOMContentLoaded', async function(){
    // sinkronisasi data dari index.html (jika ada)
    if (typeof syncLoginFromIndex === 'function') syncLoginFromIndex();

    // wajib validasi user - jika gagal, modal akan tampil dan init diblok
    const userValid = (typeof validateUserFromDatabase === 'function') ? await validateUserFromDatabase() : false;
    if(!userValid){
      // stop inisialisasi jika user belum valid / belum terdaftar
      return;
    }

    // set UI mode menjadi ONLINE dan sembunyikan toggle mode
    const modeEl = qs('mode-value'); if(modeEl){ modeEl.textContent = 'ONLINE'; modeEl.className = 'font-medium text-green-700'; }
    const toggle = qs('toggleModeBtn'); if(toggle){ toggle.style.display = 'none'; toggle.disabled = true; }

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

    const form = qs('loss-form'); if(form) form.addEventListener('submit', submitLoss);
    const s = qs('fStart'), f = qs('fFinish');
    if(s) s.addEventListener('input', computeDuration);
    if(f) f.addEventListener('input', computeDuration);

    const cu = qs('btnChangeUser'); if(cu) cu.addEventListener('click', changeUsername);

    const lb = qs('logout-button');
    if(lb){
      lb.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          if(window.firebase && typeof firebase.auth === 'function'){
            try { await ensureFirebase(); if(auth && typeof auth.signOut === 'function'){ await auth.signOut(); } else { await firebase.auth().signOut(); } } catch(_){/* ignore */ }
          }
          localStorage.removeItem('losses_username');
          localStorage.removeItem('losses_email');
          localStorage.removeItem('losses_role');
          // clear mode too to force fresh login flow next time
          localStorage.removeItem(MODE_KEY);
          showToast('success','Berhasil logout');
          setTimeout(()=> { location.href = './index.html'; }, 600);
        } catch (err) {
          console.error('Logout error:', err);
          showToast('error','Gagal logout');
        }
      });
    }

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
