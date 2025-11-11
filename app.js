/* =============================
   app.js (FULL VERSION)
   ============================= */
(() => {
  "use strict";
  let allLossData = [],
      paretoChartInstance = null,
      trendChartInstance = null,
      isSafeMode = (localStorage.getItem("losses_safe_mode") || "true") === "true";

  const WEBAPP_URL_ONLINE = "https://script.google.com/macros/s/AKfycbzCyTnL6icp_zYFANUgG5WlyntFcUOSlMsgNILYQLt2hGzw5sxNn0zNV_qtrVIcPg/exec";

  const qs = id => document.getElementById(id);
  const val = id => {
    const e = qs(id);
    return e && e.value ? e.value.trim() : "";
  };

  function showToast(type, message) {
    const el = type === "success" ? qs("toast-success") : qs("toast-error");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden", "translate-x-full");
    el.classList.add("translate-x-0");
    setTimeout(() => {
      el.classList.remove("translate-x-0");
      el.classList.add("translate-x-full");
      setTimeout(() => el.classList.add("hidden"), 300);
    }, 3000);
  }

  function diffMinutes(start, finish) {
    if (!start || !finish) return null;
    const [sh, sm] = start.split(":").map(Number),
          [fh, fm] = finish.split(":").map(Number);
    if ([sh, sm, fh, fm].some(isNaN)) return null;
    return fh * 60 + fm - (sh * 60 + sm);
  }

  function computeDuration() {
    const s = val("fStart"), f = val("fFinish"), d = diffMinutes(s, f), e = qs("fDurasi");
    if (!s || !f || d === null) return e.value = "";
    if (d <= 0) {
      e.value = "";
      showToast('error', 'Waktu Selesai harus lebih besar dari Waktu Mulai.');
    } else {
      e.value = d;
    }
  }

  function changeUsername() {
    const current = localStorage.getItem("losses_username") || "";
    const newName = prompt("Nama pelapor baru?", current);
    if (!newName) return;
    const name = newName.trim();
    if (!name) return showToast("error", "Nama tidak boleh kosong.");
    localStorage.setItem("losses_username", name);
    qs("sidebarUserName").textContent = name;
    qs("fPelapor").value = name;
    showToast("success", "Nama pelapor diperbarui.");
  }

  function refreshHeaderInfo() {
    const name = localStorage.getItem("losses_username") || "",
          email = localStorage.getItem("losses_email") || "",
          role = localStorage.getItem("losses_role") || "admin";
    qs("sidebarUserName").textContent = name || "(Belum set nama)";
    qs("sidebarUserEmail").textContent = email;
    qs("sidebarUserRole").textContent = role;
    qs("fPelapor").value = name;
  }

  function toggleMode() {
    isSafeMode = !isSafeMode;
    localStorage.setItem("losses_safe_mode", isSafeMode ? "true" : "false");
    qs("mode-value").textContent = isSafeMode ? "SAFE" : "ONLINE";
    qs("mode-value").className = isSafeMode ? "font-medium text-green-700" : "font-medium text-blue-700";
    showToast('success', isSafeMode ? 'Safe Mode aktif' : 'Online Mode aktif');
  }

  function submitLoss(ev) {
    ev.preventDefault();
    const name = (localStorage.getItem("losses_username") || "").trim();
    if (!name) return showToast('error', 'Nama pelapor belum diatur');
    const duration = diffMinutes(val('fStart'), val('fFinish'));
    if (duration === null || duration <= 0) return showToast('error', 'Durasi tidak valid');

    const data = {
      Tanggal: val('fTanggal'),
      Shift: val('fShift'),
      Area: val('fArea'),
      Mesin: val('fMesin'),
      Kategori: val('fKategori'),
      Issue: val('fIssue'),
      Pelapor: name,
      'WAKTU START': val('fStart'),
      'WAKTU FINISH': val('fFinish'),
      'Durasi Hilang': String(duration)
    };

    if (isSafeMode) {
      const cache = JSON.parse(localStorage.getItem('oee_local_offline_log') || '[]');
      cache.unshift(data);
      localStorage.setItem('oee_local_offline_log', JSON.stringify(cache));
      showToast('success', '✅ Data tersimpan (SAFE)');
      qs('loss-form').reset();
      qs('fTanggal').valueAsDate = new Date();
      qs('fPelapor').value = name;
      qs('fDurasi').value = '';
      return;
    }

    showToast('success', '(Simulasi ONLINE) Data tersimpan.');
  }

  document.addEventListener('DOMContentLoaded', () => {
    qs('fTanggal').valueAsDate = new Date();
    refreshHeaderInfo();
    qs('fStart').addEventListener('input', computeDuration);
    qs('fFinish').addEventListener('input', computeDuration);
    qs('loss-form').addEventListener('submit', submitLoss);
    qs('toggleModeBtn').addEventListener('click', toggleMode);
    qs('btnChangeUser').addEventListener('click', changeUsername);
    console.log('App initialized. Mode:', isSafeMode ? 'SAFE' : 'ONLINE');
  });
})();
