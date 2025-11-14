const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto'); // Untuk UUID

/**** =========================
 * KONFIGURASI
 * ========================= ***/
const spreadsheetId = '1VO8g0E1pjan6WVBEBychMpmgkZgQwAuvDjiKp4JdFgg';
const SHEET_LOSSES = 'Losses';
const SHEET_USERS = 'Users';
const ENFORCE_WHITELIST = true;
const ROLE_ORDER = ['guest', 'operator', 'supervisor', 'admin'];

// 🛑 PASTIKAN OBJEK 'H' ANDA LENGKAP DI SINI
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
    // 🛑 TAMBAHKAN 'Area' JIKA ADA DI SHEET ANDA
    Area: 'Area' 
};

/**** =========================
 * INISIALISASI (HANYA SEKALI)
 * ========================= ***/

try {
    if (admin.apps.length === 0) { // Cek apakah sudah di-init
        admin.initializeApp({
            credential: admin.credential.applicationDefault()
        });
        console.log("Firebase Admin SDK initialized successfully.");
    }
} catch (error) {
    console.error("Firebase Admin SDK initialization error:", error.message);
}

const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const app = express();
app.use(cors());
app.use(express.json());

/**** =========================
 * MIDDLEWARE (Filter Keamanan)
 * ========================= ***/

const authMiddleware = async (req, res, next) => {
    try {
        const token = getToken_(req);
        if (!token) {
            return res.status(401).json({ ok: false, error: 'NO_TOKEN' });
        }
        
        const decodedToken = await admin.auth().verifyIdToken(token);
        const email = decodedToken.email;
        if (!email) {
            return res.status(401).json({ ok: false, error: 'NO_EMAIL_IN_TOKEN' });
        }

        const role = await getUserRole_(email) || 'guest';
        
        const isWhitelisted = role !== 'guest';
        if (ENFORCE_WHITELIST && !isWhitelisted) {
             return res.status(403).json({ ok:false, error:'NOT_WHITELISTED', email });
        }

        req.email = email;
        req.role = role;
        next(); // Lanjut ke endpoint

    } catch (err) {
        console.error("Auth middleware error:", err.message);
        return res.status(401).json({ ok: false, error: 'INVALID_TOKEN', message: err.message });
    }
};

const checkRole = (minRole) => (req, res, next) => {
    if (!roleGte_(req.role, minRole)) {
        return res.status(403).json({ 
            ok: false, error: 'ROLE_FORBIDDEN', role: req.role, needed: minRole 
        });
    }
    next();
};

/**** =========================
 * ENDPOINTS (URL API Anda)
 * ========================= ***/

// Endpoint PUBLIK (untuk modal)
app.post('/checkUserExists', async (req, res) => {
    try {
        const { email, name } = req.body;
        if (!email) return res.json({ ok:false, error:'NO_EMAIL' });

        const data = await readObjects_(SHEET_USERS, `${SHEET_USERS}!A:C`);
        if (!data.length) return res.json({ ok:true, exists:false });

        const row = data.find(r => String(r.email || '').toLowerCase() === String(email).toLowerCase());
        if (!row) return res.json({ ok:true, exists:false, reason: 'EMAIL_NOT_FOUND' });

        if (name && row.username) {
            const actualName = String(row.username || '').trim();
            if (actualName.toLowerCase() !== name.toLowerCase()) {
                return res.json({ ok:true, exists:true, role: row.role ? String(row.role).toLowerCase() : null, reason: 'USERNAME_MISMATCH' });
            }
        }
        
        return res.json({ ok:true, exists:true, role: row.role ? String(row.role).toLowerCase() : null });
    } catch (err) {
        console.error("checkUserExists error:", err.message);
        res.status(500).json({ ok:false, error: err.message });
    }
});


// Endpoint AMAN (untuk login)
// 🛑 INI ADALAH PERBAIKANNYA 🛑
app.get('/whoami', authMiddleware, (req, res) => {
    // Jika lolos authMiddleware, kita sudah punya req.email dan req.role
    res.json({ 
        ok: true, 
        email: req.email, 
        role: req.role,
        allowed: req.role !== 'guest'
    });
});

// Endpoint AMAN (CRUD Data)
app.get('/losses', authMiddleware, checkRole('operator'), async (req, res) => {
    // (Logika GET /losses Anda)
});

app.post('/losses', authMiddleware, checkRole('operator'), async (req, res) => {
    // (Logika POST /losses Anda)
    // ...
    // const rows = items.map(it => {
    //   ...
    //   if (!o[H.id]) o[H.id] = crypto.randomUUID(); // Pastikan crypto di-require di atas
    //   ...
    // });
    // ...
});

app.put('/losses', authMiddleware, checkRole('supervisor'), async (req, res) => {
    // (Logika PUT /losses Anda)
});

app.delete('/losses', authMiddleware, checkRole('admin'), async (req, res) => {
    // (Logika DELETE /losses Anda)
});


/**** =========================
 * FUNGSI HELPER
 * ========================= ***/

function getToken_(req) {
    // 🛑 HANYA CARI DI HEADER
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] : null;
}

async function getUserRole_(email) {
    if (!email) return null;
    try {
        const data = await readObjects_(SHEET_USERS, `${SHEET_USERS}!A:C`);
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
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: rows,
        },
    });
}

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