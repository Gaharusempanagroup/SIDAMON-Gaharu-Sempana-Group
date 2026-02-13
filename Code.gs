// --- Code.gs (Logic Centralized - No Formulas in Sheet) ---

// 1. MASUKKAN ID SPREADSHEET UTAMA
const MAIN_SS_ID = "1NYw4b9mSXoa_tYxo38mWZizQahq0wBee-9cU9oUk23o"; 

// 2. ID Spreadsheet Project
const PROJECT_SS_ID = "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc"; 

// --- KONFIGURASI LOG ---
const MAX_LOG_ENTRIES = 200; 

/**
 * Handle GET Requests
 */
function doGet(e) {
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("Error: Gunakan Deploy > Test Deploy.");
  }

  var action = e.parameter.action;
  var result = {};

  if (action === 'getDataSKK') {
    result = getDataSKK();
  } else if (action === 'getDataPenugasan') {
    result = getDataPenugasan();
  } else if (action === 'getDataProject') {
    result = getDataProject();
  } else if (action === 'getDropdownData') {
    result = getDropdownData();
  } else if (action === 'getSystemLogs') {
    result = getSystemLogs();
  } else {
    result = { error: "Action not defined" };
  }

  return responseJSON(result);
}

/**
 * Handle POST Requests
 */
