// app.js - Diperbarui untuk Cloud Run (RESTful + Bearer Token)
;(function () {
  "use strict";

  const STORAGE_KEY = "oee_local_offline_log";
  // 🛑 API_URL HARUS BASE URL (tanpa /whoami atau ?action=)
  const API_URL = "https://oee-api-839375767453.asia-southeast2.run.app";

  const qs  = (id)  => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const val = (id)  => { const e = qs(id); return e && e.value ? e.value.trim() : ""; };

  let auth = null;
  let currentRole = "guest";
  let currentIdToken = null; // Simpan token agar tidak perlu get ulang terus

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

  // ... (fungsi helper lain seperti toggleSidebar, switchTab, dll. SAMA SEPERTI FILE LAMA ANDA) ...
  // ... (Saya hanya akan menyertakan fungsi yang BERUBAH) ...

  // ==========================================================
  // FUNGSI LAMA (Boleh disalin dari file lama Anda jika perlu)
  function toggleSidebar(){ /* ... */ }
  function switchTab(name){ /* ... */ }
  function changeUsername(){ showChangeUserModal(); }
  function diffMinutes(s,f){ /* ... */ }
  function computeDuration(){ /* ... */ }
  function getAllLocal(){ /* ... */ }
  function setAllLocal(rows){ /* ... */ }
  function escapeHtml(s){ /* ... */ }
  function renderRowsToTbody(tbodyId, rows, cols, colspan){ /* ... */ }
  function renderMyLog(){ /* ... */ }
  function applyAllFilters(){ /* ... */ }
  function csvEscape(v){ /* ... */ }
  function rowsToCsv(rows, headers){ /* ... */ }
  function download(filename, content, mime){ /* ... */ }
  function exportMyLogCsv(){ /* ... */ }
  function exportAllLogCsv(){ /* ... */ }
  function updateChartsFromRows(rows){ /* ... */ }
  function updatePareto(rows){ /* ... */ }
  function updateTrend(rows){ /* ... */ }
  // ==========================================================


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

  // 🛑 PERBAIKAN: Fungsi init Firebase
  async function ensureFirebase(){
    if(!auth){
      try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
      } catch(e) {
        // Firebase sudah di-init
        auth = firebase.auth();
      }
    }
    
    // Cek user, jika tidak ada, redirect ke login
    const user = auth.currentUser;
    if (!user) {
      showToast('error', 'Sesi tidak ditemukan. Mengarahkan ke login...');
      setTimeout(() => { window.location.href = 'index.html'; }, 1500);
      throw new Error("No user");
    }
    
    // Ambil token
    try {
      currentIdToken = await user.getIdToken(true); // Dapatkan token baru
      return user;
    } catch (err) {
      showToast('error', 'Sesi berakhir. Mengarahkan ke login...');
      setTimeout(() => { window.location.href = 'index.html'; }, 1500);
      throw new Error("Token expired");
    }
  }

  // 🛑 PERBAIKAN: whoAmI (sekarang menggunakan Auth Header)
  // (Fungsi ini sebenarnya tidak lagi diperlukan di app.js karena index.html sudah menanganinya,
  // tapi kita perbaiki untuk jaga-jaga)
  async function whoAmI(){
    const user = await ensureFirebase(); // Ini akan mendapatkan token dan menyimpannya di currentIdToken
    
    const res = await fetch(`${API_URL}/whoami`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + currentIdToken 
      }
    });
    const data = await res.json();
    return data;
  }

  // 🛑 PERBAIKAN: onlineCreateLoss (RESTful POST, Auth Header, JSON body)
  async function onlineCreateLoss(payload){
    await ensureFirebase(); // Memastikan currentIdToken terisi
    
    const res = await fetch(`${API_URL}/losses`, { // Endpoint: POST /losses
      method:"POST",
      headers:{
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + currentIdToken
      },
      body: JSON.stringify(payload) // Kirim payload (bukan {token, data})
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
      "Factory":       "", // Anda set kosong, biarkan
      "Line":          "", // Anda set kosong, biarkan
      "Mesin":         val('fMesin'),
      "Area":          val('fArea'), // Pastikan Sheet Anda punya kolom 'Area'
      "Pelapor":       uname,
      "Issue":         val('fIssue'),
      "Kategori":      val('fKategori'),
      "WAKTU START":   val('fStart'),
      "WAKTU FINISH":  val('fFinish'),
      "Durasi Hilang": String(d)
    };

    // Mode 'SAFE' (offline) Anda saya hapus, karena app.js baru
    // hanya akan load jika user sudah tervalidasi ONLINE.
    try {
      await onlineCreateLoss([payloadRow]); // Kirim sebagai array
      showToast('success','✅ Data tersimpan (ONLINE).');
      
      const form = qs('loss-form'); if(form) form.reset();
      const t = qs('fTanggal'); if(t) t.valueAsDate = new Date();
      const p = qs('fPelapor'); if(p) p.value = uname;
      const du = qs('fDurasi'); if(du) du.value = '';

      // (Anda mungkin perlu memuat ulang log dari server di sini, bukan dari localstorage)
      // renderMyLog(); 
      // applyAllFilters();
      // updateChartsFromRows(getAllLocal());

    } catch(err) {
      console.error(err);
      showToast('error','ONLINE gagal: ' + err.message);
      // Anda bisa tambahkan lagi logika 'SAFE' (offline) di sini jika mau
    }
  }
  
  // 🛑 PERBAIKAN: Fungsi ini tidak lagi dipakai, login ditangani di index.html
  // function syncLoginFromIndex(){ /* ... */ }

  // 🛑 PERBAIKAN: Fungsi ini dipanggil dari modal
  async function validateUserFromDatabase(email, name) {
    try {
      // Ini adalah endpoint PUBLIK, tidak perlu token
      const resp = await fetch(`${API_URL}/checkUserExists`, { // Endpoint: POST /checkUserExists
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, name: name })
      });
      const j = await resp.json();
      return j; // Kembalikan seluruh response JSON
      
    } catch (err) {
      console.error('validateUserFromDatabase fetch error:', err);
      return { ok: false, error: 'Tidak dapat menghubungi server' };
    }
  }

  // 🛑 PERBAIKAN: Modal ini sekarang menggunakan `validateUserFromDatabase` yang baru
  function showChangeUserModal(prefillEmail = ''){
    const oldModal = qs('user-modal-overlay');
    if(oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    modal.id = 'user-modal-overlay';
    modal.innerHTML = `... (HTML Modal Anda SAMA SEPERTI SEBELUMNYA) ...`; // Salin HTML modal dari file lama Anda
    
    document.body.appendChild(modal);
    
    const submitBtn = qs('modalSubmitBtn');
    const nameInput = qs('modalUserName');
    const emailInput = qs('modalUserEmail');
    const nameError = qs('nameError');
    const emailError = qs('emailError');

    // Prefill data
    if(prefillEmail) {
      emailInput.value = prefillEmail;
      emailInput.disabled = true;
    }
    nameInput.value = localStorage.getItem('losses_username') || '';
    
    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      
      nameError.classList.add('hidden');
      emailError.classList.add('hidden');
      
      if(!name){ /* ... (validasi nama) ... */ return; }
      if(!email || !email.includes('@')){ /* ... (validasi email) ... */ return; }
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Memverifikasi...';

      // 🛑 PERBAIKAN: Panggil fungsi validate yang baru
      const result = await validateUserFromDatabase(email, name);
      
      if(!result.ok || !result.exists){
        nameError.textContent = result.reason ? 'Nama tidak cocok' : (result.error || 'User tidak terdaftar');
        nameError.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan & Masuk';
        return;
      }
      
      // Sukses
      localStorage.setItem('losses_username', name);
      localStorage.setItem('losses_email', email);
      localStorage.setItem('losses_role', result.role || 'operator');
      
      modal.remove();
      refreshHeaderInfo();
      showToast('success', 'Data pelapor berhasil diperbarui');
    });
    
    nameInput.focus();
  }


  document.addEventListener('DOMContentLoaded', async function(){
    // Inisialisasi Firebase dan cek user
    try {
      await ensureFirebase();
    } catch (err) {
      // Gagal (misal, token expired atau user tidak ada)
      // `ensureFirebase` sudah menangani redirect, jadi stop di sini
      return; 
    }

    // Set UI mode menjadi ONLINE dan sembunyikan toggle mode
    const modeEl = qs('mode-value'); if(modeEl){ modeEl.textContent = 'ONLINE'; modeEl.className = 'font-medium text-green-700'; }
    const toggle = qs('toggleModeBtn'); if(toggle){ toggle.style.display = 'none'; toggle.disabled = true; }

    const t = qs('fTanggal'); if(t) t.valueAsDate = new Date();
    refreshHeaderInfo();

    // ... (Semua event listener Anda yang lain SAMA SEPERTI SEBELUMNYA) ...
    const ob = qs('open-sidebar-button'); /* ... */
    const ov = qs('sidebar-overlay'); /* ... */
    qsa('.sidebar-nav-button').forEach(/* ... */);
    switchTab('input');
    const form = qs('loss-form'); if(form) form.addEventListener('submit', submitLoss);
    /* ... (dan seterusnya) ... */
    
  });
})();