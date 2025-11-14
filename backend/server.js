const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const admin = require('firebase-admin');

// Option A: gunakan service account JSON via env var (recommended for Cloud Run)
// set env var GOOGLE_SERVICE_ACCOUNT_JSON='{"type":...}' or mount secret file and parse it
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  const svc = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  admin.initializeApp({ credential: admin.credential.cert(svc) });
} else {
  // fallback: gunakan Application Default Credentials (pastikan service account Cloud Run punya permission)
  admin.initializeApp();
}

/**** =========================
 * CONFIG
 * ========================= ***/
const spreadsheetId = '1VO8g0E1pjan6WVBEBychMpmgkZgQwAuvDjiKp4JdFgg'; // <-- DARI ANDA
const SHEET_LOSSES = 'Losses';
const SHEET_USERS = 'Users';
const ENFORCE_WHITELIST = true;

// Header mapping (sama dengan AppScript)
const H = {
    id: 'ID',
    date: 'Tanggal',
    shift: 'Shift',
    factory: 'Factory',
    line: 'Line',
    machine: 'Mesin',
    issue: 'Issue',
    category: 'Kategori',
    start: 'WAKTU START',
    finish: 'WAKTU FINISH',
    duration: 'Durasi Hilang',
    reporter: 'Pelapor',
    lastUpdated: 'lastUpdated',
    version: 'version',
};

// Role minimum (dipakai di middleware `checkRole`)
const ROLE_ORDER = ['guest', 'operator', 'supervisor', 'admin'];

/**** =========================
 * INIT & MIDDLEWARE
 * ========================= ***/

// Inisialisasi Express
const app = express();
app.use(cors()); // Menggantikan doOptions dan header CORS
app.use(express.json()); // Menggantikan parseBody_