function doPost(e) {
  try {
    var jsonString = e.postData.contents;
    var data = JSON.parse(jsonString);
    var action = data.action;
    var result = {};

    if (action === 'login') {
      result = verifyPassword(data.password);
    } 
    else if (action === 'logout') {
      logUserActivity(data.role, "LOGOUT", "User logged out");
      result = { status: "Success" };
    }
    else if (action === 'saveData') {
      result = processForm(data.payload, data.password);
    } 
    else if (action === 'clearLogs') {
      result = clearLogData(data.startDate, data.endDate, data.password);
    }
    else {
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

// --- UTILS: DATE & CALCULATIONS ---

function normalizeDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return dateVal;
  // Handle string formats manually if needed, generally Sheet returns Date object
  return new Date(dateVal);
}

function diffDays(targetDate) {
  if (!targetDate) return 0;
  const today = new Date();
  today.setHours(0,0,0,0);
  const target = new Date(targetDate);
  target.setHours(0,0,0,0);
  const diffTime = target - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
}

function formatDateID(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return "-";
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
  return dateObj.getDate() + " " + months[dateObj.getMonth()] + " " + dateObj.getFullYear();
}

// --- DATA FETCHING & BUSINESS LOGIC (PENGGANTI RUMUS SHEET) ---

function getDataPenugasan() {
  try {
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheet = ss.getSheetByName("Dashboard Waktu Penugasan");
    if (!sheet) return [];
    
    // Ambil semua data mentah (termasuk baris kosong/header)
    var data = sheet.getDataRange().getValues();
    if (data.length <= 6) return []; // Header diasumsikan sampai baris 6

    var today = new Date();
    today.setHours(0,0,0,0);
    var result = [];

    // Loop data mulai baris 7 (index 6)
    for (var i = 6; i < data.length; i++) {
      var row = data[i];
      if (!row[1]) continue; // Skip jika nama kosong

      // --- LOGIC: Hitung End Date & Status ---
      // Mapping Index:
      // 8: Durasi (Hari)
      // 9: Start Date
      // 10: End Date (Formula di Sheet -> Code di sini)
      // 12: Status (Formula di Sheet -> Code di sini)

      var durasi = parseInt(row[8]) || 0;
      var startDate = normalizeDate(row[9]);
      var endDate = row[10] ? normalizeDate(row[10]) : null;

      // Rumus End Date: Start + Durasi (jika End Date kosong/formula)
      if (startDate && (!endDate || isNaN(endDate.getTime()))) {
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + durasi);
      }

      // Rumus Status Penugasan
      var status = "Not Started";
      if (startDate && endDate) {
        if (today > endDate) {
          status = "Completed";
        } else if (today >= startDate && today <= endDate) {
          status = "Active";
        } else {
          status = "Not Started";
        }
      }

      // Update Row Data untuk dikirim ke Client
      // Kita format tanggal menjadi string agar konsisten di frontend
      row[9] = formatDateID(startDate); 
      row[10] = formatDateID(endDate);
      row[12] = status; // Overwrite kolom status

      result.push(row);
    }
    return result;
  } catch (e) { return []; }
}

function getDataSKK() {
  try {
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheet = ss.getSheetByName("Dashboard SKK");
    var dbSheet = ss.getSheetByName("Database"); 
    
    if (!sheet || !dbSheet) return [];
    
    var data = sheet.getDataRange().getValues();
    var dbData = dbSheet.getDataRange().getValues();
    var contactMap = {};
    
    // Mapping Kontak dari Database
    for (var j = 1; j < dbData.length; j++) {
      var dbName = dbData[j][1];
      var dbContact = dbData[j][2];
      if (dbName) contactMap[dbName] = dbContact;
    }

    // --- LOGIC: Cross-Check Penugasan (VLOOKUP / COUNTIFS pengganti) ---
    // Kita butuh tahu siapa saja yang sedang "Active" di Penugasan
    var rawPenugasan = getDataPenugasan(); // Panggil fungsi internal
    var activeAssignments = {}; // Key: Nama, Value: Array of Project Names

    rawPenugasan.forEach(function(tugas) {
      var pName = (tugas[1] || "").toString().toLowerCase().trim();
      var pStatus = (tugas[12] || "").toLowerCase(); // Status yang sudah dihitung script
      var pProject = tugas[5] || tugas[2]; // Gunakan LPSE atau Nama Paket

      if (pStatus === 'active') {
        if (!activeAssignments[pName]) activeAssignments[pName] = [];
        activeAssignments[pName].push(pProject);
      }
    });

    if (data.length <= 6) return [];

    var result = [];
    var today = new Date(); today.setHours(0,0,0,0);

    for (var i = 6; i < data.length; i++) {
      if (data[i][1] !== "" && data[i][1] !== null) {
        var rowData = data[i]; 
        var namaPersonil = rowData[1];
        var cleanName = namaPersonil.toString().toLowerCase().trim();

        // Inject Kontak
        if (contactMap[namaPersonil]) {
           rowData[2] = contactMap[namaPersonil];
        }

        // --- LOGIC: Hitung Sisa Waktu & Status SKK ---
        // Mapping Index:
        // 8: Masa Berlaku
        // 9: Sisa Waktu (Formula -> Code)
        // 10: Status (Formula -> Code)

        var masaBerlaku = normalizeDate(rowData[8]);
        var sisaHari = diffDays(masaBerlaku);
        var statusSKK = "";

        // Logic Status
        var usedProjects = activeAssignments[cleanName];

        if (sisaHari < 0) {
          statusSKK = "Expired";
        } else if (usedProjects && usedProjects.length > 0) {
          // Jika ada di penugasan aktif
          var uniqueProjects = [...new Set(usedProjects)].join(", ");
          statusSKK = "Used in " + uniqueProjects;
        } else {
          statusSKK = "Active"; // atau Available
        }

        // Overwrite nilai array untuk dikirim
        rowData[8] = formatDateID(masaBerlaku);
        rowData[9] = sisaHari + " Hari";
        if (sisaHari < 0) rowData[9] = "Expired";
        
        // Simpan Status di Kolom 10 (biasanya Status) dan 11 (Keterangan jika kosong)
        rowData[10] = statusSKK;
        
        // Tambahkan ID baris di akhir array
        rowData.push(i + 1); 
        result.push(rowData);
      }
    }
    return result;
  } catch (e) { return []; }
}

function getDataProject() {
  try {
    var ss = SpreadsheetApp.openById(PROJECT_SS_ID);
    var sheet = ss.getSheetByName("Project");
    if (!sheet) return [];
    
    var data = sheet.getDataRange().getValues();
    if (data.length <= 7) return []; // Header asumsi baris 7

    var result = [];
    var today = new Date(); today.setHours(0,0,0,0);

    for (var i = 7; i < data.length; i++) {
      var row = data[i];
      if (!row[2]) continue; // Nama Pekerjaan kosong skip

      // --- LOGIC: Status Project ---
      // Index Mapping (Berdasarkan CSV):
      // 8: Start Date Kontrak
      // 9: Due Date Kontrak
      // 12: Start Date Schedule
      // 13: Due Date Schedule
      // 16: Status (Manual/Formula) -> Code Calculation

      var dueKontrak = normalizeDate(row[9]);
      var dueSchedule = normalizeDate(row[13]);
      
      // Hitung Days Left (overwrite kolom Days Left jika ada formula)
      // Kolom 10 (index 10) -> Days Left Kontrak
      // Kolom 14 (index 14) -> Days Left Schedule
      
      var daysLeftKontrak = dueKontrak ? diffDays(dueKontrak) : "-";
      var daysLeftSchedule = dueSchedule ? diffDays(dueSchedule) : "-";

      row[10] = (daysLeftKontrak === "-" ? "-" : daysLeftKontrak + " days");
      row[14] = (daysLeftSchedule === "-" ? "-" : daysLeftSchedule + " days");

      // Logic Status Project (Prioritas: Done Manual > Expired > Ongoing)
      var currentStatus = (row[16] || "").toString().toLowerCase();
      var finalStatus = row[16]; // Default ambil dari sheet (jika manual done)

      // Jika belum selesai, hitung otomatis
      if (!currentStatus.includes("done") && !currentStatus.includes("selesai") && !currentStatus.includes("100%")) {
        // Cek Expired berdasarkan Schedule atau Kontrak
        var targetDue = dueSchedule || dueKontrak;
        
        if (targetDue && today > targetDue) {
          finalStatus = "Expired / Overdue";
        } else {
          finalStatus = "Ongoing";
        }
      }

      // Overwrite kolom Status
      row[16] = finalStatus;

      // Format Tanggal untuk Client
      row[8] = formatDateID(normalizeDate(row[8]));
      row[9] = formatDateID(normalizeDate(row[9]));
      row[12] = formatDateID(normalizeDate(row[12]));
      row[13] = formatDateID(normalizeDate(row[13]));

      result.push(row);
    }
    return result;
  } catch (e) { return []; }
}

// --- DATA UTILS ---

function getDropdownData() {
  var ss = SpreadsheetApp.openById(MAIN_SS_ID);
  var dbSheet = ss.getSheetByName("Database");
  if (!dbSheet) return { error: "Sheet 'Database' tidak ditemukan!" };

  var data = dbSheet.getDataRange().getValues();
  var dropdowns = { nama: [], perusahaan: [], sertifikat: [], jenjang: [] };

  for (var i = 1; i < data.length; i++) {
    if (data[i][1]) dropdowns.nama.push(data[i][1]); 
    if (data[i][11]) dropdowns.perusahaan.push(data[i][11]);
    if (data[i][5]) dropdowns.sertifikat.push(data[i][5]); 
    if (data[i][7]) dropdowns.jenjang.push(data[i][7]); 
  }
  
  for (var key in dropdowns) {
    dropdowns[key] = [...new Set(dropdowns[key])].sort();
  }
  return dropdowns;
}

// --- AUTH & LOGGING ---

function hashString(str) {
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

function verifyPassword(inputHash) {
  try {
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheet = ss.getSheetByName("Admin");
    if (!sheet) return { valid: false, message: "Sheet Admin hilang" }; 
    
    var storedPasswords = sheet.getRange("A2:A5").getValues().flat();
    var input = inputHash.toString().trim();

    var role = null;
    if (storedPasswords[0] && input === hashString(storedPasswords[0])) role = "SUPER_ADMIN";
    else if (storedPasswords[1] && input === hashString(storedPasswords[1])) role = "ADMIN";
    else if (storedPasswords[2] && input === hashString(storedPasswords[2])) role = "TEKNIS";
    else if (storedPasswords[3] && input === hashString(storedPasswords[3])) role = "ADMIN_INPUT";

    if (role) {
      logUserActivity(role, "LOGIN", "Login berhasil");
      return { valid: true, role: role };
    }
    
    return { valid: false };
  } catch (e) { return { valid: false, error: e.toString() }; }
}

function logUserActivity(role, action, details) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000); 
  } catch (e) {
    console.log("Could not get lock for logging");
    return;
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var currentLogsJSON = props.getProperty('SYSTEM_LOGS');
    var logs = [];

    if (currentLogsJSON) {
      try { logs = JSON.parse(currentLogsJSON); } catch (e) { logs = []; }
    }

    var now = new Date();
    var timeString = Utilities.formatDate(now, "Asia/Jakarta", "dd-MM-yyyy HH:mm:ss");

    var newLog = {
      time: timeString,
      role: role || "UNKNOWN",
      action: action,
      details: details
    };

    logs.unshift(newLog); 

    if (logs.length > MAX_LOG_ENTRIES) {
      logs = logs.slice(0, MAX_LOG_ENTRIES);
    }

    props.setProperty('SYSTEM_LOGS', JSON.stringify(logs));

  } catch (e) {
    console.error("Error saving log: " + e.toString());
  } finally {
    lock.releaseLock();
  }
}

