// --- Code.gs (Versi API - FIXED) ---

// 1. MASUKKAN ID SPREADSHEET UTAMA (Tempat data SKK & Penugasan)
const MAIN_SS_ID = "1NYw4b9mSXoa_tYxo38mWZizQahq0wBee-9cU9oUk23o"; 

// 2. ID Spreadsheet Project (Sudah ada sebelumnya)
const PROJECT_SS_ID = "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc"; 


/**
 * Handle GET Requests (API Endpoint)
 */
function doGet(e) {
  // --- PENGAMAN ---
  // Jika e undefined (dijalankan dari editor), buat dummy object agar tidak error
  if (!e || !e.parameter) {
    return ContentService.createTextOutput("Error: Jangan jalankan doGet() langsung dari editor. Gunakan Deploy > Test Deploy, atau fungsi debugDoGet().");
  }
  // ----------------

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
  } else {
    result = { error: "Action not defined" };
  }

  return responseJSON(result);
}

/**
 * Handle POST Requests (Login & Save)
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;
    var result = {};

    if (action === 'login') {
      result = verifyPassword(data.password);
    } else if (action === 'saveData') {
      result = processForm(data.payload);
    } else {
      result = { error: "Action not defined" };
    }
    
    return responseJSON(result);
  } catch (err) {
    return responseJSON({ error: err.toString() });
  }
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- FUNGSI LOGIC (Sekarang menggunakan openById) ---

function verifyPassword(inputPassword) {
  try {
    // UBAH getActiveSpreadsheet() JADI openById(MAIN_SS_ID)
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
    // UBAH getActiveSpreadsheet() JADI openById(MAIN_SS_ID)
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
    // UBAH getActiveSpreadsheet() JADI openById(MAIN_SS_ID)
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
    // Project menggunakan ID terpisah (sudah benar)
    var ss = SpreadsheetApp.openById(PROJECT_SS_ID);
    var sheet = ss.getSheetByName("Project");
    if (!sheet) return [];
    var data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 7) return [];
    return data.slice(7).filter(r => r[2] !== "" && r[2] !== null);
  } catch (e) { return []; }
}

function getDropdownData() {
  // UBAH getActiveSpreadsheet() JADI openById(MAIN_SS_ID)
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
  // UBAH getActiveSpreadsheet() JADI openById(MAIN_SS_ID)
  var ss = SpreadsheetApp.openById(MAIN_SS_ID);
  
  var sheetAdmin = ss.getSheetByName("Admin");
  if (!sheetAdmin) return "Error Sistem: Sheet Admin tidak ditemukan.";
  
  var passwords = sheetAdmin.getRange("A2:A5").getValues().flat();
  var superAdminPass = passwords[0];
  var adminInputPass = passwords[3];
  
  var inputPass = data.actionPassword.toString();

  if (inputPass !== superAdminPass.toString() && inputPass !== adminInputPass.toString()) {
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
    if (data.rowNumber && data.rowNumber != "") {
      targetRow = parseInt(data.rowNumber);
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
    return "Sukses";

  } catch (e) {
    return "Gagal Sistem: " + e.toString();
  } finally {
    lock.releaseLock();
  }
}