// Inisialisasi Google Auth (Sheets & Lainnya)
// Ini secara otomatis menggunakan kredensial dari Secret Manager
const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// Inisialisasi Firebase Admin
// Ini juga akan secara otomatis menggunakan kredensial yang sama
try {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (error) {
    console.error("Firebase Admin SDK initialization error:", error.message);
}


// MIDDLEWARE: Verifikasi token, ambil email, dan role
const authMiddleware = async (req, res, next) => {
    try {
        const token = getToken_(req);
        if (!token) {
            return res.status(401).json({ ok: false, error: 'NO_TOKEN' });
        }
        
        // Verifikasi token (menggantikan verifyFirebaseIdToken_)
        const decodedToken = await admin.auth().verifyIdToken(token);
        const email = decodedToken.email;
        if (!email) {
            return res.status(401).json({ ok: false, error: 'NO_EMAIL_IN_TOKEN' });
        }

        // Ambil role (menggantikan getUserRole_)
        const role = await getUserRole_(email) || 'guest';
        
        // Cek Whitelist
        const isWhitelisted = !!role && role !== 'guest';
        if (ENFORCE_WHITELIST && !isWhitelisted) {
             return res.status(403).json({ ok:false, error:'NOT_WHITELISTED', email });
        }

        // Teruskan email dan role ke handler berikutnya
        req.email = email;
        req.role = role;
        next();

    } catch (err) {
        console.error("Auth middleware error:", err.message);
        return res.status(401).json({ ok: false, error: 'INVALID_TOKEN', message: err.message });
    }
};

// MIDDLEWARE: Pabrik untuk cek role minimal
const checkRole = (minRole) => (req, res, next) => {
    if (!roleGte_(req.role, minRole)) {
        return res.status(403).json({ 
            ok: false, 
            error: 'ROLE_FORBIDDEN', 
            role: req.role, 
            needed: minRole 
        });
    }
    next();
};


/**** =========================
 * AUTH HELPERS (Migrasi)
 * ========================= ***/

function getToken_(req) {
    // 1) query ?token=...
    if (req.query && req.query.token) return req.query.token;
    // 2) body JSON { token: "..." }
    if (req.body && req.body.token) return req.body.token;
    // 3) Authorization header
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}

async function getUserRole_(email) {
    if (!email) return null;
    try {
        const data = await readObjects_(SHEET_USERS, `${SHEET_USERS}!A:C`); // Asumsi email/role di 3 kolom pertama
        const row = data.find(r => String(r.email).toLowerCase() === String(email).toLowerCase());
        return row ? String(row.role).toLowerCase() : null;
    } catch (error) {
        console.error("Error getting user role:", error);
        return null;
    }
}

function roleGte_(have, need) {
    return ROLE_ORDER.indexOf(have) >= ROLE_ORDER.indexOf(need);
}

/**** =========================
 * PUBLIC ENDPOINTS (Tanpa Auth)
 * ========================= ***/

// Menggantikan checkUserExists_
app.get('/checkUserExists', async (req, res) => {
    try {
        const { email, name } = req.query; // Ubah dari body ke query
        if (!email) return res.json({ ok:false, error:'NO_EMAIL' });

        const data = await readObjects_(SHEET_USERS, `${SHEET_USERS}!A:C`);
        if (!data.length) return res.json({ ok:true, exists:false });

        const row = data.find(r => String(r.email || '').toLowerCase() === String(email).toLowerCase());
        if (!row) return res.json({ ok:true, exists:false });

        if (name && row.username) {
            const actualName = String(row.username || '').trim();
            if (actualName.toLowerCase() !== name.toLowerCase()) {
                return res.json({ ok:true, exists:false, reason: 'USERNAME_MISMATCH' });
            }
        }
        
        return res.json({ ok:true, exists:true, role: row.role ? String(row.role).toLowerCase() : null });
    } catch (err) {
        console.error("checkUserExists error:", err.message);
        res.status(500).json({ ok:false, error: err.message });
    }
});


/**** =========================
 * AUTH ENDPOINTS (Perlu Token)
 * ========================= ***/

// Menggantikan action=whoami
app.get('/whoami', async (req, res) => {
  try {
    const token = req.query.token || '';
    if (!token) return res.status(400).json({ ok:false, error:'NO_TOKEN' });
    const decoded = await admin.auth().verifyIdToken(token);
    // decoded.email, decoded.uid, etc
    const email = decoded.email || null;
    // get role from sheet / DB (implement getUserRole_)
    const role = await getUserRole_(email); // implement/ensure this exists
    return res.json({ ok:true, email, role: role || 'guest' });
  } catch (err) {
    console.error('whoami verify error', err);
    return res.status(401).json({ ok:false, error:'INVALID_TOKEN', message: String(err.message || err) });
  }
});

// Menggantikan action=list_losses
app.get('/losses', authMiddleware, checkRole('operator'), async (req, res) => {
    try {
        const { page = 1, pageSize = 100, q = '', since = '' } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10));
        const pageSizeNum = Math.min(500, Math.max(1, parseInt(pageSize, 10)));
        const sinceDate = since ? new Date(since) : null;
        const qLower = q.toLowerCase();

        const data = await readObjects_(SHEET_LOSSES);
        let arr = data;

        // Filter 'since' (jika ada)
        if (sinceDate && data.length > 0 && data[0][H.lastUpdated]) {
            arr = arr.filter(o => {
                if (!o[H.lastUpdated]) return false;
                const t = new Date(o[H.lastUpdated]);
                return t > sinceDate;
            });
        }

        // Filter 'q' (keyword)
        if (qLower) {
            arr = arr.filter(o => Object.keys(o).some(k => String(o[k]).toLowerCase().includes(qLower)));
        }

        const total = arr.length;
        const start = (pageNum - 1) * pageSizeNum;
        const end = Math.min(total, start + pageSizeNum);
        const items = start < total ? arr.slice(start, end) : [];

        res.json({ ok: true, page: pageNum, pageSize: pageSizeNum, total, items });
    } catch (err) {
        console.error("list_losses error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Menggantikan action=create_losses
app.post('/losses', authMiddleware, checkRole('operator'), async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        const headers = await getHeaders_(SHEET_LOSSES);
        const now = nowIso_();

        const rows = items.map(it => {
            const o = sanitizeLossObj_(it);
            if (!o[H.id]) o[H.id] = crypto.randomUUID(); // Pengganti Utilities.getUuid()
            if (!o[H.reporter]) o[H.reporter] = req.email; // Ambil email dari auth
            o[H.lastUpdated] = now;
            o[H.version] = (Number(o[H.version]) | 0) + 1;
            return headers.map(h => normalizeCell_(o[h]));
        });

        await appendRows_(SHEET_LOSSES, rows);
        res.json({ ok: true, inserted: rows.length });
    } catch (err) {
        console.error("create_losses error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Menggantikan action=update_losses
app.put('/losses', authMiddleware, checkRole('supervisor'), async (req, res) => {
    try {
        const items = Array.isArray(req.body) ? req.body : [req.body];
        const { headers, values } = await getSheetDataWithHeaders_(SHEET_LOSSES);
        if (!values) return res.json({ ok: false, error: 'EMPTY_SHEET' });

        const idxId = headers.indexOf(H.id);
        if (idxId < 0) return res.json({ ok: false, error: 'NO_ID_COLUMN' });

        const map = new Map(values.map((r, i) => [String(r[idxId]), { rowIndex: i + 2, data: r }]));
        let updated = 0;
        const now = nowIso_();
        
        const dataForBatchUpdate = [];

        items.forEach(it => {
            const id = String(it[H.id] || '');
            if (!id) return;
            const rec = map.get(id);
            if (!rec) return; // Data tidak ditemukan, skip

            const newRowData = [...rec.data]; // Salin data lama
            headers.forEach((h, i) => {
                if (h === H.id) return;
                if (h === H.lastUpdated) newRowData[i] = now;
                else if (h === H.version) newRowData[i] = (Number(newRowData[i]) | 0) + 1;
                else if (it[h] !== undefined) newRowData[i] = it[h];
            });
            
            // Siapkan data untuk batch update
            dataForBatchUpdate.push({
                range: `${SHEET_LOSSES}!A${rec.rowIndex}:${String.fromCharCode(65 + headers.length - 1)}${rec.rowIndex}`,
                values: [newRowData]
            });
            updated++;
        });

        if (updated > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: spreadsheetId,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: dataForBatchUpdate
                }
            });
        }

        res.json({ ok: true, updated });
    } catch (err) {
        console.error("update_losses error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Menggantikan action=delete_losses
app.delete('/losses', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
        // req.body diharapkan berisi array ID: ["id1", "id2"]
        const ids = Array.isArray(req.body) ? req.body : [req.body];
        const { headers, values } = await getSheetDataWithHeaders_(SHEET_LOSSES);
        if (!values) return res.json({ ok: false, error: 'EMPTY_SHEET' });

        const idxId = headers.indexOf(H.id);
        if (idxId < 0) return res.json({ ok: false, error: 'NO_ID_COLUMN' });

        // Dapatkan sheetId (bukan nama sheet)
        const sheetMetadata = await sheets.spreadsheets.get({ spreadsheetId });
        const sheet = sheetMetadata.data.sheets.find(s => s.properties.title === SHEET_LOSSES);
        const sheetId = sheet.properties.sheetId;

        // Cari semua row index yang cocok
        const rowIndicesToDelete = [];
        values.forEach((r, i) => {
            if (ids.includes(String(r[idxId]))) {
                rowIndicesToDelete.push(i + 1); // 0-based index for API
            }
        });

        if (rowIndicesToDelete.length === 0) {
            return res.json({ ok: true, deleted: 0, message: "No matching rows found." });
        }

        // Buat permintaan batchUpdate untuk menghapus baris
        // Kita harus menghapus dari bawah ke atas agar index tidak bergeser
        const requests = rowIndicesToDelete
            .sort((a, b) => b - a) // Sort descending
            .map(rowIndex => ({
                deleteDimension: {
                    range: {
                        sheetId: sheetId,
                        dimension: 'ROWS',
                        startIndex: rowIndex,
                        endIndex: rowIndex + 1
                    }
                }
            }));

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: spreadsheetId,
            requestBody: {
                requests: requests
            }
        });
        
        res.json({ ok: true, deleted: rowIndicesToDelete.length });
    } catch (err) {
        console.error("delete_losses error:", err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});


/**** =========================
 * SHEET HELPERS (Async)
 * ========================= ***/

async function getHeaders_(sheetName) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!1:1`,
    });
    return res.data.values ? res.data.values[0] : [];
}

async function getSheetDataWithHeaders_(sheetName) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId,
        range: sheetName,
    });
    if (!res.data.values || res.data.values.length === 0) {
        return { headers: [], values: null };
    }
    const headers = res.data.values.shift();
    return { headers, values: res.data.values };
}

async function readObjects_(sheetName, range = null) {
    const sheetRange = range || sheetName;
    const { headers, values } = await getSheetDataWithHeaders_(sheetRange);
    
    if (!values) return [];

    return values.map(r => {
        const o = {};
        headers.forEach((h, i) => o[h] = r[i]);
        return o;
    });
}

async function appendRows_(sheetName, rows) {
    if (!rows.length) return;
    await sheets.spreadsheets.values.append({
        spreadsheetId: spreadsheetId,
        range: `${sheetName}!A1`, // Akan append di akhir sheet
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: rows,
        },
    });
}

// Helper AppScript (fungsi identik)
function sanitizeLossObj_(o) {
    const out = {};
    Object.values(H).forEach(h => { if (o[h] !== undefined) out[h] = o[h]; });
    return out;
}
function normalizeCell_(v) { return v === undefined ? '' : v; }
function nowIso_() { return new Date().toISOString(); }


/**** =========================
 * START SERVER
 * ========================= ***/
const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});