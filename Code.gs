// --- Code.gs (Final - With Internal Audit Log) ---

// 1. MASUKKAN ID SPREADSHEET UTAMA
const MAIN_SS_ID = "1NYw4b9mSXoa_tYxo38mWZizQahq0wBee-9cU9oUk23o"; 

// 2. ID Spreadsheet Project
const PROJECT_SS_ID = "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc"; 

// --- KONFIGURASI LOG ---
const MAX_LOG_ENTRIES = 200; // Simpan 200 aktifitas terakhir (agar script properties tidak penuh)

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
    result = getSystemLogs(); // Endpoint baru untuk mengambil log
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

// --- FUNGSI LOGIC UTAMA ---

function verifyPassword(inputPassword) {
  try {
    var ss = SpreadsheetApp.openById(MAIN_SS_ID);
    var sheet = ss.getSheetByName("Admin");
    if (!sheet) return { valid: false, message: "Sheet Admin hilang" }; 
    
    var storedPasswords = sheet.getRange("A2:A5").getValues().flat();
    var input = inputPassword.toString().trim();

    var role = null;
    if (storedPasswords[0] && input === storedPasswords[0].toString()) role = "SUPER_ADMIN";
    else if (storedPasswords[1] && input === storedPasswords[1].toString()) role = "ADMIN";
    else if (storedPasswords[2] && input === storedPasswords[2].toString()) role = "TEKNIS";
    else if (storedPasswords[3] && input === storedPasswords[3].toString()) role = "ADMIN_INPUT";

    if (role) {
      logUserActivity(role, "LOGIN", "Login berhasil");
      return { valid: true, role: role };
    }
    
    return { valid: false };
  } catch (e) { return { valid: false, error: e.toString() }; }
}

// --- FITUR LOG HISTORY (INTERNAL MEMORY) ---

function logUserActivity(role, action, details) {
  var lock = LockService.getScriptLock();
  // Tunggu maksimal 5 detik untuk menghindari tabrakan penulisan
  try {
    lock.waitLock(5000); 
  } catch (e) {
    console.log("Could not get lock");
    return; // Skip logging jika sibuk, agar user experience tidak terganggu
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var currentLogsJSON = props.getProperty('SYSTEM_LOGS');
    var logs = [];

    if (currentLogsJSON) {
      try {
        logs = JSON.parse(currentLogsJSON);
      } catch (e) { logs = []; }
    }

    // Format Waktu Indonesia (WIB/WITA/WIT tergantung server, kita set statis string)
    var now = new Date();
    var timeString = Utilities.formatDate(now, "Asia/Jakarta", "dd-MM-yyyy HH:mm:ss");

    var newLog = {
      time: timeString,
      role: role || "UNKNOWN",
      action: action,
      details: details
    };

    // Tambahkan ke paling atas (Terbaru)
    logs.unshift(newLog);

    // LOGIKA AUTO DELETE (FIFO): Jika lebih dari MAX_LOG_ENTRIES, hapus yang lama
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

// --- FUNGSI DATA ---

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

function processForm(data, passwordAuth) {
  var ss = SpreadsheetApp.openById(MAIN_SS_ID);
  
  var sheetAdmin = ss.getSheetByName("Admin");
  if (!sheetAdmin) return "Error Sistem: Sheet Admin tidak ditemukan.";
  
  var passwords = sheetAdmin.getRange("A2:A5").getValues().flat();
  var superAdminPass = passwords[0];
  var adminInputPass = passwords[3];
  
  var inputPass = passwordAuth.toString();
  var currentRole = "";

  if (inputPass === superAdminPass.toString()) currentRole = "SUPER_ADMIN";
  else if (inputPass === adminInputPass.toString()) currentRole = "ADMIN_INPUT";
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
    
    if (data.rowNumber && data.rowNumber != "") {
      targetRow = parseInt(data.rowNumber);
      if (isNaN(targetRow) || targetRow < 7) return "Error: Baris tidak valid.";
      actionType = "EDIT DATA";
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
      actionType = "TAMBAH DATA";
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
    
    // CATAT KE LOG
    logUserActivity(currentRole, actionType, `${data.nama} - ${data.sertifikat}`);

    return "Sukses";

  } catch (e) {
    return "Gagal Sistem: " + e.toString();
  } finally {
    lock.releaseLock();
  }
}
