// --- Code.gs (Final Version: Login/Logout Audit) ---

// 1. MASUKKAN ID SPREADSHEET UTAMA
const MAIN_SS_ID = "1NYw4b9mSXoa_tYxo38mWZizQahq0wBee-9cU9oUk23o"; 

// 2. ID Spreadsheet Project
const PROJECT_SS_ID = "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc"; 

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
  } else if (action === 'getAuditLogs') {
    result = getAuditLogs(e.parameter.role);
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
      // --- LOG LOGIN ---
      if (result.valid) {
        logAudit("LOGIN", "User Login: " + result.role);
      } else {
        logAudit("LOGIN_FAIL", "Gagal Login (Password Salah)");
      }
    } 
    else if (action === 'logout') {
      // --- LOG LOGOUT ---
      var role = data.role || "Unknown";
      logAudit("LOGOUT", "User Logout: " + role);
      result = { status: "Success" };
    }
    else if (action === 'saveData') {
      result = processForm(data.payload);
       // Log simpan data sudah ditangani di dalam fungsi processForm
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

// --- FUNGSI AUDIT LOG (Script Properties) ---
function logAudit(type, message) {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var logsJSON = scriptProps.getProperty("AUDIT_LOGS");
    var logs = logsJSON ? JSON.parse(logsJSON) : [];
    
    var now = new Date();
    // Format waktu agar mudah dibaca di JSON (opsional, tapi timestamp ISO lebih aman)
    var newLog = {
      timestamp: now.toISOString(),
      type: type,
      message: message
    };
    
    logs.unshift(newLog); // Tambah di awal (terbaru)

    // Bersihkan log > 6 bulan (180 hari)
    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 180);
    
    logs = logs.filter(function(log) {
      return new Date(log.timestamp) > cutoffDate;
    });

    // Batasi jumlah log agar tidak error memori (Max 100 log terakhir)
    if (logs.length > 100) {
      logs = logs.slice(0, 100);
    }

    scriptProps.setProperty("AUDIT_LOGS", JSON.stringify(logs));
  } catch (e) {
    console.error("Gagal mencatat log: " + e.toString());
  }
}

function getAuditLogs(role) {
  if (role !== "SUPER_ADMIN") return { error: "Unauthorized" };
  try {
    var logsJSON = PropertiesService.getScriptProperties().getProperty("AUDIT_LOGS");
    return logsJSON ? JSON.parse(logsJSON) : [];
  } catch (e) {
    return [];
  }
}

// --- FUNGSI LOGIC ---

function verifyPassword(inputPassword) {
  try {
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheet = ss.getSheetByName("Admin");
    if (!sheet) return { valid: false, message: "Sheet Admin hilang" }; 
    
    var storedPasswords = sheet.getRange("A2:A5").getValues().flat();
    var input = inputPassword.toString().trim();

    if (storedPasswords[0] && input === storedPasswords[0].toString()) return { valid: true, role: "SUPER_ADMIN" };
    if (storedPasswords[1] && input === storedPasswords[1].toString()) return { valid: true, role: "ADMIN" };
    if (storedPasswords[2] && input === storedPasswords[2].toString()) return { valid: true, role: "TEKNIS" };
    if (storedPasswords[3] && input === storedPasswords[3].toString()) return { valid: true, role: "ADMIN_INPUT" };
    
    return { valid: false };
  } catch (e) { return { valid: false, error: e.toString() }; }
}

function getDataSKK() {
  try {
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheet = ss.getSheetByName("Dashboard SKK");
    var dbSheet = ss.getSheetByName("Database"); 
    
    if (!sheet || !dbSheet) return [];
    
    var data = sheet.getDataRange().getDisplayValues();
    var dbData = dbSheet.getDataRange().getValues();
    var contactMap = {};
    
    for (var j = 1; j < dbData.length; j++) {
      var dbName = dbData[j][1];
      var dbContact = dbData[j][2];
      if (dbName) contactMap[dbName] = dbContact;
    }

    if (data.length <= 6) return [];

    var result = [];
    for (var i = 6; i < data.length; i++) {
      if (data[i][1] !== "" && data[i][1] !== null) {
        var rowData = data[i]; 
        var namaPersonil = rowData[1];
        if (contactMap[namaPersonil]) {
           rowData[2] = contactMap[namaPersonil];
        }
        rowData.push(i + 1); 
        result.push(rowData);
      }
    }
    return result;
  } catch (e) { return []; }
}

function getDataPenugasan() {
  try {
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheet = ss.getSheetByName("Dashboard Waktu Penugasan");
    if (!sheet) return [];
    var data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 6) return [];
    return data.slice(6).filter(r => r[1] !== "" && r[1] !== null);
  } catch (e) { return []; }
}

function getDataProject() {
  try {
    var ss = SpreadsheetApp.openById(PROJECT_SS_ID);
    var sheet = ss.getSheetByName("Project");
    if (!sheet) return [];
    var data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 7) return [];
    return data.slice(7).filter(r => r[2] !== "" && r[2] !== null);
  } catch (e) { return []; }
}

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

function processForm(data) {
  var ss = SpreadsheetApp.openById(MAIN_SS_ID);
  
  var sheetAdmin = ss.getSheetByName("Admin");
  if (!sheetAdmin) return "Error Sistem: Sheet Admin tidak ditemukan.";
  
  var passwords = sheetAdmin.getRange("A2:A5").getValues().flat();
  var superAdminPass = passwords[0];
  var adminInputPass = passwords[3];
  
  var inputPass = data.actionPassword.toString();

  if (inputPass !== superAdminPass.toString() && inputPass !== adminInputPass.toString()) {
    logAudit("INPUT_FAIL", "Wrong Password Attempt for: " + data.nama);
    return "Password Salah! Akses Ditolak.";
  }

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
    var actionType = "INSERT";
    
    if (data.rowNumber && data.rowNumber != "") {
      targetRow = parseInt(data.rowNumber);
      actionType = "UPDATE";
      if (isNaN(targetRow) || targetRow < 7) return "Error: Baris tidak valid.";
    } else {
      var lastRow = sheet.getLastRow();
      var rangeB = sheet.getRange("B1:B" + (lastRow + 10)).getValues();
      targetRow = -1;
      for (var i = 6; i < rangeB.length; i++) {
        if (rangeB[i][0] === "" || rangeB[i][0] === null) {
          targetRow = i + 1;
          break;
        }
      }
      if (targetRow === -1) targetRow = lastRow + 1;
      if (targetRow < 7) targetRow = 7;
    }

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
    
    SpreadsheetApp.flush(); 
    
    // Log Activity
    logAudit(actionType, "Personil: " + data.nama + ", Row: " + targetRow);
    
    return "Sukses";

  } catch (e) {
    logAudit("ERROR", "Save Error: " + e.toString());
    return "Gagal Sistem: " + e.toString();
  } finally {
    lock.releaseLock();
  }
}
