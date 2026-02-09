/**
 * Setup halaman HTML
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('Database Dan Monitoring SKK Gaharu Sempana Group')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
}

/**
 * VERIFIKASI PASSWORD & ROLE
 * A2 = SUPER_ADMIN (Full Access)
 * A3 = ADMIN (View Only: SKK & Penugasan)
 * A4 = TEKNIS (Master Project Only)
 * A5 = ADMIN_INPUT (View SKK & Penugasan + Bisa Edit/Tambah)
 */
function verifyPassword(inputPassword) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Admin");
    if (!sheet) return { valid: false }; 
    
    // Ambil password dari A2 sampai A5
    var storedPasswords = sheet.getRange("A2:A5").getValues().flat();
    var input = inputPassword.toString().trim();

    // Cek Role
    if (storedPasswords[0] && input === storedPasswords[0].toString()) {
      return { valid: true, role: "SUPER_ADMIN" };
    } 
    else if (storedPasswords[1] && input === storedPasswords[1].toString()) {
      return { valid: true, role: "ADMIN" };
    } 
    else if (storedPasswords[2] && input === storedPasswords[2].toString()) {
      return { valid: true, role: "TEKNIS" };
    }
    else if (storedPasswords[3] && input === storedPasswords[3].toString()) {
      return { valid: true, role: "ADMIN_INPUT" }; // Role Baru
    }
    
    return { valid: false };
  } catch (e) { return { valid: false }; }
}

const PROJECT_SS_ID = "1kPWraQ0VJNB36sdJVlkP7dDZAZKBvisAtrggGYLraqc"; 

/**
 * AMBIL DATA PROJECT
 */
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

/**
 * DATA SKK
 */
function getDataSKK() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
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
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Dashboard Waktu Penugasan");
    if (!sheet) return [];
    var data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 6) return [];
    return data.slice(6).filter(r => r[1] !== "" && r[1] !== null);
  } catch (e) { return []; }
}

function getDropdownData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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

/**
 * PROSES SIMPAN / UPDATE DATA
 * Bisa dilakukan oleh SUPER_ADMIN (A2) atau ADMIN_INPUT (A5)
 */
function processForm(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetAdmin = ss.getSheetByName("Admin");
  if (!sheetAdmin) return "Error Sistem.";
  
  // Ambil Password Super Admin (A2) dan Admin Input (A5)
  var passwords = sheetAdmin.getRange("A2:A5").getValues().flat();
  var superAdminPass = passwords[0]; // A2
  var adminInputPass = passwords[3]; // A5
  
  var inputPass = data.actionPassword.toString();

  // Cek apakah password cocok dengan SALAH SATU dari kedua role tersebut
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

    // Simpan Data
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