function getSystemLogs() {
  try {
    var props = PropertiesService.getScriptProperties();
    var json = props.getProperty('SYSTEM_LOGS');
    if (!json) return [];
    return JSON.parse(json);
  } catch (e) {
    return [];
  }
}

function clearLogData(startDateStr, endDateStr, passwordHashInput) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheetAdmin = ss.getSheetByName("Admin");
    if (!sheetAdmin) return { error: "Sheet Admin tidak ditemukan" };
    
    var passwords = sheetAdmin.getRange("A2:A5").getValues().flat();
    var superAdminPass = passwords[0];
    
    if (passwordHashInput.toString() !== hashString(superAdminPass)) {
      return { error: "Password Salah! Akses Ditolak." };
    }

    var props = PropertiesService.getScriptProperties();
    var currentLogsJSON = props.getProperty('SYSTEM_LOGS');
    if (!currentLogsJSON) return { status: "Sukses", count: 0 };
    
    var logs = JSON.parse(currentLogsJSON);
    var initialCount = logs.length;
    
    var start = new Date(startDateStr); start.setHours(0,0,0,0);
    var end = new Date(endDateStr); end.setHours(23,59,59,999);
    
    var newLogs = logs.filter(function(log) {
      var parts = log.time.split(' '); 
      var dParts = parts[0].split('-'); 
      var tParts = parts[1].split(':'); 
      var logDate = new Date(dParts[2], dParts[1] - 1, dParts[0], tParts[0], tParts[1], tParts[2]);
      
      return (logDate < start || logDate > end);
    });

    props.setProperty('SYSTEM_LOGS', JSON.stringify(newLogs));
    var deletedCount = initialCount - newLogs.length;
    
    logUserActivity("SUPER_ADMIN", "HAPUS LOG", "Menghapus " + deletedCount + " data (" + startDateStr + " s/d " + endDateStr + ")");

    return { status: "Sukses", count: deletedCount };

  } catch (e) {
    return { error: "Gagal: " + e.toString() };
  } finally {
    lock.releaseLock();
  }
}

