// 

// --- KONFIGURASI ---
const CONFIG = {
  MAIN_SS_ID: "1NYw4b9mSXoa_tYxo38mWZizQahq0wBee-9cU9oUk23o",
  PROJECT_SS_ID: "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc",
  MAX_LOG_ENTRIES: 200,
  CACHE_DURATION: 600, // Cache data selama 10 menit (600 detik)
  CACHE_KEY: "DASHBOARD_FULL_DATA"
};

/**
 * Handle GET Requests
 * Menggunakan routing yang lebih bersih
 */
function doGet(e) {
  const action = e.parameter.action;
  
  // Security Header & CORS handling could be added here if needed
  
  try {
    switch (action) {
      case 'getAllData':
        return responseJSON(DataController.getAllData()); // API GABUNGAN (Cepat)
      case 'getSystemLogs':
        return responseJSON(LoggerService.getLogs());
      case 'clearCache': // Fitur maintenance
        CacheService.getScriptCache().remove(CONFIG.CACHE_KEY);
        return responseJSON({ status: "Cache cleared" });
      default:
        return responseJSON({ error: "Action not defined" });
    }
  } catch (err) {
    return responseJSON({ error: err.toString() });
  }
}

/**
 * Handle POST Requests
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    let result = {};

    switch (action) {
      case 'login':
        result = AuthService.verify(data.password);
        break;
      case 'logout':
        LoggerService.log(data.role, "LOGOUT", "User logged out");
        result = { status: "Success" };
        break;
      case 'saveData':
        result = DataController.saveData(data.payload, data.password);
        // INVALIDATE CACHE setelah simpan data agar user lain dapat data terbaru
        CacheService.getScriptCache().remove(CONFIG.CACHE_KEY); 
        break;
      case 'clearLogs':
        result = LoggerService.clearLogs(data.startDate, data.endDate, data.password);
        break;
      default:
        result = { error: "Action not defined" };
    }
    return responseJSON(result);

  } catch (err) {
    return responseJSON({ error: "Gagal memproses data: " + err.toString() });
  }
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- CONTROLLER: MANAJEMEN DATA ---
const DataController = {
  // Fungsi Utama: Mengambil SEMUA data dalam 1 koneksi
  getAllData: function() {
    // 1. Cek Cache dulu (Sangat Cepat)
    const cache = CacheService.getScriptCache();
    const cachedData = cache.get(CONFIG.CACHE_KEY);
    
    if (cachedData) {
      return JSON.parse(cachedData);
    }

    // 2. Jika tidak ada di cache, ambil dari Spreadsheet (Lambat, tapi hanya sekali)
    const mainSS = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
    const projectSS = SpreadsheetApp.openById(CONFIG.PROJECT_SS_ID);

    // Fetch parallel logic (conceptual in GAS)
    const result = {
      skk: this._fetchSKK(mainSS),
      penugasan: this._fetchPenugasan(mainSS),
      project: this._fetchProject(projectSS),
      dropdown: this._fetchDropdown(mainSS)
    };

    // 3. Simpan ke Cache
    try {
      cache.put(CONFIG.CACHE_KEY, JSON.stringify(result), CONFIG.CACHE_DURATION);
    } catch(e) {
      // Abaikan jika data terlalu besar untuk cache (limit 100KB per key)
      // Jika data sangat besar, perlu strategi kompresi atau split cache key
      console.error("Cache limit exceeded");
    }

    return result;
  },

  saveData: function(data, passwordAuthHash) {
     // Validasi Role ulang sebelum write
     const auth = AuthService.verify(passwordAuthHash);
     if (!auth.valid || (auth.role !== 'SUPER_ADMIN' && auth.role !== 'ADMIN_INPUT')) {
       return "Akses Ditolak / Password Salah.";
     }
     
     // Gunakan LockService untuk mencegah race condition saat multiple user input bersamaan
     const lock = LockService.getScriptLock();
     try {
       lock.waitLock(10000); // Tunggu antrian maksimal 10 detik
       
       const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
       const sheet = ss.getSheetByName("Dashboard SKK");
       if (!sheet) return "Error: Sheet tidak ditemukan";

       // Logic Penentuan Baris (Sama seperti kode lama, tapi dirapikan)
       let targetRow = -1;
       let actionType = "TAMBAH DATA";
       
       if (data.rowNumber) {
         targetRow = parseInt(data.rowNumber);
         actionType = "EDIT DATA";
       } else {
         targetRow = sheet.getLastRow() + 1;
         // Logic cari baris kosong di tengah bisa ditambahkan di sini jika perlu
       }

       // Array Mapping untuk performa write (setValues lebih cepat dari setValue berulang)
       // Mapping kolom sesuai struktur sheet Anda:
       // Kolom B(2)=Nama, E(5)=Perusahaan, F(6)=Sertifikat, G(7)=Jenjang, H(8)=Asosiasi, I(9)=MasaBerlaku, L(12)=Ket
       
       sheet.getRange(targetRow, 2).setValue(data.nama);
       sheet.getRange(targetRow, 5, 1, 5).setValues([[
         data.perusahaan, data.sertifikat, data.jenjang, data.asosiasi, data.masaBerlaku
       ]]);
       sheet.getRange(targetRow, 12).setValue(data.keterangan);

       // Update Batch Perusahaan (Logic sinkronisasi nama)
       this._syncCompanyNames(sheet, data.nama, data.perusahaan);

       SpreadsheetApp.flush();
       LoggerService.log(auth.role, actionType, `${data.nama} - ${data.sertifikat}`);
       
       return "Sukses";
     } catch (e) {
       return "Gagal Sistem: " + e.toString();
     } finally {
       lock.releaseLock();
     }
  },

  _syncCompanyNames: function(sheet, name, company) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 7) return;
    
    // Ambil data sekaligus ke memori
    const range = sheet.getRange(7, 2, lastRow - 6, 4); // Ambil kolom B s/d E
    const values = range.getValues();
    const cleanName = name.toLowerCase().trim();
    let isUpdated = false;

    // Modifikasi array di memori
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] && values[i][0].toString().toLowerCase().trim() === cleanName) {
        if (values[i][3] !== company) { // Index 3 adalah kolom E (Perusahaan) relatif terhadap range B:E
          values[i][3] = company;
          isUpdated = true;
        }
      }
    }

    // Tulis balik HANYA jika ada perubahan (Hemat Write Operation)
    if (isUpdated) {
      range.setValues(values);
    }
  },

  // --- INTERNAL HELPER FETCHERS ---
  
  _fetchSKK: function(ss) {
    const sheet = ss.getSheetByName("Dashboard SKK");
    const dbSheet = ss.getSheetByName("Database");
    if (!sheet || !dbSheet) return [];

    const data = sheet.getDataRange().getDisplayValues(); // Gunakan DisplayValues untuk format tanggal otomatis
    const dbData = dbSheet.getDataRange().getValues();
    
    // Optimasi Lookup Contact (O(N) Hash Map)
    const contactMap = {};
    for (let j = 1; j < dbData.length; j++) {
      if (dbData[j][1]) contactMap[dbData[j][1]] = dbData[j][2];
    }

    const result = [];
    // Loop optimized
    for (let i = 6; i < data.length; i++) {
      if (data[i][1]) {
        // Inject Contact info directly
        data[i][2] = contactMap[data[i][1]] || ""; 
        data[i].push(i + 1); // Simpan index baris (1-based) di elemen terakhir
        result.push(data[i]);
      }
    }
    return result;
  },

  _fetchPenugasan: function(ss) {
    const sheet = ss.getSheetByName("Dashboard Waktu Penugasan");
    if (!sheet) return [];
    const data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 6) return [];
    return data.slice(6).filter(r => r[1]);
  },

  _fetchProject: function(ss) {
    const sheet = ss.getSheetByName("Project");
    if (!sheet) return [];
    const data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 7) return [];
    return data.slice(7).filter(r => r[2]);
  },
  
  _fetchDropdown: function(ss) {
    const dbSheet = ss.getSheetByName("Database");
    if (!dbSheet) return {};
    const data = dbSheet.getDataRange().getValues();
    
    // Set digunakan untuk Unique Values (Otomatis hapus duplikat)
    const sets = { nama: new Set(), perusahaan: new Set(), sertifikat: new Set(), jenjang: new Set() };
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1]) sets.nama.add(data[i][1]);
      if (data[i][11]) sets.perusahaan.add(data[i][11]);
      if (data[i][5]) sets.sertifikat.add(data[i][5]);
      if (data[i][7]) sets.jenjang.add(data[i][7]);
    }

    return {
      nama: [...sets.nama].sort(),
      perusahaan: [...sets.perusahaan].sort(),
      sertifikat: [...sets.sertifikat].sort(),
      jenjang: [...sets.jenjang].sort()
    };
  }
};

// --- SERVICE: AUTHENTICATION ---
const AuthService = {
  verify: function(inputHash) {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
      const sheet = ss.getSheetByName("Admin");
      const stored = sheet.getRange("A2:A5").getValues().flat();
      
      const input = (inputHash || "").toString().trim();
      
      // Helper Check Hash
      const check = (idx) => stored[idx] && input === hashString(stored[idx]);

      if (check(0)) return { valid: true, role: "SUPER_ADMIN" };
      if (check(1)) return { valid: true, role: "ADMIN" };
      if (check(2)) return { valid: true, role: "TEKNIS" };
      if (check(3)) return { valid: true, role: "ADMIN_INPUT" };

      return { valid: false };
    } catch (e) { return { valid: false, error: e.toString() }; }
  }
};

// --- SERVICE: LOGGING ---
const LoggerService = {
  log: function(role, action, details) {
    // ... (Logika sama dengan kode lama, hanya dibungkus objek) ...
    // Gunakan PropertiesService seperti kode asli Anda
    // ...
    // Code singkat untuk implementasi:
    try {
      const props = PropertiesService.getScriptProperties();
      let logs = JSON.parse(props.getProperty('SYSTEM_LOGS') || "[]");
      const now = Utilities.formatDate(new Date(), "Asia/Jakarta", "dd-MM-yyyy HH:mm:ss");
      logs.unshift({ time: now, role: role || "UNKNOWN", action: action, details: details });
      if (logs.length > CONFIG.MAX_LOG_ENTRIES) logs = logs.slice(0, CONFIG.MAX_LOG_ENTRIES);
      props.setProperty('SYSTEM_LOGS', JSON.stringify(logs));
    } catch(e) { console.error(e); }
  },
  
  getLogs: function() {
    const json = PropertiesService.getScriptProperties().getProperty('SYSTEM_LOGS');
    return json ? JSON.parse(json) : [];
  },

  clearLogs: function(startDate, endDate, password) {
      // Implementasi validasi password super admin dan filter tanggal
      // (Sama dengan logika kode asli Anda, hanya dipindah ke sini)
      return { status: "Sukses", count: 0 }; // Placeholder, copy logika asli
  }
};

// --- UTILS ---
function hashString(str) {
  // ... (Gunakan fungsi hashString asli Anda) ...
  if (!str) return "";
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str.toString());
  var txtHash = '';
  for (var i = 0; i < rawHash.length; i++) {
    var hashVal = rawHash[i];
    if (hashVal < 0) hashVal += 256;
    if (hashVal.toString(16).length == 1) txtHash += '0';
    txtHash += hashVal.toString(16);
  }
  return txtHash;
}
