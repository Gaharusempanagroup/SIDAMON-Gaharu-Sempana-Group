// --- KONFIGURASI UTAMA ---
const CONFIG = {
  MAIN_SS_ID: "16nhWxRDw4wa7GfKc0E1jIn5nM0SVo8UbgqFW0phH60w",
  PROJECT_SS_ID: "1VepG8eqhqscffUOxlYD5p9oGNgkHUPgjgpSB8aVjAuw",
  MAX_LOGS: 200,
  CACHE_EXP: 300 // Detik (5 menit)
};

/**
 * Endpoint Utama GET
 */
function doGet(e) {
  if (!e || !e.parameter) return ContentService.createTextOutput("Error: Gunakan Deploy > Test Deploy.");
  
  const action = e.parameter.action;
  let result = {};

  try {
    switch(action) {
      case 'getDataSKK': result = { status: "success", data: fetchSheetDataCached("SKK") }; break;
      case 'getDataPenugasan': result = { status: "success", data: fetchSheetDataCached("TUGAS") }; break;
      case 'getDataProject': result = { status: "success", data: fetchSheetDataCached("PROJECT") }; break;
      case 'getDropdownData': result = { status: "success", data: getDropdownData() }; break;
      case 'getSystemLogs': result = { status: "success", data: getSystemLogs() }; break;
      default: throw new Error("Action not defined");
    }
  } catch (err) {
    result = { status: "error", message: err.message };
  }

  return responseJSON(result);
}

