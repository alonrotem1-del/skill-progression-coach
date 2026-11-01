// The athlete's own Google Sheet, on the receiving end of the app. Pasted into
// the sheet (Extensions > Apps Script) and deployed as a web app. Workouts go
// into one tab of their own, one row per exercise; no other tab is touched.
// The deployment's link is the only key: it stays on the athlete's device.
var TAB = 'מהאפליקציה';
var HEAD = ['תאריך', 'שבוע', 'אימון', 'תרגיל', 'רמה', 'בפועל', 'סה"כ', 'מצב', 'הערה', 'מזהה'];
var ID_COL = HEAD.length;
var LEVEL = { easy: 'קל', hard: 'קשה' };
var UNIT = { reps: 'חזרות', sec: 'שניות', rounds: 'סיבובים' };
var STATUS = { met: 'בטווח', below: 'מתחת לטווח', done: 'נרשם', 'not-done': 'ללא תוצאה', skipped: 'דולג' };

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function workoutsTab() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(TAB);
  if (sheet) return sheet;
  sheet = book.insertSheet(TAB);
  sheet.setRightToLeft(true);
  sheet.appendRow(HEAD);
  sheet.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.hideColumns(ID_COL);
  return sheet;
}

// The row number of every row of a workout, last first, so rows can be deleted in order.
function rowsOf(sheet, id) {
  var last = sheet.getLastRow(), out = [];
  if (last < 2) return out;
  var ids = sheet.getRange(2, ID_COL, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (ids[i][0] === id) out.push(i + 2);
  return out;
}

function addWorkout(sheet, rows) {
  if (!rows.length || rowsOf(sheet, rows[0].id).length) return; // sent again after a lost answer: nothing twice
  rows.forEach(function (r) {
    var week = 'שלב ' + r.phase + ' · שבוע ' + r.week;
    sheet.appendRow([new Date(r.date), week, r.workout, r.exercise, LEVEL[r.level] || '', '', r.total, STATUS[r.status] || '', r.note, r.id]);
    var row = sheet.getLastRow();
    sheet.getRange(row, 1).setNumberFormat('dd/mm/yyyy');
    sheet.getRange(row, 6).setNumberFormat('@').setValue(r.status === 'skipped' ? 'לא בוצע' : r.actual); // text: "12, 12" is not a number to Sheets
    if (UNIT[r.unit]) sheet.getRange(row, 7).setNumberFormat('0" ' + UNIT[r.unit] + '"');
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var msg = JSON.parse(e.postData.contents);
    var sheet = workoutsTab();
    if (msg.add) addWorkout(sheet, msg.add);
    if (msg.del) rowsOf(sheet, msg.del).forEach(function (row) { sheet.deleteRow(row); });
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
