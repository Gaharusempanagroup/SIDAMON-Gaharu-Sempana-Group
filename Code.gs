// --- Code.gs (Refactored & Optimized) ---

// --- KONFIGURASI UTAMA ---
const CONFIG = {
  MAIN_SS_ID: "1NYw4b9mSXoa_tYxo38mWZizQahq0wBee-9cU9oUk23o", // ID Spreadsheet Utama
  PROJECT_SS_ID: "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc", // ID Spreadsheet Project
  MAX_LOG_ENTRIES: 200,
  CACHE_DURATION: 600, // Cache data selama 10 menit (600 detik)
  CACHE_KEY: "DASHBOARD_FULL_DATA"
};

/**
 * Handle GET Requests
 */
function doGet(e) {
  // PENGAMAN: Jika dijalankan manual tanpa parameter (Run di editor)
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("Status: Server Running.\nInfo: Gunakan Deploy > Test Deploy untuk melihat hasil web, atau gunakan fungsi testDoGetManual() untuk testing backend.");
  }

  const action = e.parameter.action;

  try {
    switch (action) {
      case 'getAllData':
        // SATU REQUEST UNTUK SEMUA DATA (Sangat Cepat)
        return responseJSON(DataController.getAllData());
      case 'getSystemLogs':
        return responseJSON(LoggerService.getLogs());
      case 'clearCache':
        CacheService.getScriptCache().remove(CONFIG.CACHE_KEY);
        return responseJSON({ status: "Cache cleared" });
      case 'getDataSKK': // Fallback untuk kompatibilitas
        return responseJSON(DataController._fetchSKK(SpreadsheetApp.openById(CONFIG.MAIN_SS_ID)));
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
    const jsonString = e.postData.contents;
    const data = JSON.parse(jsonString);
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
        // Hapus cache agar data baru langsung muncul
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

// --- CONTROLLER: MANAJEMEN DATA (OPTIMIZED) ---
const DataController = {
  // Mengambil semua data sekaligus (SKK, Tugas, Project, Dropdown)
  getAllData: function() {
    // 1. Cek Cache (Memori Cepat)
    const cache = CacheService.getScriptCache();
    const cachedJSON = cache.get(CONFIG.CACHE_KEY);
    
    if (cachedJSON) {
      // Jika ada di cache, kembalikan langsung (Hemat waktu baca Spreadsheet)
      return JSON.parse(cachedJSON);
    }

    // 2. Jika tidak ada di cache, baca dari Spreadsheet
    const mainSS = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
    const projectSS = SpreadsheetApp.openById(CONFIG.PROJECT_SS_ID);

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
      console.log("Cache failed (data too large): " + e.toString());
    }

    return result;
  },

  saveData: function(data, passwordAuthHash) {
     const auth = AuthService.verify(passwordAuthHash);
     if (!auth.valid || (auth.role !== 'SUPER_ADMIN' && auth.role !== 'ADMIN_INPUT')) {
       return "Akses Ditolak / Password Salah.";
     }
     
     const lock = LockService.getScriptLock();
     try {
       lock.waitLock(10000); // Tunggu antrian max 10 detik
       
       const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
       const sheet = ss.getSheetByName("Dashboard SKK");
       if (!sheet) return "Error: Sheet 'Dashboard SKK' tidak ditemukan.";

       let targetRow;
       let actionType = "";
       
       if (data.rowNumber && data.rowNumber != "") {
         targetRow = parseInt(data.rowNumber);
         actionType = "EDIT DATA";
       } else {
         // Cari baris kosong pertama logic
         const lastRow = sheet.getLastRow();
         targetRow = lastRow + 1;
         const rangeB = sheet.getRange("B7:B" + (lastRow + 5)).getValues();
         for (let i = 0; i < rangeB.length; i++) {
           if (rangeB[i][0] === "" || rangeB[i][0] === null) {
             targetRow = i + 7;
             break;
           }
         }
         if (targetRow < 7) targetRow = 7;
         actionType = "TAMBAH DATA";
       }

       // Simpan Data
       sheet.getRange(targetRow, 2).setValue(data.nama);
       const rowData = [[
         data.perusahaan, data.sertifikat, data.jenjang, data.asosiasi, data.masaBerlaku 
       ]];
       sheet.getRange(targetRow, 5, 1, 5).setValues(rowData);
       sheet.getRange(targetRow, 12).setValue(data.keterangan);
       
       // Update Otomatis Nama Perusahaan di baris lain (Batch Update)
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
    
    // Ambil data Nama (Col B) dan Perusahaan (Col E) sekaligus
    const range = sheet.getRange(7, 2, lastRow - 6, 4); 
    const values = range.getValues(); // values[i][0] = Nama, values[i][3] = Perusahaan
    const cleanName = name.toString().toLowerCase().trim();
    const cleanComp = company.toString().trim();
    let isUpdated = false;

    for (let i = 0; i < values.length; i++) {
      const rowName = values[i][0] ? values[i][0].toString().toLowerCase().trim() : "";
      if (rowName === cleanName) {
         if (values[i][3] !== cleanComp) {
           values[i][3] = cleanComp;
           isUpdated = true;
         }
      }
    }
    
    if (isUpdated) {
      range.setValues(values);
    }
  },

  // --- INTERNAL FETCHERS ---
  _fetchSKK: function(ss) {
    const sheet = ss.getSheetByName("Dashboard SKK");
    const dbSheet = ss.getSheetByName("Database"); 
    if (!sheet || !dbSheet) return [];
    
    const data = sheet.getDataRange().getDisplayValues();
    const dbData = dbSheet.getDataRange().getValues();
    
    // Hash Map untuk lookup kontak (O(1))
    const contactMap = {};
    for (let j = 1; j < dbData.length; j++) {
      if (dbData[j][1]) contactMap[dbData[j][1]] = dbData[j][2];
    }

    if (data.length <= 6) return [];
    const result = [];
    for (let i = 6; i < data.length; i++) {
      if (data[i][1]) {
        if (contactMap[data[i][1]]) {
           data[i][2] = contactMap[data[i][1]];
        }
        data[i].push(i + 1); 
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

// --- AUTH SERVICE ---
const AuthService = {
  verify: function(inputHash) {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
      const sheet = ss.getSheetByName("Admin");
      const storedPasswords = sheet.getRange("A2:A5").getValues().flat();
      const input = (inputHash || "").toString().trim();

      const check = (idx) => storedPasswords[idx] && input === hashString(storedPasswords[idx]);

      let role = null;
      if (check(0)) role = "SUPER_ADMIN";
      else if (check(1)) role = "ADMIN";
      else if (check(2)) role = "TEKNIS";
      else if (check(3)) role = "ADMIN_INPUT";

      if (role) {
        LoggerService.log(role, "LOGIN", "Login berhasil");
        return { valid: true, role: role };
      }
      return { valid: false };
    } catch (e) { return { valid: false, error: e.toString() }; }
  }
};

// --- LOGGER SERVICE ---
const LoggerService = {
  log: function(role, action, details) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(5000); 
      const props = PropertiesService.getScriptProperties();
      let logs = JSON.parse(props.getProperty('SYSTEM_LOGS') || "[]");
      
      const now = new Date();
      const timeString = Utilities.formatDate(now, "Asia/Jakarta", "dd-MM-yyyy HH:mm:ss");
      
      logs.unshift({
        time: timeString,
        role: role || "UNKNOWN",
        action: action,
        details: details
      });

      if (logs.length > CONFIG.MAX_LOG_ENTRIES) {
        logs = logs.slice(0, CONFIG.MAX_LOG_ENTRIES);
      }
      props.setProperty('SYSTEM_LOGS', JSON.stringify(logs));
    } catch (e) {
      console.error("Log Error: " + e.toString());
    } finally {
      lock.releaseLock();
    }
  },

  getLogs: function() {
    const json = PropertiesService.getScriptProperties().getProperty('SYSTEM_LOGS');
    return json ? JSON.parse(json) : [];
  },

  clearLogs: function(startDateStr, endDateStr, passwordHashInput) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(5000);
      
      // Verifikasi Password Super Admin lagi
      const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
      const superAdminPass = ss.getSheetByName("Admin").getRange("A2").getValue();
      
      if (passwordHashInput.toString() !== hashString(superAdminPass)) {
        return { error: "Password Salah! Akses Ditolak." };
      }

      const props = PropertiesService.getScriptProperties();
      let logs = JSON.parse(props.getProperty('SYSTEM_LOGS') || "[]");
      const initialCount = logs.length;
      
      const start = new Date(startDateStr); start.setHours(0,0,0,0);
      const end = new Date(endDateStr); end.setHours(23,59,59,999);

      const newLogs = logs.filter(function(log) {
        const parts = log.time.split(' '); 
        const dParts = parts[0].split('-'); 
        const tParts = parts[1].split(':'); 
        const logDate = new Date(dParts[2], dParts[1] - 1, dParts[0], tParts[0], tParts[1], tParts[2]);
        return (logDate < start || logDate > end);
      });
      
      props.setProperty('SYSTEM_LOGS', JSON.stringify(newLogs));
      const deletedCount = initialCount - newLogs.length;
      
      this.log("SUPER_ADMIN", "HAPUS LOG", `Menghapus ${deletedCount} data`);
      return { status: "Sukses", count: deletedCount };

    } catch (e) {
      return { error: "Gagal: " + e.toString() };
    } finally {
      lock.releaseLock();
    }
  }
};

// --- HELPER: HASHING ---
function hashString(str) {
  if (!str) return "";
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str.toString());
  let txtHash = '';
  for (let i = 0; i < rawHash.length; i++) {
    let hashVal = rawHash[i];
    if (hashVal < 0) hashVal += 256;
    if (hashVal.toString(16).length == 1) txtHash += '0';
    txtHash += hashVal.toString(16);
  }
  return txtHash;
}

// --- FUNGSI TEST MANUAL (Jalankan ini di Editor untuk cek Backend) ---
function testDoGetManual() {
  console.log("Test: Simulasi getAllData...");
  const e = { parameter: { action: 'getAllData' } };
  const result = doGet(e);
  console.log("Result: " + result.getContent().substring(0, 200) + "...");
}