/**
 * Endpoint Utama POST
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result = {};

    switch(action) {
      case 'login': result = verifyPassword(data.password); break;
      case 'logout': 
        logUserActivity(data.role, "LOGOUT", "User logged out"); 
        result = { status: "success" }; 
        break;
      case 'saveData': result = processForm(data.payload, data.password); break;
      case 'clearLogs': result = clearLogData(data.startDate, data.endDate, data.password); break;
      default: throw new Error("Action not defined");
    }
    return responseJSON(result);
  } catch (err) {
    return responseJSON({ status: "error", message: err.message });
  }
}

// --- HELPER FUNCTIONS ---
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function hashString(str) {
  if (!str) return "";
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str));
  return rawHash.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

// --- DATA FETCHING DENGAN CACHE ---
function fetchSheetDataCached(type) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `DATA_${type}`;
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) return JSON.parse(cachedData);

  let data = [];
  switch(type) {
    case "SKK":
      const ssMain = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
      const dataSKK = ssMain.getSheetByName("Dashboard SKK").getDataRange().getDisplayValues();
      const dbData = ssMain.getSheetByName("Database").getDataRange().getValues();
      
      const contactMap = dbData.slice(1).reduce((acc, row) => {
        if(row[1]) acc[row[1]] = row[2];
        return acc;
      }, {});

      data = dataSKK.slice(6).filter(r => r[1]).map((row, i) => {
        if (contactMap[row[1]]) row[2] = contactMap[row[1]];
        row.push(i + 7); // Row number injection
        return row;
      });
      break;

    case "TUGAS":
      const sheetTugas = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID).getSheetByName("Dashboard Waktu Penugasan");
      if (!sheetTugas) throw new Error("Sheet Waktu Penugasan hilang");
      data = sheetTugas.getDataRange().getDisplayValues().slice(6).filter(r => r[1]);
      break;

    case "PROJECT":
      const sheetProject = SpreadsheetApp.openById(CONFIG.PROJECT_SS_ID).getSheetByName("Project");
      if (!sheetProject) throw new Error("Sheet Project hilang");
      // Filter menggunakan r[2] sesuai kode asal yang valid
      data = sheetProject.getDataRange().getDisplayValues().slice(7).filter(r => r[2] && r[2].trim() !== "");
      break;
  }

  // Set cache
  if (data.length > 0) {
      try {
          cache.put(cacheKey, JSON.stringify(data), CONFIG.CACHE_EXP);
      } catch (e) {
          // Abaikan jika payload melebihi batas 100KB CacheService
      }
  }
  return data;
}

function clearCache() {
  CacheService.getScriptCache().removeAll(['DATA_SKK', 'DATA_TUGAS', 'DATA_PROJECT']);
}

// --- AUTHENTICATION & LOGIC ---
function verifyPassword(inputHash) {
  const sheet = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID).getSheetByName("Admin");
  if (!sheet) throw new Error("Sheet Admin hilang");
  
  const storedPasswords = sheet.getRange("A2:A5").getValues().flat();
  const input = String(inputHash).trim();
  
  const roles = ["SUPER_ADMIN", "ADMIN", "TEKNIS", "ADMIN_INPUT"];
  for (let i = 0; i < roles.length; i++) {
    if (storedPasswords[i] && input === hashString(storedPasswords[i])) {
      logUserActivity(roles[i], "LOGIN", "Login berhasil");
      return { status: "success", role: roles[i], valid: true };
    }
  }
  return { status: "error", message: "Password Salah", valid: false };
}

function getDropdownData() {
  const dbSheet = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID).getSheetByName("Database");
  if (!dbSheet) throw new Error("Sheet 'Database' tidak ditemukan!");

  const data = dbSheet.getDataRange().getValues().slice(1);
  const extractUnique = (colIdx) => [...new Set(data.map(r => r[colIdx]).filter(Boolean))].sort();

  return {
    nama: extractUnique(1),
    perusahaan: extractUnique(11),
    sertifikat: extractUnique(5),
    jenjang: extractUnique(7)
  };
}

function processForm(data, passwordAuthHash) {
  const ss = SpreadsheetApp.openById(CONFIG.MAIN_SS_ID);
  const passwords = ss.getSheetByName("Admin").getRange("A2:A5").getValues().flat();
  const inputHash = String(passwordAuthHash);
  
  let currentRole = "";
  if (inputHash === hashString(passwords[0])) currentRole = "SUPER_ADMIN";
  else if (inputHash === hashString(passwords[3])) currentRole = "ADMIN_INPUT";
  else return { status: "error", message: "Akses Ditolak. Role invalid." };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { status: "error", message: "Server sibuk, coba lagi." };

  try {
    const sheet = ss.getSheetByName("Dashboard SKK");
    if (!sheet) throw new Error("Sheet 'Dashboard SKK' tidak ditemukan.");

    let targetRow = parseInt(data.rowNumber);
    let actionType = targetRow && targetRow >= 7 ? "EDIT DATA" : "TAMBAH DATA";

    if (!targetRow || targetRow < 7) {
      const rangeB = sheet.getRange("B7:B" + (sheet.getLastRow() + 5)).getValues();
      targetRow = rangeB.findIndex(r => !r[0]) + 7;
      if (targetRow < 7) targetRow = sheet.getLastRow() + 1;
    }

    // 1. Validasi Keamanan Input & Sanitize
    const safeKeterangan = String(data.keterangan || "").replace(/<[^>]+>/g, '');

    // 2. Simpan Data
    sheet.getRange(targetRow, 2).setValue(data.nama);
    sheet.getRange(targetRow, 5, 1, 5).setValues([[data.perusahaan, data.sertifikat, data.jenjang, data.asosiasi, data.masaBerlaku]]);
    sheet.getRange(targetRow, 12).setValue(safeKeterangan);
    
    // 3. Update Batch Perusahaan
    const lastRowData = sheet.getLastRow();
    if (lastRowData >= 7) {
      const rangeNames = sheet.getRange(7, 2, lastRowData - 6, 1).getValues();
      const rangeComps = sheet.getRange(7, 5, lastRowData - 6, 1);
      const currentComps = rangeComps.getValues();
      let isUpdated = false;

      const inputNameClean = String(data.nama).toLowerCase().trim();
      const inputCompClean = String(data.perusahaan).trim();

      rangeNames.forEach((row, idx) => {
        if ((row[0] || "").toString().toLowerCase().trim() === inputNameClean) {
          if (currentComps[idx][0] !== inputCompClean) {
            currentComps[idx][0] = inputCompClean;
            isUpdated = true;
          }
        }
      });
      if (isUpdated) rangeComps.setValues(currentComps);
    }

    SpreadsheetApp.flush();
    clearCache(); // Invalidate cache setelah ada perubahan data
    logUserActivity(currentRole, actionType, `${data.nama} - ${data.sertifikat}`);

    return { status: "success", message: "Data berhasil disimpan" };
  } catch (e) {
    return { status: "error", message: e.message };
  } finally {
    lock.releaseLock();
  }
}

// LOG SYSTEM (Persisted on PropertyService)
function logUserActivity(role, action, details) {
  try {
    const props = PropertiesService.getScriptProperties();
    let logs = JSON.parse(props.getProperty('SYSTEM_LOGS') || "[]");
    
    logs.unshift({
      time: Utilities.formatDate(new Date(), "Asia/Jakarta", "dd-MM-yyyy HH:mm:ss"),
      role: role || "UNKNOWN", action: action, details: details
    });

    if (logs.length > CONFIG.MAX_LOGS) logs = logs.slice(0, CONFIG.MAX_LOGS);
    props.setProperty('SYSTEM_LOGS', JSON.stringify(logs));
  } catch (e) { console.error("Logging failed: " + e.message); }
}

function getSystemLogs() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('SYSTEM_LOGS') || "[]");
}

function clearLogData(startStr, endStr, passHash) {
   // Implementation clear log sama seperti sebelumnya, pastikan me-return JSON object
   // { status: "success", count: deletedCount }
}
