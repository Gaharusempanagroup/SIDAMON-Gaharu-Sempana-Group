// --- Code.gs (Optimized: Single-Fetch, Caching & Modular Security) ---

// 1. KONFIGURASI UTAMA
const CONFIG = {
  MAIN_SS_ID: "1NYw4b9mSXoa_tYxo38mWZizQahq0wBee-9cU9oUk23o",      // ID Spreadsheet Utama
  PROJECT_SS_ID: "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc",   // ID Spreadsheet Project
  MAX_LOG_ENTRIES: 200,     // Batas Log FIFO
  CACHE_DURATION: 600,      // Durasi Cache (detik) = 10 Menit
  CACHE_KEY: "DASHBOARD_FULL_DATA_V1"
};

/**
 * Handle GET Requests
 * Menggunakan Single Entry Point untuk mengurangi latency.
 */
function doGet(e) {
  if (!e || !e.parameter) return responseJSON({ error: "Invalid Request" });
  
  const action = e.parameter.action;
  
  try {
    if (action === 'getAllDashboardData') {
      // HANYA INI yang dipanggil saat loading awal
      return responseJSON(DataService.getAllData());
    } 
    else if (action === 'getSystemLogs') {
      return responseJSON(LogService.getLogs());
    }
    else {
      return responseJSON({ error: "Action Unknown" });
    }
  } catch (err) {
    return responseJSON({ error: "Server Error: " + err.toString() });
  }
}

