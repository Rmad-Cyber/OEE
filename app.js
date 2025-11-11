/* ==================================================
   Losses Tracker - app.js (FULL)
   Features:
   - Sidebar toggle & tab switching
   - SAFE/ONLINE mode switch (SAFE uses localStorage)
   - Username management
   - Form validation (duration > 0 minutes)
   - Auto-compute "Waktu Hilang"
   - My Log with date filter + CSV export
   - All Log with filters + CSV export
   - Dashboard charts (Pareto + Trend)
   - Marks window.__oee_app_wired__ = true
   ================================================== */
(function () {
  "use strict";

  // ---- Config ----
  const STORAGE_KEY = "oee_local_offline_log";
  const SAFE_MODE_KEY = "losses_safe_mode";
  const WEBAPP_URL =
    "https://script.google.com/macros/s/AKfycbzCyTnL6icp_zYFANUgG5WlyntFcUOSlMsgNILYQLt2hGzw5sxNn0zNV_qtrVIcPg/exec";
  const MIN_ROLE_APP = ["operator", "supervisor", "admin"];

  // ---- State ----
  let isSafeMode = (localStorage.getItem(SAFE_MODE_KEY) || "true") === "true";
  let paretoChartInstance = null;
  let trendChartInstance = null;

  // ---- DOM helpers ----
  const qs = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));
  const val = (id) => {
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
      setTimeout(() => el.classList.add("hidden"), 250);
    }, 2500);
  }

  // ---- Time & Duration ----
  function diffMinutes(start, finish) {
    if (!start || !finish) return null;
    const [sh, sm] = start.split(":").map(Number);
    const [fh, fm] = finish.split(":").map(Number);
    if ([sh, sm, fh, fm].some(isNaN)) return null;
    return fh * 60 + fm - (sh * 60 + sm);
  }

  function computeDuration() {
    const s = val("fStart");
    const f = val("fFinish");
    const d = diffMinutes(s, f);
    const el = qs("fDurasi");
    if (!el) return;
    if (!s || !f || d === null) {
      el.value = "";
      return;
    }
    if (d <= 0) {
      el.value = "";
      showToast(
        "error",
        "Waktu Selesai harus lebih besar daripada Waktu Mulai (durasi > 0 menit)."
      );
    } else {
      el.value = String(d);
    }
  }

  // ---- Username ----
  function changeUsername() {
    const current = localStorage.getItem("losses_username") || "";
    const nu = prompt("Nama pelapor baru?", current);
    if (!nu) return;
    const cleaned = nu.trim();
    if (!cleaned) {
      showToast("error", "Nama tidak boleh kosong.");
      return;
    }
    localStorage.setItem("losses_username", cleaned);
    refreshHeaderInfo();
    const pelaporField = qs("fPelapor");
    if (pelaporField) pelaporField.value = cleaned;
    showToast("success", "Nama pelapor diperbarui.");
  }

  function refreshHeaderInfo() {
    const uname =
      localStorage.getItem("losses_username") || "(Belum set nama)";
    const email = localStorage.getItem("losses_email") || "offline@local";
    const role = localStorage.getItem("losses_role") || "ADMIN";
    const nameEl = qs("sidebarUserName");
    const emailEl = qs("sidebarUserEmail");
    const roleEl = qs("sidebarUserRole");
    if (nameEl) nameEl.textContent = uname;
    if (emailEl) emailEl.textContent = email;
    if (roleEl) roleEl.textContent = role;
    const pelaporField = qs("fPelapor");
    if (pelaporField) pelaporField.value = uname === "(Belum set nama)" ? "" : uname;
  }

  // ---- Sidebar & Tabs ----
  function toggleSidebar() {
    const overlay = qs("sidebar-overlay");
    const sidebar = qs("sidebar");
    if (!sidebar || !overlay) return;
    const hidden = sidebar.classList.contains("-translate-x-full");
    if (hidden) {
      sidebar.classList.remove("-translate-x-full");
      sidebar.classList.add("translate-x-0");
      overlay.classList.remove("hidden");
    } else {
      sidebar.classList.add("-translate-x-full");
      sidebar.classList.remove("translate-x-0");
      overlay.classList.add("hidden");
    }
  }

  function switchTab(name) {
    qsa(".tab-content").forEach((el) => el.classList.add("hidden"));
    const active = qs("tab-" + name);
    if (active) active.classList.remove("hidden");

    qsa(".sidebar-nav-button").forEach((btn) => {
      btn.classList.remove("active", "bg-gray-900", "text-white");
      btn.classList.add("text-gray-300", "hover:bg-gray-700");
    });
    const activeBtn = document.querySelector(
      '.sidebar-nav-button[data-tab="' + name + '"]'
    );
    if (activeBtn) {
      activeBtn.classList.add("active", "bg-gray-900", "text-white");
      activeBtn.classList.remove("text-gray-300", "hover:bg-gray-700");
      const pageTitle = qs("page-title");
      if (pageTitle) pageTitle.textContent = activeBtn.textContent.trim();
    }

    // auto-close on small screens
    const sidebar = qs("sidebar");
    if (sidebar && !sidebar.classList.contains("-translate-x-full")) {
      toggleSidebar();
    }

    // Lazy tasks
    if (name === "dashboard") {
      const all = getAllLocal();
      updateChartsFromRows(all);
    }
    if (name === "mylog") {
      filterMyLogSince("");
    }
    if (name === "alllog") {
      applyAllFilters();
    }
  }

  // ---- SAFE/ONLINE ----
  function setModeLabel() {
    const el = qs("mode-value");
    if (!el) return;
    el.textContent = isSafeMode ? "SAFE" : "ONLINE";
    el.className = isSafeMode
      ? "font-medium text-green-700"
      : "font-medium text-blue-700";
  }

  function toggleMode() {
    isSafeMode = !isSafeMode;
    localStorage.setItem(SAFE_MODE_KEY, isSafeMode ? "true" : "false");
    setModeLabel();
    showToast("success", isSafeMode ? "Safe Mode aktif" : "Online Mode aktif");
  }

  // ---- Storage utils (SAFE) ----
  function getAllLocal() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function setAllLocal(rows) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows || []));
  }

  // ---- Form Submit ----
  async function submitLoss(e) {
    e.preventDefault();

    const uname = (localStorage.getItem("losses_username") || "").trim();
    if (!uname) {
      showToast(
        "error",
        "Nama Pelapor belum diset. Klik 'Ganti Nama Pelapor' di menu samping."
      );
      return;
    }

    const duration = diffMinutes(val("fStart"), val("fFinish"));
    if (duration === null || duration <= 0) {
      showToast("error", "Durasi tidak valid (harus > 0 menit).");
      return;
    }

    const payload = {
      Tanggal: val("fTanggal"),
      Shift: val("fShift"),
      Area: val("fArea"),
      Mesin: val("fMesin"),
      Pelapor: uname,
      Issue: val("fIssue"),
      Kategori: val("fKategori"),
      "WAKTU START": val("fStart"),
      "WAKTU FINISH": val("fFinish"),
      "Durasi Hilang": String(duration),
    };

    if (isSafeMode) {
      const rows = getAllLocal();
      rows.unshift(payload);
      setAllLocal(rows);
      showToast("success", "✅ Data tersimpan (SAFE).");
      // reset form (keep date today & pelapor)
      const pelaporBackup = uname;
      qs("loss-form").reset();
      const fTanggal = qs("fTanggal");
      if (fTanggal) fTanggal.valueAsDate = new Date();
      const fPelapor = qs("fPelapor");
      if (fPelapor) fPelapor.value = pelaporBackup;
      qs("fDurasi").value = "";
      return;
    }

    // ONLINE placeholder
    try {
      // Implement your fetch to WEBAPP_URL if needed
      showToast("success", "(Simulasi ONLINE) Data tersimpan.");
    } catch (err) {
      showToast("error", "Gagal online: " + err.message);
    }
  }

  // ---- Renderers ----
  function renderRowsToTbody(tbodyId, rows, columns, emptyColspan) {
    const tbody = qs(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!rows || rows.length === 0) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="${emptyColspan}" class="px-6 py-4 text-center text-gray-500">Tidak ada data.</td>`;
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((r) => {
      const tds = columns.map((col) => {
        const raw = r[col] || "";
        if (col === "Issue") {
          return `<td class="max-w-xs truncate" title="${escapeHtml(
            raw
          )}">${escapeHtml(raw)}</td>`;
        }
        return `<td>${escapeHtml(raw)}</td>`;
      });
      const tr = document.createElement("tr");
      tr.innerHTML = tds.join("");
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ---- My Log ----
  function filterMyLogSince(sinceISO) {
    const myName = (localStorage.getItem("losses_username") || "").trim();
    const all = getAllLocal();
    let rows = all.filter((r) => (r.Pelapor || "").trim() === myName);
    if (sinceISO) {
      const t0 = new Date(sinceISO);
      rows = rows.filter((r) => {
        const t = new Date(r.Tanggal);
        return !isNaN(t) && t >= t0;
      });
    }
    renderRowsToTbody(
      "mylog-body",
      rows,
      [
        "Tanggal",
        "Shift",
        "Area",
        "Mesin",
        "Kategori",
        "Issue",
        "WAKTU START",
        "WAKTU FINISH",
        "Durasi Hilang",
      ],
      9
    );
  }

  // ---- All Log ----
  function applyAllFilters() {
    const all = getAllLocal();
    const since = val("fltSince");
    const until = val("fltUntil");
    const shift = val("fltShift");
    const area = val("fltArea").toLowerCase();
    const mesin = val("fltMesin").toLowerCase();
    const kategori = val("fltKategori");
    const pelapor = val("fltPelapor").toLowerCase();

    let rows = all.slice();

    if (since) {
      const t0 = new Date(since);
      rows = rows.filter((r) => {
        const t = new Date(r.Tanggal);
        return !isNaN(t) && t >= t0;
      });
    }
    if (until) {
      const t1 = new Date(until);
      t1.setHours(23, 59, 59, 999);
      rows = rows.filter((r) => {
        const t = new Date(r.Tanggal);
        return !isNaN(t) && t <= t1;
      });
    }
    if (shift) rows = rows.filter((r) => (r.Shift || "") === shift);
    if (kategori) rows = rows.filter((r) => (r.Kategori || "") === kategori);
    if (area)
      rows = rows.filter((r) =>
        (r.Area || "").toLowerCase().includes(area)
      );
    if (mesin)
      rows = rows.filter((r) =>
        (r.Mesin || "").toLowerCase().includes(mesin)
      );
    if (pelapor)
      rows = rows.filter((r) =>
        (r.Pelapor || "").toLowerCase().includes(pelapor)
      );

    renderRowsToTbody(
      "alllog-body",
      rows,
      [
        "Tanggal",
        "Shift",
        "Area",
        "Mesin",
        "Kategori",
        "Issue",
        "WAKTU START",
        "WAKTU FINISH",
        "Durasi Hilang",
        "Pelapor",
      ],
      10
    );
  }

  // ---- CSV Export ----
  function rowsToCsv(rows, headers) {
    const escape = (v) => {
      const s = String(v || "");
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [];
    lines.push(headers.join(","));
    rows.forEach((r) => {
      lines.push(headers.map((h) => escape(r[h])).join(","));
    });
    return lines.join("\n");
  }

  function download(filename, content, mime = "text/csv") {
    const a = document.createElement("a");
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportMyLogCsv() {
    const myName = (localStorage.getItem("losses_username") || "").trim();
    const sinceISO = val("mySince");
    const all = getAllLocal();
    let rows = all.filter((r) => (r.Pelapor || "").trim() === myName);
    if (sinceISO) {
      const t0 = new Date(sinceISO);
      rows = rows.filter((r) => {
        const t = new Date(r.Tanggal);
        return !isNaN(t) && t >= t0;
      });
    }
    const headers = [
      "Tanggal",
      "Shift",
      "Area",
      "Mesin",
      "Kategori",
      "Issue",
      "WAKTU START",
      "WAKTU FINISH",
      "Durasi Hilang",
    ];
    const csv = rowsToCsv(rows, headers);
    download("my_log.csv", csv);
  }

  function exportAllLogCsv() {
    const tbody = qs("alllog-body");
    if (!tbody) return;
    // Rebuild from DOM to respect current filter result
    const rows = [];
    Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length === 10) {
        rows.push({
          Tanggal: tds[0].textContent,
          Shift: tds[1].textContent,
          Area: tds[2].textContent,
          Mesin: tds[3].textContent,
          Kategori: tds[4].textContent,
          Issue: tds[5].textContent,
          "WAKTU START": tds[6].textContent,
          "WAKTU FINISH": tds[7].textContent,
          "Durasi Hilang": tds[8].textContent,
          Pelapor: tds[9].textContent,
        });
      }
    });
    const headers = [
      "Tanggal",
      "Shift",
      "Area",
      "Mesin",
      "Kategori",
      "Issue",
      "WAKTU START",
      "WAKTU FINISH",
      "Durasi Hilang",
      "Pelapor",
    ];
    const csv = rowsToCsv(rows, headers);
    download("all_log.csv", csv);
  }

  // ---- Charts ----
  function updateChartsFromRows(rows) {
    updateParetoChart(rows);
    updateTrendChart(rows);
  }

  function updateParetoChart(rows) {
    const ctx = document.getElementById("pareto-chart");
    if (!ctx) return;

    const summary = rows.reduce((acc, r) => {
      const c = r["Kategori"] || "Lainnya";
      const d = Number(r["Durasi Hilang"]) || 0;
      acc[c] = (acc[c] || 0) + d;
      return acc;
    }, {});

    const sorted = Object.entries(summary).sort(([, a], [, b]) => b - a);
    const labels = sorted.map(([k]) => k);
    const data = sorted.map(([, v]) => v);

    if (paretoChartInstance) paretoChartInstance.destroy();
    const ctx2d = ctx.getContext("2d");
    paretoChartInstance = new Chart(ctx2d, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Durasi Loss (Menit)",
            data,
            backgroundColor: "rgba(239,68,68,0.6)",
            borderColor: "rgba(239,68,68,1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: "Total Menit Loss" },
          },
          x: { title: { display: true, text: "Kategori Kerugian" } },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  function updateTrendChart(rows) {
    const ctx = document.getElementById("trend-chart");
    if (!ctx) return;

    // Aggregate by date
    const byDate = rows.reduce((acc, r) => {
      const t = r["Tanggal"] || "";
      const d = Number(r["Durasi Hilang"]) || 0;
      acc[t] = (acc[t] || 0) + d;
      return acc;
    }, {});

    const labels = Object.keys(byDate).sort();
    const data = labels.map((k) => byDate[k]);

    if (trendChartInstance) trendChartInstance.destroy();
    const ctx2d = ctx.getContext("2d");
    trendChartInstance = new Chart(ctx2d, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Total Loss (Menit)",
            data,
            borderColor: "rgb(59,130,246)",
            fill: false,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Total Menit" } },
        },
      },
    });
  }

  // ---- Init ----
  document.addEventListener("DOMContentLoaded", () => {
    // mark wired to suppress fallback
    window.__oee_app_wired__ = true;

    // Initial labels & header
    setModeLabel();
    refreshHeaderInfo();

    // Default dates
    const fTanggal = qs("fTanggal");
    if (fTanggal) fTanggal.valueAsDate = new Date();

    // Sidebar & overlay
    const openBtn = qs("open-sidebar-button");
    const overlay = qs("sidebar-overlay");
    if (openBtn) openBtn.addEventListener("click", toggleSidebar);
    if (overlay) overlay.addEventListener("click", toggleSidebar);

    // Tabs
    qsa(".sidebar-nav-button").forEach((btn) => {
      btn.addEventListener("click", () =>
        switchTab(btn.getAttribute("data-tab"))
      );
    });
    switchTab("input");

    // Form handlers
    const form = qs("loss-form");
    if (form) form.addEventListener("submit", submitLoss);
    const fStart = qs("fStart");
    const fFinish = qs("fFinish");
    if (fStart) fStart.addEventListener("input", computeDuration);
    if (fFinish) fFinish.addEventListener("input", computeDuration);

    // Mode & username
    const toggleBtn = qs("toggleModeBtn");
    if (toggleBtn) toggleBtn.addEventListener("click", toggleMode);
    const changeUserBtn = qs("btnChangeUser");
    if (changeUserBtn) changeUserBtn.addEventListener("click", changeUsername);

    // My Log controls
    const myApply = qs("applyMyLogFilter");
    const myRefresh = qs("refreshMyLog");
    const myCsv = qs("downloadMyLogCsv");
    if (myApply) myApply.addEventListener("click", () =>
      filterMyLogSince(val("mySince"))
    );
    if (myRefresh) myRefresh.addEventListener("click", () =>
      filterMyLogSince("")
    );
    if (myCsv) myCsv.addEventListener("click", exportMyLogCsv);

    // All Log controls
    const allApply = qs("btnApplyAllFilters");
    const allReset = qs("btnResetAllFilters");
    const allCsv = qs("downloadAllLogCsv");
    if (allApply) allApply.addEventListener("click", applyAllFilters);
    if (allReset)
      allReset.addEventListener("click", () => {
        [
          "fltSince",
          "fltUntil",
          "fltShift",
          "fltArea",
          "fltMesin",
          "fltKategori",
          "fltPelapor",
        ].forEach((id) => {
          const el = qs(id);
          if (el) el.value = "";
        });
        applyAllFilters();
      });
    if (allCsv) allCsv.addEventListener("click", exportAllLogCsv);

    // Preload default logs view
    filterMyLogSince("");
    applyAllFilters();
  });
})();
