/**
 * Luxpackers CRM — shared Google Sheet connection.
 *
 * Paste this whole file into Extensions → Apps Script of your CRM Google Sheet,
 * then follow README.md → "Connect the shared Google Sheet".
 *
 * The two sign-in codes are kept in Project Settings → Script properties:
 *   TEAM_CODE   — everyone in the company
 *   ADMIN_CODE  — only the people who may delete records
 */
const COLLECTIONS = ["tasks", "leads", "bookings", "trips", "finance", "partners", "content", "team", "access"];
const RECORDS = "Records";
const ACTIVITY = "Activity";

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: "bad_request" }); }
  return handle_(p);
}

function handle_(p) {
  const props = PropertiesService.getScriptProperties();
  const team = props.getProperty("TEAM_CODE"), admin = props.getProperty("ADMIN_CODE");
  if (!team || !admin) return out_({ ok: false, error: "codes_not_set" });
  const role = p.code === admin ? "admin" : p.code === team ? "member" : null;
  if (!role) return out_({ ok: false, error: "wrong_code" });

  if (p.action === "auth") return out_({ ok: true, role: role });
  if (p.action === "all") return out_({ ok: true, role: role, data: readAll_() });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (p.action === "upsert") {
      if (COLLECTIONS.indexOf(p.collection) < 0 || !p.item || !p.item.id) return out_({ ok: false, error: "bad_request" });
      upsert_(p.collection, p.item, p.user);
      log_(p.log, p.user);
      return out_({ ok: true });
    }
    if (p.action === "remove") {
      if (role !== "admin") return out_({ ok: false, error: "admin_only" });
      remove_(p.collection, String(p.id));
      log_(p.log, p.user);
      return out_({ ok: true });
    }
    if (p.action === "bulk") {
      if (role !== "admin") return out_({ ok: false, error: "admin_only" });
      Object.keys(p.records || {}).forEach(function (c) {
        if (COLLECTIONS.indexOf(c) < 0) return;
        (p.records[c] || []).forEach(function (item) { if (item && item.id) upsert_(c, item, p.user); });
      });
      log_({ action: "loaded the starting records", collection: "", id: "", title: "" }, p.user);
      return out_({ ok: true });
    }
    return out_({ ok: false, error: "unknown_action" });
  } finally {
    lock.releaseLock();
  }
}

function sheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}
function records_() { return sheet_(RECORDS, ["Register", "ID", "Title", "Updated", "Updated by", "Data (do not edit by hand)"]); }

function readAll_() {
  const data = {};
  COLLECTIONS.forEach(function (c) { data[c] = []; });
  const values = records_().getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const c = values[i][0];
    if (!data[c]) continue;
    try { data[c].push(JSON.parse(values[i][5])); } catch (err) {}
  }
  const act = sheet_(ACTIVITY, ["When", "Who", "Did", "Register", "ID", "Title"]);
  const last = act.getLastRow();
  data.activity = [];
  if (last > 1) {
    const n = Math.min(200, last - 1);
    const rows = act.getRange(last - n + 1, 1, n, 6).getValues().reverse();
    data.activity = rows.map(function (r) { return { at: new Date(r[0]).toISOString(), user: r[1], action: r[2], collection: r[3], id: r[4], title: r[5] }; });
  }
  return data;
}

function titleOf_(item) { return String(item.title || item.name || item.guest || item.entry || item.system || ""); }

function upsert_(collection, item, user) {
  const sh = records_();
  const values = sh.getDataRange().getValues();
  const row = [collection, String(item.id), titleOf_(item), new Date(), user || "", JSON.stringify(item)];
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === collection && String(values[i][1]) === String(item.id)) {
      sh.getRange(i + 1, 1, 1, 6).setValues([row]);
      return;
    }
  }
  sh.appendRow(row);
}

function remove_(collection, id) {
  const sh = records_();
  const values = sh.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === collection && String(values[i][1]) === id) sh.deleteRow(i + 1);
  }
}

function log_(entry, user) {
  if (!entry) return;
  sheet_(ACTIVITY, ["When", "Who", "Did", "Register", "ID", "Title"])
    .appendRow([new Date(), user || entry.user || "", entry.action || "", entry.collection || "", entry.id || "", entry.title || ""]);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