/**
 * Handle POST Requests
 * Validasi ketat untuk operasi tulis (Write Operations).
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // 1. Login (Public Action)
    if (action === 'login') {
      return responseJSON(AuthService.verify(data.password));
    }

    // 2. Secured Actions (Wajib Validasi Password Ulang)
    if (!data.password) return responseJSON({ error: "Unauthorized: No Credentials" });
    
    // Verifikasi Auth sebelum melakukan perubahan data
    const auth = AuthService.verify(data.password);
    if (!auth.valid) return responseJSON({ error: "Unauthorized: Invalid Password" });

    if (action === 'logout') {
      LogService.add(data.role, "LOGOUT", "User logged out");
      return responseJSON({ status: "Success" });
    }
    else if (action === 'saveData') {
      // Cek Role Level
      if (auth.role !== 'SUPER_ADMIN' && auth.role !== 'ADMIN_INPUT') {
         return responseJSON({ error: "Akses Ditolak: Role tidak diizinkan." });
      }
      return responseJSON(DataService.saveData(data.payload, auth.role));
    }
    else if (action === 'clearLogs') {
      if (auth.role !== 'SUPER_ADMIN') return responseJSON({ error: "Akses Ditolak: Hanya Super Admin." });
      return responseJSON(LogService.clear(data.startDate, data.endDate));
    }

    return responseJSON({ error: "Action Not Defined" });

  } catch (err) {
    return responseJSON({ error: "Processing Error: " + err.toString() });
  }
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// MODULE 1: AUTHENTICATION SERVICE
// ==========================================
const AuthService = {
  // Hash String (SHA-256) agar sesuai dengan Client Side
  hashString: function(str) {
    if (!str) return "";
    const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str.toString());
    return rawHash.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  },

  // Verifikasi Password Hash dengan Database Excel
  verify: function(inputHash) {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
      const sheet = ss.getSheetByName("Admin");
      if (!sheet) return { valid: false, message: "Sheet Admin Missing" };

      // Urutan di Sheet Admin A2:A5 -> [0]Super, [1]Admin, [2]Teknis, [3]Input
      const storedPasswords = sheet.getRange("A2:A5").getValues().flat();
      const input = inputHash.toString().trim();
      const roles = ["SUPER_ADMIN", "ADMIN", "TEKNIS", "ADMIN_INPUT"];
      
      for (let i = 0; i < roles.length; i++) {
        if (storedPasswords[i] && input === this.hashString(storedPasswords[i])) {
          if (roles[i]) LogService.add(roles[i], "LOGIN", "Login berhasil");
          return { valid: true, role: roles[i] };
        }
      }
      return { valid: false, message: "Password Salah" };
    } catch (e) {
      return { valid: false, error: e.toString() };
    }
  }
};

// ==========================================
// MODULE 2: DATA SERVICE (Core Logic)
// ==========================================
const DataService = {
  
  /**
   * MENGAMBIL SEMUA DATA DALAM 1 REQUEST (Optimized)
   * Menggunakan CacheService untuk respons instan.
   */
  getAllData: function() {
    // A. Cek Cache (Memori Server)
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(CONFIG.CACHE_KEY);
    
    if (cachedData) {
      // Jika ada di cache, kembalikan langsung (Hemat waktu baca spreadsheet)
      return JSON.parse(cachedData);
    }

    // B. Jika Cache Kosong, Baca Spreadsheet
    const ssMain = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
    const ssProject = SpreadsheetApp.openById(CONFIG.PROJECT_SS_ID);

    const sheetSKK = ssMain.getSheetByName("Dashboard SKK");
    const sheetDb = ssMain.getSheetByName("Database");
    const sheetTugas = ssMain.getSheetByName("Dashboard Waktu Penugasan");
    const sheetProject = ssProject.getSheetByName("Project");

    // Helper function untuk ambil data aman
    const getVals = (sheet, startRow) => {
       if(!sheet) return [];
       const lastRow = sheet.getLastRow();
       if(lastRow < startRow) return [];
       return sheet.getRange(startRow, 1, lastRow - (startRow - 1), sheet.getLastColumn()).getDisplayValues();
    };

    // 1. Proses Database (Kontak & Dropdowns)
    const rawDb = getVals(sheetDb, 2);
    const contactMap = {}; 
    const dropdowns = { nama: [], perusahaan: [], sertifikat: [], jenjang: [] };
    
    rawDb.forEach(row => {
      const name = row[1];
      if(name) {
        contactMap[name] = row[2]; // Map Nama -> WA (O(1) Access)
        dropdowns.nama.push(name);
        if(row[11]) dropdowns.perusahaan.push(row[11]);
        if(row[5]) dropdowns.sertifikat.push(row[5]);
        if(row[7]) dropdowns.jenjang.push(row[7]);
      }
    });

    // 2. Proses SKK (Gabungkan dengan Kontak)
    const rawSKK = getVals(sheetSKK, 7);
    const cleanSKK = rawSKK
      .filter(r => r[1]) 
      .map((r, idx) => {
        if(contactMap[r[1]]) r[2] = contactMap[r[1]]; // Inject WA
        r.push(idx + 7); // Simpan Row ID Asli
        return r;
      });

    // 3. Proses Data Lain
    const cleanTugas = getVals(sheetTugas, 7).filter(r => r[1]);
    const cleanProject = getVals(sheetProject, 8).filter(r => r[2]); 

    // 4. Finalisasi Dropdown (Unique & Sort)
    const finalDropdowns = {};
    Object.keys(dropdowns).forEach(k => {
      finalDropdowns[k] = [...new Set(dropdowns[k])].sort();
    });

    const result = {
      skk: cleanSKK,
      tugas: cleanTugas,
      project: cleanProject,
      dropdowns: finalDropdowns
    };

    // C. Simpan ke Cache (Agar request user berikutnya instan)
    try {
      cache.put(CONFIG.CACHE_KEY, JSON.stringify(result), CONFIG.CACHE_DURATION);
    } catch(e) {
      console.log("Cache failed (Data too big): " + e.toString());
    }

    return result;
  },

  /**
   * MENYIMPAN DATA (Atomic Transaction)
   */
  saveData: function(data, role) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000); // Wait max 10 detik
      
      const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
      const sheet = ss.getSheetByName("Dashboard SKK");
      
      // Hapus Cache agar data baru segera muncul
      CacheService.getScriptCache().remove(CONFIG.CACHE_KEY);

      let targetRow;
      let actionType = "TAMBAH DATA";

      // Tentukan Baris (Edit atau Baru)
      if (data.rowNumber && data.rowNumber != "") {
        targetRow = parseInt(data.rowNumber);
        actionType = "EDIT DATA";
      } else {
        // Logika cari baris kosong sederhana & efisien
        targetRow = sheet.getLastRow() + 1;
        if (targetRow < 7) targetRow = 7;
      }

      // Tulis Data (Batch Write)
      sheet.getRange(targetRow, 2).setValue(data.nama);
      const rowValues = [[
        data.perusahaan, 
        data.sertifikat, 
        data.jenjang, 
        data.asosiasi, 
        data.masaBerlaku
      ]];
      sheet.getRange(targetRow, 5, 1, 5).setValues(rowValues);
      sheet.getRange(targetRow, 12).setValue(data.keterangan);

      // --- SINKRONISASI PERUSAHAAN (Batch Update) ---
      // Jika nama personil diupdate perusahaannya, semua entry nama tsb ikut berubah
      const lastRow = sheet.getLastRow();
      if (lastRow >= 7) {
        const rangeNames = sheet.getRange(7, 2, lastRow - 6, 1);
        const rangeComps = sheet.getRange(7, 5, lastRow - 6, 1);
        
        const names = rangeNames.getValues().flat();
        const comps = rangeComps.getValues();
        let updated = false;
        
        const searchName = data.nama.toLowerCase().trim();
        const newComp = data.perusahaan;

        for(let i=0; i<names.length; i++) {
           if(names[i] && names[i].toString().toLowerCase().trim() === searchName) {
             if(comps[i][0] !== newComp) {
               comps[i][0] = newComp;
               updated = true;
             }
           }
        }
        if(updated) rangeComps.setValues(comps);
      }

      LogService.add(role, actionType, `${data.nama} - ${data.sertifikat}`);
      return "Sukses";

    } catch (e) {
      return "Gagal: " + e.toString();
    } finally {
      lock.releaseLock();
    }
  }
};

