/* Where the records live.
   - No sheetApiUrl in config.js: saved in this browser only ("this computer").
   - With sheetApiUrl: saved in the shared Google Sheet through the Google Apps Script web app. */
(function () {
  const CFG = window.LUX_CONFIG || {};
  const KEY = "luxcrm.data.v1";
  const COLLECTIONS = window.LUX_SCHEMA.MODULES.map(m => m.id);
  const apiUrl = () => (CFG.sheetApiUrl || "").trim();

  const empty = () => { const o = { activity: [] }; COLLECTIONS.forEach(c => (o[c] = [])); return o; };

  function readLocal() {
    try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); COLLECTIONS.forEach(c => (d[c] = d[c] || [])); d.activity = d.activity || []; return d; } } catch (_) {}
    return null;
  }
  function writeLocal(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (_) { return false; } }

  async function call(params) {
    const url = apiUrl();
    let res;
    if (params.action === "all" || params.action === "auth") {
      const q = new URLSearchParams(params).toString();
      res = await fetch(url + (url.includes("?") ? "&" : "?") + q, { method: "GET", redirect: "follow" });
    } else {
      // text/plain keeps the request "simple" so the browser sends it straight to Google.
      res = await fetch(url, { method: "POST", redirect: "follow", body: JSON.stringify(params) });
    }
    const out = await res.json();
    if (!out.ok) { const e = new Error(out.error || "failed"); e.code = out.error; throw e; }
    return out;
  }

  const Store = {
    isShared: () => !!apiUrl(),

    async signIn(name, code) {
      if (!apiUrl()) {
        if (code === CFG.localAdminCode) return "admin";
        if (code === CFG.localTeamCode) return "member";
        const e = new Error("wrong_code"); e.code = "wrong_code"; throw e;
      }
      const out = await call({ action: "auth", code, user: name });
      return out.role;
    },

    async loadAll(session) {
      if (!apiUrl()) return readLocal() || empty();
      const out = await call({ action: "all", code: session.code, user: session.name });
      const d = empty();
      Object.keys(out.data || {}).forEach(k => { if (d[k] !== undefined) d[k] = out.data[k]; });
      return d;
    },

    async save(session, data, collection, item, what) {
      const entry = { at: new Date().toISOString(), user: session.name, action: what, collection, id: item.id, title: item.__title || "" };
      delete item.__title;
      if (!apiUrl()) {
        const list = data[collection]; const i = list.findIndex(x => x.id === item.id);
        if (i >= 0) list[i] = item; else list.push(item);
        data.activity.unshift(entry); data.activity = data.activity.slice(0, 400);
        if (!writeLocal(data)) throw new Error("storage_full");
        return;
      }
      await call({ action: "upsert", code: session.code, user: session.name, collection, item, log: entry });
    },

    async remove(session, data, collection, id, title) {
      const entry = { at: new Date().toISOString(), user: session.name, action: "deleted", collection, id, title };
      if (!apiUrl()) {
        data[collection] = data[collection].filter(x => x.id !== id);
        data.activity.unshift(entry); writeLocal(data); return;
      }
      await call({ action: "remove", code: session.code, user: session.name, collection, id, log: entry });
    },

    async bulk(session, data, records) {
      if (!apiUrl()) {
        Object.keys(records).forEach(c => { data[c] = (data[c] || []).concat(records[c]); });
        data.activity.unshift({ at: new Date().toISOString(), user: session.name, action: "loaded the starting records", collection: "", id: "", title: "" });
        writeLocal(data); return;
      }
      await call({ action: "bulk", code: session.code, user: session.name, records });
    },

    exportJson(data) { return JSON.stringify(data, null, 2); },
    importLocal(json) { const d = JSON.parse(json); COLLECTIONS.forEach(c => { if (!Array.isArray(d[c])) d[c] = []; }); d.activity = d.activity || []; writeLocal(d); return d; },
    resetLocal() { try { localStorage.removeItem(KEY); } catch (_) {} }
  };
  window.LUX_STORE = Store;
})();