// --- FORM PROCESSING ---

function processForm(data, passwordAuthHash) {
  var ss = SpreadsheetApp.openById(MAIN_SS_ID);
  
  var sheetAdmin = ss.getSheetByName("Admin");
  if (!sheetAdmin) return "Error Sistem: Sheet Admin tidak ditemukan.";
  
  var passwords = sheetAdmin.getRange("A2:A5").getValues().flat();
  var superAdminPass = passwords[0];
  var adminInputPass = passwords[3];
  
  var inputHash = passwordAuthHash.toString();
  var currentRole = "";

  if (inputHash === hashString(superAdminPass)) currentRole = "SUPER_ADMIN";
  else if (inputHash === hashString(adminInputPass)) currentRole = "ADMIN_INPUT";
  else return "Password Salah! Akses Ditolak.";

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
  } catch (e) {
    return "Server sibuk, coba lagi.";
  }

  try {
    var sheet = ss.getSheetByName("Dashboard SKK"); 
    if (!sheet) return "Error: Sheet 'Dashboard SKK' tidak ditemukan.";

    var targetRow;
    var actionType = "";
    
    // 1. Tentukan Baris Target (Edit atau Tambah)
    if (data.rowNumber && data.rowNumber != "") {
      targetRow = parseInt(data.rowNumber);
      if (isNaN(targetRow) || targetRow < 7) return "Error: Baris tidak valid.";
      actionType = "EDIT DATA";
    } else {
      var lastRow = sheet.getLastRow();
      // Cari baris kosong pertama di kolom B mulai baris 7
      var rangeB = sheet.getRange("B7:B" + (lastRow + 5)).getValues();
      targetRow = -1;
      for (var i = 0; i < rangeB.length; i++) {
        if (rangeB[i][0] === "" || rangeB[i][0] === null) {
          targetRow = i + 7; // Karena index 0 adalah baris 7
          break;
        }
      }
      if (targetRow === -1) targetRow = lastRow + 1;
      if (targetRow < 7) targetRow = 7;
      actionType = "TAMBAH DATA";
    }

    // 2. Simpan Data Inputan Saat Ini (RAW VALUE)
    // Kita tidak menulis formula, hanya value. Status akan dihitung otomatis saat GET.
    sheet.getRange(targetRow, 2).setValue(data.nama); 
    var rowData = [[
      data.perusahaan, 
      data.sertifikat, 
      data.jenjang, 
      data.asosiasi, 
      data.masaBerlaku 
    ]];
    sheet.getRange(targetRow, 5, 1, 5).setValues(rowData);
    sheet.getRange(targetRow, 12).setValue(data.keterangan);
    
    // Kosongkan kolom Sisa Waktu (9) & Status (10) di Sheet agar tidak ada sisa data lama
    // Data ini nanti digenerate oleh script getDataSKK
    sheet.getRange(targetRow, 9, 1, 2).clearContent(); 
    
    // 3. LOGIKA UPDATE OTOMATIS PERUSAHAAN (Batch Update)
    var lastRowData = sheet.getLastRow();
    if (lastRowData >= 7) {
      var rangeNames = sheet.getRange(7, 2, lastRowData - 6, 1).getValues(); 
      var rangeComps = sheet.getRange(7, 5, lastRowData - 6, 1); 
      var currentComps = rangeComps.getValues();
      
      var inputNameClean = data.nama.toString().toLowerCase().trim();
      var inputCompClean = data.perusahaan.toString().trim();
      var isUpdated = false;

      for (var i = 0; i < rangeNames.length; i++) {
        var rowName = rangeNames[i][0] ? rangeNames[i][0].toString().toLowerCase().trim() : "";
        if (rowName === inputNameClean) {
           if (currentComps[i][0] !== inputCompClean) {
             currentComps[i][0] = inputCompClean;
             isUpdated = true;
           }
        }
      }
      
      if (isUpdated) {
        rangeComps.setValues(currentComps);
      }
    }

    SpreadsheetApp.flush(); 
    logUserActivity(currentRole, actionType, `${data.nama} - ${data.sertifikat}`);

    return "Sukses";

  } catch (e) {
    return "Gagal Sistem: " + e.toString();
  } finally {
    lock.releaseLock();
  }
}