// ==========================================
// MODULE 3: LOGGING SERVICE (FIFO System)
// ==========================================
const LogService = {
  add: function(role, action, details) {
    try {
      const props = PropertiesService.getScriptProperties();
      let logs = this.getLogs();
      const now = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd-MM-yyyy HH:mm:ss");
      
      // Tambah log baru di awal array
      logs.unshift({ time: now, role: role, action: action, details: details });
      
      // Jaga agar log tidak melebihi batas (Hemat memori)
      if (logs.length > CONFIG.MAX_LOG_ENTRIES) logs = logs.slice(0, CONFIG.MAX_LOG_ENTRIES);
      
      props.setProperty('SYSTEM_LOGS', JSON.stringify(logs));
    } catch (e) { console.error("Log Error", e); }
  },

  getLogs: function() {
    try {
      const json = PropertiesService.getScriptProperties().getProperty('SYSTEM_LOGS');
      return json ? JSON.parse(json) : [];
    } catch (e) { return []; }
  },

  clear: function(startStr, endStr) {
     const props = PropertiesService.getScriptProperties();
     let logs = this.getLogs();
     const initialCount = logs.length;
     const start = new Date(startStr); start.setHours(0,0,0,0);
     const end = new Date(endStr); end.setHours(23,59,59,999);
     
     const newLogs = logs.filter(log => {
        const parts = log.time.split(' '); // dd-MM-yyyy HH:mm:ss
        const d = parts[0].split('-');
        const t = parts[1].split(':');
        const logDate = new Date(d[2], d[1]-1, d[0], t[0], t[1], t[2]);
        return (logDate < start || logDate > end); // Keep if OUTSIDE range
     });
     
     props.setProperty('SYSTEM_LOGS', JSON.stringify(newLogs));
     return { status: "Sukses", count: initialCount - newLogs.length };
  }
};
