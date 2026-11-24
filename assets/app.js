/* Luxpackers CRM — application */
(function () {
  "use strict";
  const CFG = window.LUX_CONFIG || {};
  const { DEPARTMENTS, MODULES } = window.LUX_SCHEMA;
  const Store = window.LUX_STORE;
  const MOD = Object.fromEntries(MODULES.map(m => [m.id, m]));
  const SESSION_KEY = "luxcrm.session";
  const root = document.getElementById("root");

  const S = { session: null, data: null, filters: {}, sort: {}, drawer: null, findOpen: false };

  /* ---------- helpers ---------- */
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : "";
  const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const fmtDate = d => { if (!d) return ""; const x = new Date(d + "T00:00:00"); return isNaN(x) ? esc(d) : x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
  const fmtShort = d => { if (!d) return ""; const x = new Date(d + "T00:00:00"); return isNaN(x) ? "" : x.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); };
  const money = n => (n === "" || n == null || isNaN(Number(n))) ? "" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const moneyShort = n => { n = Number(n) || 0; if (n >= 1e7) return "₹" + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + " Cr"; if (n >= 1e5) return "₹" + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + " L"; return "₹" + n.toLocaleString("en-IN"); };
  const ago = iso => { if (!iso) return ""; const m = Math.round((Date.now() - new Date(iso)) / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago"); const d = Math.round(h / 24); return d < 30 ? d + (d === 1 ? " day ago" : " days ago") : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); };
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fieldOf = (m, k) => m.fields.find(f => f.key === k);
  const toneOf = (m, v) => (m.statuses.find(s => s.v === v) || { tone: "muted" }).tone;
  const pill = (m, v) => v ? `<span class="pill tone-${toneOf(m, v)}">${esc(v)}</span>` : "";
  const titleOf = (m, r) => r[m.titleKey] || "Untitled " + m.singular;
  const isOpen = (m, r) => !(m.doneValues || []).includes(r[m.statusKey]);
  const isLate = (m, r) => m.dueKey && r[m.dueKey] && r[m.dueKey] < todayISO() && isOpen(m, r) && m.id !== "bookings";
  const deptOf = (m, r) => r.dept || m.dept || "";
  const people = () => (S.data.team || []).filter(p => p.status !== "Left").map(p => p.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const isAdmin = () => S.session && S.session.role === "admin";
  const greet = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
  const longDate = () => new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  function toast(msg, bad) {
    const t = document.createElement("div"); t.className = "toast" + (bad ? " bad" : ""); t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 5200 : 2600);
  }

  /* ---------- routing ---------- */
  const route = () => (location.hash || "#overview").slice(1) || "overview";
  window.addEventListener("hashchange", () => { closeSide(); renderPage(); window.scrollTo(0, 0); });

  /* ---------- sign in ---------- */
  function loginView(msg) {
    root.innerHTML = `
    <div class="login">
      <aside class="login-art" aria-hidden="true">
        <svg viewBox="0 0 600 700" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="#3A464E" stroke-width="1">
            ${Array.from({ length: 11 }, (_, i) => `<ellipse cx="300" cy="350" rx="${40 + i * 34}" ry="${260}" />`).join("")}
            ${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${110 + i * 60} Q300 ${80 + i * 60} 600 ${110 + i * 60}" />`).join("")}
          </g>
        </svg>
        <div class="wordmark">${esc(CFG.companyName || "Luxpackers")}<small>Operations desk</small></div>
        <div class="quote">Not just a trip. An experience.</div>
        <div class="foot">For the Luxpackers team only.</div>
      </aside>
      <main class="login-form">
        <form class="login-card" id="loginForm" novalidate>
          <h1>Sign in</h1>
          <p>Use your name and the team code you were given.</p>
          <div class="field"><label for="lname">Your name</label><input class="input" id="lname" autocomplete="name" required value="${esc(localStorage.getItem("luxcrm.lastName") || "")}"></div>
          <div class="field"><label for="lcode">Team code</label><input class="input" id="lcode" type="password" autocomplete="current-password" required></div>
          <div class="err" id="lerr" role="alert">${esc(msg || "")}</div>
          <button class="btn block" type="submit">Continue</button>
          <p class="small muted" style="margin-top:18px">${Store.isShared() ? "Connected to the shared company sheet." : "Working on this computer only until the shared sheet is connected."}</p>
        </form>
      </main>
    </div>`;
    const f = document.getElementById("loginForm");
    document.getElementById(localStorage.getItem("luxcrm.lastName") ? "lcode" : "lname").focus();
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const name = document.getElementById("lname").value.trim(), code = document.getElementById("lcode").value;
      const err = document.getElementById("lerr");
      if (!name || !code) { err.textContent = "Please enter your name and the team code."; return; }
      const btn = f.querySelector("button"); btn.disabled = true; btn.textContent = "Checking…"; err.textContent = "";
      try {
        const role = await Store.signIn(name, code);
        S.session = { name, code, role };
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(S.session)); localStorage.setItem("luxcrm.lastName", name); } catch (_) {}
        await start();
      } catch (ex) {
        btn.disabled = false; btn.textContent = "Continue";
        err.textContent = ex.code === "wrong_code" ? "That team code is not right. Please check with your manager."
          : ex.code === "codes_not_set" ? "The shared sheet has no team codes yet. See README, step 4."
          : "Could not reach the shared sheet. Check the internet connection and try again.";
      }
    });
  }

  function signOut() { try { localStorage.removeItem(SESSION_KEY); } catch (_) {} S.session = null; S.data = null; loginView(); }

  /* ---------- start ---------- */
  async function start() {
    root.innerHTML = `<div class="empty" style="padding-top:30vh">Opening the Luxpackers desk…</div>`;
    try { S.data = await Store.loadAll(S.session); }
    catch (ex) {
      if (ex.code === "wrong_code") { signOut(); return; }
      root.innerHTML = `<div class="empty" style="padding-top:28vh"><h3>The shared sheet could not be reached</h3><p>Check the internet connection, then reload this page.</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return;
    }
    shell(); renderPage();
    if (Store.isShared()) setInterval(refresh, 60000);
  }
  async function refresh() {
    if (document.hidden || S.drawer || !S.session) return;
    try {
      const d = await Store.loadAll(S.session);
      if (JSON.stringify(d) !== JSON.stringify(S.data)) { S.data = d; renderSide(); renderPage(true); }
    } catch (_) {}
  }

  /* ---------- shell ---------- */
  function shell() {
    root.innerHTML = `
    <div class="shell">
      <aside class="side" id="side" aria-label="Main menu"></aside>
      <div class="main">
        <header class="topbar">
          <button class="btn quiet menu-btn" id="menuBtn" aria-label="Open menu">Menu</button>
          <div class="find">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input class="input" id="find" type="search" placeholder="${innerWidth < 600 ? "Find anything" : "Find a task, guest, trip or partner"}" aria-label="Find anything" autocomplete="off">
            <div class="find-results hidden" id="findResults"></div>
          </div>
          <span class="spacer"></span>
          <span class="today">${esc(longDate())}</span>
        </header>
        <main class="page" id="page"></main>
      </div>
    </div>`;
    renderSide();
    document.getElementById("menuBtn").addEventListener("click", () => document.getElementById("side").classList.add("open"));
    const find = document.getElementById("find");
    find.addEventListener("input", () => renderFind(find.value));
    find.addEventListener("focus", () => find.value && renderFind(find.value));
    find.addEventListener("keydown", e => { if (e.key === "Escape") { find.value = ""; renderFind(""); } });
    document.addEventListener("click", e => { if (!e.target.closest(".find")) document.getElementById("findResults")?.classList.add("hidden"); });
  }
  function closeSide() { document.getElementById("side")?.classList.remove("open"); }

  function openCount(m) { return (S.data[m.id] || []).filter(r => isOpen(m, r)).length; }
  function renderSide() {
    const r = route();
    const a = (href, label, count) => `<a href="#${href}" ${r === href ? 'aria-current="page"' : ""}><span>${esc(label)}</span>${count != null ? `<span class="count">${count}</span>` : ""}</a>`;
    const deptOpen = d => (S.data.tasks || []).filter(t => t.dept === d.name && isOpen(MOD.tasks, t)).length;
    document.getElementById("side").innerHTML = `
      <div class="wordmark">${esc(CFG.companyName || "Luxpackers")}<small>Operations desk</small></div>
      <nav class="nav nav-group">${a("overview", "Overview")}</nav>
      <div class="nav-group"><div class="nav-title">Departments</div><nav class="nav">${DEPARTMENTS.map(d => a("dept-" + d.id, d.name, deptOpen(d) || "")).join("")}</nav></div>
      <div class="nav-group"><div class="nav-title">Registers</div><nav class="nav">${MODULES.map(m => a("m-" + m.id, m.name, (m.doneValues || []).length ? openCount(m) || "" : (S.data[m.id] || []).length || "")).join("")}</nav></div>
      <div class="nav-group"><nav class="nav">${a("help", "How to use")}${isAdmin() ? a("settings", "Settings") : ""}</nav></div>
      <div class="side-foot">
        <b>${esc(S.session.name)}</b>${isAdmin() ? "Administrator" : "Team member"}
        <div class="mode ${Store.isShared() ? "shared" : ""}"><i></i>${Store.isShared() ? "Shared company sheet" : "This computer only"}</div>
        <div><button class="btn link" id="signOut">Sign out</button></div>
      </div>`;
    document.getElementById("signOut").addEventListener("click", signOut);
  }

  /* ---------- find anything ---------- */
  function renderFind(q) {
    const box = document.getElementById("findResults"); q = q.trim().toLowerCase();
    if (q.length < 2) { box.classList.add("hidden"); return; }
    const hits = [];
    MODULES.forEach(m => (S.data[m.id] || []).forEach(r => {
      const hay = m.fields.filter(f => ["text", "textarea", "email", "select"].includes(f.type)).map(f => r[f.key] || "").join(" ").toLowerCase();
      if (hay.includes(q)) hits.push({ m, r });
    }));
    box.innerHTML = hits.slice(0, 12).map(h => `<button data-open="${h.m.id}" data-id="${esc(h.r.id)}"><span>${esc(titleOf(h.m, h.r))}</span><span class="small">${esc(h.m.name)}${h.r[h.m.statusKey] ? " · " + esc(h.r[h.m.statusKey]) : ""}</span></button>`).join("")
      || `<div class="empty small" style="padding:18px">Nothing found for “${esc(q)}”.</div>`;
    box.classList.remove("hidden");
  }

  /* ---------- pages ---------- */
  function renderPage(keepScroll) {
    const r = route(), page = document.getElementById("page"); if (!page) return;
    renderSide();
    let html;
    if (r.startsWith("dept-")) html = deptPage(DEPARTMENTS.find(d => d.id === r.slice(5)) || DEPARTMENTS[0]);
    else if (r.startsWith("m-") && MOD[r.slice(2)]) html = modulePage(MOD[r.slice(2)]);
    else if (r === "help") html = helpPage();
    else if (r === "settings" && isAdmin()) html = settingsPage();
    else html = overviewPage();
    page.innerHTML = html;
    document.title = (page.querySelector("h1")?.textContent || "Overview") + " · Luxpackers";
  }

  function figure(num, lbl, sub, cls, href) {
    const inner = `<span class="num">${num}</span><span class="lbl">${esc(lbl)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}`;
    return href ? `<a class="fig ${cls || ""}" href="#${href}">${inner}</a>` : `<div class="fig ${cls || ""}">${inner}</div>`;
  }

  function overviewPage() {
    const d = S.data, T = MOD.tasks, today = todayISO(), month = today.slice(0, 7);
    const openT = d.tasks.filter(t => isOpen(T, t));
    const lateT = openT.filter(t => isLate(T, t));
    const lateLeads = d.leads.filter(l => isLate(MOD.leads, l));
    const waiting = d.tasks.filter(t => t.status === "To be given");
    const activeLeads = d.leads.filter(l => isOpen(MOD.leads, l));
    const pipe = activeLeads.reduce((s, l) => s + (Number(l.quote) || 0), 0);
    const inMonth = d.finance.filter(f => f.flow === "In" && f.status === "Paid" && (f.date || "").startsWith(month)).reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const live = d.trips.filter(t => t.status === "Live").length;
    const totalAll = MODULES.reduce((s, m) => s + (d[m.id] || []).length, 0);

    const attention = [
      ...lateT.map(t => ({ m: T, r: t, why: "Overdue since " + fmtShort(t.due) })),
      ...openT.filter(t => t.status === "Not done" && !isLate(T, t)).map(t => ({ m: T, r: t, why: "Marked not done" })),
      ...lateLeads.map(l => ({ m: MOD.leads, r: l, why: "Follow-up was due " + fmtShort(l.followUp) })),
      ...openT.filter(t => t.priority === "High" && !isLate(T, t) && t.status !== "Not done").map(t => ({ m: T, r: t, why: "High priority · due " + (fmtShort(t.due) || "—") }))
    ].slice(0, 9);

    const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const upcoming = [];
    MODULES.forEach(m => { if (!m.dueKey) return; (d[m.id] || []).forEach(r => { const v = r[m.dueKey]; if (v && v >= today && v <= week && (isOpen(m, r) || m.id === "bookings")) upcoming.push({ m, r, v }); }); });
    upcoming.sort((a, b) => a.v.localeCompare(b.v));

    const welcome = totalAll === 0 ? `<div class="welcome"><div><h2>Welcome to the Luxpackers desk</h2><p>The CRM is empty. ${isAdmin() ? "Load the starting records: the open tasks, the nine trips, the team roles, the access register and the partner hotels." : "Ask an administrator to load the starting records."}</p></div>${isAdmin() ? `<button class="btn" data-act="seed">Load starting records</button>` : ""}</div>` : "";

    return `
      ${welcome}
      <div class="page-head"><div><div class="eyebrow">${esc(longDate())}</div><h1>${greet()}, ${esc(S.session.name.split(" ")[0])}</h1>
        <p>${openT.length} open tasks across the company${lateT.length ? `, ${lateT.length} overdue` : ", none overdue"}. ${live} of ${d.trips.length} trips are live on the website.</p></div>
        <div class="actions"><button class="btn" data-new="tasks">New task</button><button class="btn quiet" data-new="leads">New enquiry</button></div></div>
      <div class="figures">
        ${figure(openT.length, "Open tasks", "", "", "m-tasks")}
        ${figure(lateT.length + lateLeads.length, "Overdue", "tasks and follow-ups", lateT.length + lateLeads.length ? "alert" : "", "m-tasks")}
        ${figure(waiting.length, "To be given", "waiting on someone", waiting.length ? "wait" : "", "m-tasks")}
        ${figure(activeLeads.length, "Open enquiries", pipe ? moneyShort(pipe) + " quoted" : "", "", "m-leads")}
        ${figure(moneyShort(inMonth), "Received this month", "", "", "m-finance")}
        ${figure(`${live}<span style="font-size:.55em;color:var(--faint)"> / ${d.trips.length}</span>`, "Trips live", "", "", "m-trips")}
      </div>
      <div class="grid-2 section">
        <section class="card card-pad"><div class="section-head"><h2>Needs attention</h2><a href="#m-tasks">All tasks</a></div>
          ${attention.length ? `<ul class="attention">${attention.map(x => `<li><div><button class="rowbtn" data-open="${x.m.id}" data-id="${esc(x.r.id)}">${esc(titleOf(x.m, x.r))}</button><div class="small muted">${esc(x.why)} · ${esc(x.r.owner || "No owner")} · ${esc(deptOf(x.m, x.r))}</div></div>${pill(x.m, x.r[x.m.statusKey])}</li>`).join("")}</ul>` : `<p class="muted">Nothing needs attention. Well done.</p>`}
        </section>
        <div style="display:grid;gap:24px;align-content:start">
          <section class="card card-pad"><div class="section-head"><h2>Next seven days</h2></div>
            ${upcoming.length ? `<ul class="upcoming">${upcoming.slice(0, 7).map(x => `<li><div><button class="rowbtn" data-open="${x.m.id}" data-id="${esc(x.r.id)}">${esc(titleOf(x.m, x.r))}</button><div class="small muted">${esc(x.m.name)}</div></div><span class="small nowrap">${esc(fmtShort(x.v))}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing is due in the next seven days.</p>`}
          </section>
          <section class="card card-pad"><div class="section-head"><h2>Latest changes</h2></div>${feed(d.activity.slice(0, 7))}</section>
        </div>
      </div>
      <section class="section"><div class="section-head"><h2>Departments</h2></div>
        <div class="depts">${DEPARTMENTS.map(deptCard).join("")}</div></section>`;
  }

  function feed(list) {
    if (!list.length) return `<p class="muted">No changes yet.</p>`;
    return `<ul class="feed">${list.map(a => {
      const m = MOD[a.collection];
      const what = a.title ? `<button class="rowbtn" style="font-weight:400" ${m && a.action !== "deleted" ? `data-open="${m.id}" data-id="${esc(a.id)}"` : "disabled"}>${esc(a.title)}</button>` : "";
      return `<li><div><span class="who">${esc(a.user || "Someone")}</span> ${esc(a.action || "")} ${what}${m ? `<div class="small muted">${esc(m.name)}</div>` : ""}</div><time datetime="${esc(a.at)}">${esc(ago(a.at))}</time></li>`;
    }).join("")}</ul>`;
  }

  function deptStats(name) {
    const ts = S.data.tasks.filter(t => t.dept === name);
    return { total: ts.length, done: ts.filter(t => t.status === "Done").length, open: ts.filter(t => isOpen(MOD.tasks, t)).length, late: ts.filter(t => isLate(MOD.tasks, t)).length, wait: ts.filter(t => t.status === "To be given").length };
  }
  function deptCard(d) {
    const s = deptStats(d.name), pct = s.total ? Math.round(s.done / s.total * 100) : 0;
    return `<a class="dept" href="#dept-${d.id}"><h3>${esc(d.name)}</h3>
      <div class="row"><span>Open tasks</span><b>${s.open}</b></div>
      <div class="row"><span>Overdue</span><b class="${s.late ? "late" : ""}">${s.late}</b></div>
      <div class="bar" title="${pct}% done"><i style="width:${pct}%"></i></div>
      <div class="row"><span>${s.done} of ${s.total} done</span><span>Lead · ${esc(d.lead)}</span></div></a>`;
  }

  function deptPage(d) {
    const s = deptStats(d.name);
    const regs = d.registers.filter(id => id !== "tasks").map(id => {
      const m = MOD[id];
      return `<section class="section"><div class="section-head"><h2>${esc(m.name)}</h2><a href="#m-${m.id}">Open full register</a></div>${listBlock(m, { scope: m.id + "@" + d.id, limit: 8 })}</section>`;
    }).join("");
    return `
      <div class="page-head"><div><div class="eyebrow">Department · led by ${esc(d.lead)}</div><h1>${esc(d.name)}</h1><p>${esc(d.about)}</p></div>
        <div class="actions"><button class="btn" data-new="tasks" data-preset-dept="${esc(d.name)}">New task</button>${d.registers.filter(x => x !== "tasks").map(x => `<button class="btn quiet" data-new="${x}">New ${esc(MOD[x].singular)}</button>`).join("")}</div></div>
      <div class="figures four">
        ${figure(s.open, "Open tasks")}${figure(s.late, "Overdue", "", s.late ? "alert" : "")}${figure(s.wait, "To be given", "", s.wait ? "wait" : "")}${figure(s.done, "Done", s.total ? Math.round(s.done / s.total * 100) + "% of all tasks" : "")}
      </div>
      <section class="section"><div class="section-head"><h2>Tasks</h2></div>${listBlock(MOD.tasks, { scope: "tasks@" + d.id, dept: d.name })}</section>
      ${regs}`;
  }

  function modulePage(m) {
    const all = S.data[m.id] || [];
    let summary = "";
    if (m.id === "leads") { const open = all.filter(r => isOpen(m, r)); summary = `${open.length} open · ${moneyShort(open.reduce((s, r) => s + (Number(r.quote) || 0), 0))} quoted · ${all.filter(r => r.stage === "Confirmed").length} confirmed`; }
    else if (m.id === "finance") { const inn = all.filter(r => r.flow === "In" && r.status === "Paid").reduce((s, r) => s + (Number(r.amount) || 0), 0), out = all.filter(r => r.flow === "Out" && r.status === "Paid").reduce((s, r) => s + (Number(r.amount) || 0), 0), pend = all.filter(r => r.status === "Pending" || r.status === "Overdue").reduce((s, r) => s + (r.flow === "In" ? 1 : -1) * (Number(r.amount) || 0), 0); summary = `Received ${money(inn)} · Paid out ${money(out)} · Still pending ${money(Math.abs(pend))}`; }
    else if (m.id === "bookings") { const bal = all.filter(r => r.payStatus !== "Cancelled").reduce((s, r) => s + ((Number(r.value) || 0) - (Number(r.received) || 0)), 0); summary = `${all.length} bookings · ${money(bal)} still to be received`; }
    else if (m.id === "trips") { summary = `${all.filter(r => r.status === "Live").length} of ${all.length} live on the website`; }
    return `
      <div class="page-head"><div><div class="eyebrow">${m.dept ? "Register · " + esc(m.dept) : "Register · all departments"}</div><h1>${esc(m.name)}</h1><p>${esc(m.intro)}${summary ? `<br><span style="color:var(--text)">${esc(summary)}</span>` : ""}</p></div>
        <div class="actions"><button class="btn" data-new="${m.id}">New ${esc(m.singular)}</button></div></div>
      ${m.id === "access" ? `<div class="notice red"><b>Never write a password, OTP, API key or card number in this CRM.</b> Record only who holds a login and where it is kept.</div>` : ""}
      ${listBlock(m, { scope: m.id })}`;
  }

  /* ---------- list block (toolbar + table) ---------- */
  function filt(scope) { return S.filters[scope] || (S.filters[scope] = { q: "", status: "", extra: {} }); }

  function listBlock(m, opt) {
    return `<div class="card" id="blk-${esc(opt.scope)}" data-scope="${esc(opt.scope)}" data-mod="${m.id}" data-dept="${esc(opt.dept || "")}" data-limit="${opt.limit || ""}">${listInner(m, opt)}</div>`;
  }

  function rowsFor(m, opt) {
    const f = filt(opt.scope), q = f.q.trim().toLowerCase();
    let rows = (S.data[m.id] || []).slice();
    if (opt.dept) rows = rows.filter(r => r.dept === opt.dept);
    const base = rows;
    if (f.status) rows = rows.filter(r => (f.status === "__open" ? isOpen(m, r) : f.status === "__late" ? isLate(m, r) : r[m.statusKey] === f.status));
    Object.entries(f.extra).forEach(([k, v]) => { if (v) rows = rows.filter(r => (r[k] || "") === v); });
    if (q) rows = rows.filter(r => m.fields.some(fd => ["text", "textarea", "email", "select", "person"].includes(fd.type) && String(r[fd.key] || "").toLowerCase().includes(q)));
    const so = S.sort[opt.scope];
    const order = m.statuses.map(s => s.v);
    rows.sort((a, b) => {
      if (so) {
        const fd = fieldOf(m, so.key) || {}; let x = a[so.key], y = b[so.key];
        if (fd.type === "computed") { x = fd.calc(a); y = fd.calc(b); }
        if (fd.type === "money" || fd.type === "number" || fd.type === "computed") { x = Number(x) || 0; y = Number(y) || 0; return so.dir === "asc" ? x - y : y - x; }
        if (fd.type === "checklist") { x = (x || []).length; y = (y || []).length; return so.dir === "asc" ? x - y : y - x; }
        x = String(x || ""); y = String(y || ""); return so.dir === "asc" ? x.localeCompare(y) : y.localeCompare(x);
      }
      const oa = isOpen(m, a) ? 0 : 1, ob = isOpen(m, b) ? 0 : 1; if (oa !== ob) return oa - ob;
      if (m.dueKey) { const da = a[m.dueKey] || "9999", db = b[m.dueKey] || "9999"; if (da !== db) return da.localeCompare(db); }
      return order.indexOf(a[m.statusKey]) - order.indexOf(b[m.statusKey]) || String(titleOf(m, a)).localeCompare(String(titleOf(m, b)));
    });
    return { rows, base };
  }

  function listInner(m, opt) {
    const f = filt(opt.scope);
    const { rows, base } = rowsFor(m, opt);
    const limit = Number(opt.limit) || 0, shown = limit ? rows.slice(0, limit) : rows;
    const cnt = v => base.filter(r => r[m.statusKey] === v).length;
    const hasOpenDone = (m.doneValues || []).length;
    const lateN = base.filter(r => isLate(m, r)).length;
    const chips = [`<button class="chip" data-chip="" aria-pressed="${!f.status}">All<b>${base.length}</b></button>`]
      .concat(hasOpenDone ? [`<button class="chip" data-chip="__open" aria-pressed="${f.status === "__open"}">Open<b>${base.filter(r => isOpen(m, r)).length}</b></button>`] : [])
      .concat(lateN ? [`<button class="chip" data-chip="__late" aria-pressed="${f.status === "__late"}">Overdue<b>${lateN}</b></button>`] : [])
      .concat(m.statuses.map(s => `<button class="chip" data-chip="${esc(s.v)}" aria-pressed="${f.status === s.v}">${esc(s.v)}<b>${cnt(s.v)}</b></button>`));
    const extraFilters = (m.filters || []).filter(k => !(opt.dept && k === "dept")).map(k => {
      const fd = fieldOf(m, k) || { label: k };
      let opts = fd.options || [...new Set((S.data[m.id] || []).map(r => r[k]).filter(Boolean))].sort();
      if (fd.type === "person") opts = [...new Set([...people(), ...(S.data[m.id] || []).map(r => r.owner).filter(Boolean)])].sort();
      return `<select class="input" data-extra="${k}" aria-label="${esc(fd.label)}"><option value="">${esc(fd.type === "person" ? "Everyone" : "Any " + fd.label.toLowerCase())}</option>${opts.map(o => `<option ${f.extra[k] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    }).join("");
    const so = S.sort[opt.scope];
    const cols = m.columns.filter(k => !(opt.dept && k === "dept"));
    const th = cols.map(k => { const fd = fieldOf(m, k) || { label: k }; const num = ["money", "number", "computed"].includes(fd.type); return `<th class="${num ? "num" : ""}"><button data-sort="${k}" ${so && so.key === k ? `data-dir="${so.dir}"` : ""}>${esc(k === m.titleKey ? fd.label : fd.label)}</button></th>`; }).join("");
    const body = shown.map(r => `<tr tabindex="0" data-open="${m.id}" data-id="${esc(r.id)}">${cols.map((k, i) => cell(m, r, k, i)).join("")}</tr>`).join("");
    const empty = !base.length
      ? `<div class="empty"><h3>No ${esc(m.name.toLowerCase())} yet</h3><p>Add the first ${esc(m.singular)} and it will appear here for the whole team.</p><button class="btn" data-new="${m.id}" ${opt.dept ? `data-preset-dept="${esc(opt.dept)}"` : ""}>New ${esc(m.singular)}</button></div>`
      : `<div class="empty"><p>Nothing matches these filters.</p><button class="btn quiet" data-clear="1">Clear filters</button></div>`;
    return `
      ${limit ? "" : `<div class="toolbar"><input class="input q" type="search" data-q placeholder="Search ${esc(m.name.toLowerCase())}" value="${esc(f.q)}" aria-label="Search ${esc(m.name)}">${extraFilters}</div>`}
      ${limit ? "" : `<div class="chips" role="group" aria-label="Filter by status">${chips.join("")}</div>`}
      ${shown.length ? `<div class="table-wrap"><table class="stack"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>` : empty}
      ${limit && rows.length > limit ? `<div class="list-foot"><span>Showing ${limit} of ${rows.length}</span><a href="#m-${m.id}">See all</a></div>` : ""}`;
  }

  function cell(m, r, k, i) {
    const fd = fieldOf(m, k) || { type: "text", label: k };
    const L = esc(fd.label);
    if (i === 0 || k === m.titleKey) {
      const meta = r.notes ? `<div class="t-meta">${esc(r.notes)}</div>` : "";
      const v = fd.type === "date" ? fmtDate(r[k]) : esc(r[k] || "");
      return k === m.titleKey ? `<td data-l="${L}"><div class="t-title">${esc(titleOf(m, r))}</div>${meta}</td>` : `<td data-l="${L}" class="nowrap">${v}</td>`;
    }
    switch (fd.type) {
      case "status":
        return `<td data-l="${L}"><select class="pill-select tone-${toneOf(m, r[k])}" data-quick="${k}" aria-label="Change ${L}">${m.statuses.map(s => `<option ${r[k] === s.v ? "selected" : ""}>${esc(s.v)}</option>`).join("")}${r[k] && !m.statuses.some(s => s.v === r[k]) ? `<option selected>${esc(r[k])}</option>` : ""}</select></td>`;
      case "date": return `<td data-l="${L}" class="nowrap ${k === m.dueKey && isLate(m, r) ? "late" : ""}">${fmtDate(r[k])}</td>`;
      case "money": return `<td data-l="${L}" class="num">${money(r[k])}</td>`;
      case "number": return `<td data-l="${L}" class="num">${esc(r[k] || "")}</td>`;
      case "computed": { const v = fd.calc(r); return `<td data-l="${L}" class="num ${v > 0 ? "" : "muted"}">${fd.format === "money" ? money(v) : esc(v)}</td>`; }
      case "links": { const ls = (r.links || []).filter(x => safeUrl(x.url)); return `<td data-l="${L}">${ls.length ? `<a class="lnk" href="${esc(safeUrl(ls[0].url))}" target="_blank" rel="noopener noreferrer">${esc(ls[0].label || "Open link")} ↗</a>${ls.length > 1 ? `<span class="small muted"> +${ls.length - 1}</span>` : ""}` : ""}</td>`; }
      case "checklist": { const n = (r[k] || []).length, tot = fd.options.length; return `<td data-l="${L}"><div class="steps"><span class="small">${n} of ${tot}</span><div class="bar"><i style="width:${n / tot * 100}%"></i></div></div></td>`; }
      case "select": return `<td data-l="${L}" class="${k === "priority" && r[k] === "High" ? "late" : ""}">${esc(r[k] || "")}</td>`;
      default: return `<td data-l="${L}">${esc(r[k] || "")}</td>`;
    }
  }

  function rerenderBlock(scope) {
    const el = document.getElementById("blk-" + scope); if (!el) return;
    const m = MOD[el.dataset.mod];
    const active = document.activeElement && el.contains(document.activeElement) && document.activeElement.matches("[data-q]");
    el.innerHTML = listInner(m, { scope, dept: el.dataset.dept || "", limit: el.dataset.limit });
    if (active) { const q = el.querySelector("[data-q]"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  /* ---------- drawer (view / edit) ---------- */
  function openDrawer(modId, id, preset) {
    const m = MOD[modId]; if (!m) return;
    const existing = id ? (S.data[m.id] || []).find(r => r.id === id) : null;
    if (id && !existing) { toast("That record no longer exists."); return; }
    const rec = existing ? JSON.parse(JSON.stringify(existing)) : Object.assign({ links: [] }, preset || {});
    if (!existing) {
      if (m.statuses.length) rec[m.statusKey] = rec[m.statusKey] || m.statuses[0].v;
      if (m.dept && fieldOf(m, "dept") && !rec.dept) rec.dept = m.dept;
      if (fieldOf(m, "owner") && !rec.owner) rec.owner = people().includes(S.session.name) ? S.session.name : "";
      if (m.id === "tasks" && !rec.priority) rec.priority = "Medium";
      if (m.id === "finance" && !rec.flow) rec.flow = "In";
      if (m.id === "finance" && !rec.date) rec.date = todayISO();
    }
    S.drawer = { m, rec, isNew: !existing, oldName: existing && m.id === "team" ? existing.name : null };
    const scrim = document.createElement("div"); scrim.className = "scrim"; scrim.id = "scrim";
    scrim.innerHTML = `<section class="drawer" role="dialog" aria-modal="true" aria-labelledby="dTitle">
      <div class="drawer-head"><div class="eyebrow">${esc(m.name)}${existing ? "" : " · new"}</div><h2 id="dTitle">${existing ? esc(titleOf(m, existing)) : "New " + esc(m.singular)}</h2></div>
      <div class="drawer-body"><form class="form" id="dForm" novalidate></form>${existing ? historyHtml(m, existing) : ""}</div>
      <div class="drawer-foot"><div>${existing && isAdmin() ? `<button class="btn quiet" data-del>Delete</button>` : ""}</div>
        <div class="actions"><button class="btn quiet" data-cancel>Cancel</button><button class="btn" data-save>${existing ? "Save changes" : "Add " + esc(m.singular)}</button></div></div></section>`;
    document.body.appendChild(scrim);
    renderForm();
    scrim.querySelector("input,select,textarea")?.focus();
    scrim.addEventListener("click", e => { if (e.target === scrim) closeDrawer(); });
    scrim.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });
  }

  function historyHtml(m, r) {
    const items = S.data.activity.filter(a => a.collection === m.id && a.id === r.id).slice(0, 8);
    const created = r.createdAt ? `Added ${ago(r.createdAt)}${r.createdBy ? " by " + r.createdBy : ""}` : "";
    return `<div class="history"><span class="flabel">History</span><ul>${items.map(a => `<li>${esc(a.user)} ${esc(a.action)} · ${esc(ago(a.at))}</li>`).join("")}${created ? `<li>${esc(created)}</li>` : ""}${!items.length && !created ? "<li>No history yet.</li>" : ""}</ul></div>`;
  }

  function renderForm() {
    const { m, rec } = S.drawer, form = document.getElementById("dForm");
    form.innerHTML = m.fields.filter(f => !f.showIf || f.showIf(rec)).map(f => fieldHtml(m, f, rec)).join("");
  }

  function fieldHtml(m, f, r) {
    const id = "f_" + f.key, v = r[f.key], req = f.required ? " *" : "", wide = f.wide || ["textarea", "links", "checklist", "status"].includes(f.type) ? " wide" : "";
    const help = f.help ? `<span class="help">${esc(f.help)}</span>` : "";
    const wrap = inner => `<div class="field${wide}"><label class="flabel" for="${id}">${esc(f.label)}${req}</label>${inner}${help}</div>`;
    switch (f.type) {
      case "textarea": return wrap(`<textarea class="input" id="${id}" data-k="${f.key}">${esc(v || "")}</textarea>`);
      case "select": return wrap(`<select class="input" id="${id}" data-k="${f.key}"><option value="">—</option>${f.options.map(o => `<option ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}${v && !f.options.includes(v) ? `<option selected>${esc(v)}</option>` : ""}</select>`);
      case "person": { const ps = people(); return wrap(`<select class="input" id="${id}" data-k="${f.key}"><option value="">No owner yet</option>${ps.map(o => `<option ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}${v && !ps.includes(v) ? `<option selected>${esc(v)}</option>` : ""}</select>`); }
      case "date": return wrap(`<input class="input" type="date" id="${id}" data-k="${f.key}" value="${esc(v || "")}">`);
      case "money": case "number": return wrap(`<input class="input" type="number" inputmode="numeric" min="0" step="1" id="${id}" data-k="${f.key}" value="${esc(v == null ? "" : v)}">`);
      case "email": return wrap(`<input class="input" type="email" id="${id}" data-k="${f.key}" value="${esc(v || "")}">`);
      case "computed": { const x = f.calc(r); return wrap(`<div class="readonly" id="${id}">${f.format === "money" ? money(x) || "₹0" : esc(x)}</div>`); }
      case "status": return `<div class="field wide"><span class="flabel">${esc(f.label)}</span><div class="statuses" role="radiogroup" aria-label="${esc(f.label)}">${m.statuses.map((s, i) => `<label title="${esc(s.hint || "")}"><input type="radio" name="${id}" data-k="${f.key}" value="${esc(s.v)}" ${v === s.v ? "checked" : ""}><span class="pill tone-${s.tone}">${esc(s.v)}</span></label>`).join("")}</div>${m.statuses.find(s => s.v === v && s.hint) ? `<span class="help">${esc(m.statuses.find(s => s.v === v).hint)}</span>` : ""}</div>`;
      case "checklist": return `<div class="field wide"><span class="flabel">${esc(f.label)}</span><div class="checks">${f.options.map(o => `<label class="check"><input type="checkbox" data-check="${f.key}" value="${esc(o)}" ${(v || []).includes(o) ? "checked" : ""}>${esc(o)}</label>`).join("")}</div></div>`;
      case "links": {
        const ls = (v && v.length ? v : []);
        return `<div class="field wide"><span class="flabel">${esc(f.label)}</span><div class="links-edit" id="linksEdit">${ls.map((l, i) => linkRow(l, i)).join("")}</div>
          <div><button type="button" class="btn quiet" data-addlink style="margin-top:8px">Add a link</button></div>${help}</div>`;
      }
      default: return wrap(`<input class="input" id="${id}" data-k="${f.key}" value="${esc(v || "")}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ""}>`);
    }
  }
  const linkRow = (l, i) => `<div class="link-row" data-li="${i}"><input class="input" placeholder="Name, e.g. Quote PDF" value="${esc(l.label || "")}" data-lk="label" aria-label="Link name"><input class="input" placeholder="https://…" value="${esc(l.url || "")}" data-lk="url" type="url" aria-label="Link address"><button type="button" class="x" data-rmlink aria-label="Remove link">✕</button></div>`;

  function readForm() {
    const { m, rec } = S.drawer, form = document.getElementById("dForm");
    form.querySelectorAll("[data-k]").forEach(el => {
      const k = el.dataset.k, fd = fieldOf(m, k);
      if (el.type === "radio") { if (el.checked) rec[k] = el.value; return; }
      let v = el.value; if (fd && (fd.type === "money" || fd.type === "number")) v = v === "" ? "" : Number(v);
      else v = String(v).trim();
      rec[k] = v;
    });
    m.fields.filter(f => f.type === "checklist").forEach(f => { rec[f.key] = [...form.querySelectorAll(`[data-check="${f.key}"]:checked`)].map(x => x.value); });
    if (form.querySelector("#linksEdit")) rec.links = [...form.querySelectorAll(".link-row")].map(row => ({ label: row.querySelector('[data-lk="label"]').value.trim(), url: row.querySelector('[data-lk="url"]').value.trim() })).filter(l => l.label || l.url);
    return rec;
  }

  function closeDrawer() { document.getElementById("scrim")?.remove(); S.drawer = null; }

  async function saveDrawer(btn) {
    const { m, isNew, oldName } = S.drawer;
    const rec = readForm();
    for (const f of m.fields) if (f.required && (rec[f.key] === "" || rec[f.key] == null)) { toast(`Please fill in “${f.label}”.`, true); document.getElementById("f_" + f.key)?.focus(); return; }
    const bad = (rec.links || []).find(l => l.url && !safeUrl(l.url));
    if (bad) { toast("Each link must start with https://", true); return; }
    const prev = isNew ? null : (S.data[m.id] || []).find(r => r.id === rec.id);
    const now = new Date().toISOString();
    if (isNew) { rec.id = uid(m.id.slice(0, 2)); rec.createdAt = now; rec.createdBy = S.session.name; }
    rec.updatedAt = now; rec.updatedBy = S.session.name;
    let what = isNew ? "added" : "updated";
    if (prev && prev[m.statusKey] !== rec[m.statusKey]) what = "marked as “" + rec[m.statusKey] + "”";
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await persist(m, rec, what);
      if (m.id === "team" && oldName && oldName !== rec.name) await renameOwner(oldName, rec.name);
      closeDrawer(); toast(isNew ? "Added." : "Saved."); renderPage(true);
    } catch (ex) { btn.disabled = false; btn.textContent = "Try again"; toast(ex.message === "storage_full" ? "This computer's storage is full. Connect the shared sheet." : "Could not save. Check the connection and try again.", true); }
  }

  async function persist(m, rec, what) {
    const copy = JSON.parse(JSON.stringify(rec)); copy.__title = titleOf(m, rec);
    if (Store.isShared()) {
      await Store.save(S.session, S.data, m.id, copy, what);
      const list = S.data[m.id], i = list.findIndex(x => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec);
      S.data.activity.unshift({ at: new Date().toISOString(), user: S.session.name, action: what, collection: m.id, id: rec.id, title: titleOf(m, rec) });
    } else {
      await Store.save(S.session, S.data, m.id, copy, what);
    }
  }

  async function renameOwner(oldName, newName) {
    for (const m of MODULES) {
      if (!fieldOf(m, "owner")) continue;
      for (const r of (S.data[m.id] || []).filter(x => x.owner === oldName)) {
        const c = Object.assign({}, r, { owner: newName, updatedAt: new Date().toISOString(), updatedBy: S.session.name });
        await persist(m, c, "changed owner to " + newName);
      }
    }
  }

  async function quickStatus(m, id, value, sel) {
    const r = (S.data[m.id] || []).find(x => x.id === id); if (!r || r[m.statusKey] === value) return;
    const c = Object.assign({}, r, { [m.statusKey]: value, updatedAt: new Date().toISOString(), updatedBy: S.session.name });
    sel.disabled = true;
    try { await persist(m, c, "marked as “" + value + "”"); toast(`Marked as “${value}”.`); renderPage(true); }
    catch (_) { sel.disabled = false; sel.value = r[m.statusKey]; toast("Could not save. Check the connection and try again.", true); }
  }

  async function deleteRecord(btn) {
    const { m, rec } = S.drawer;
    if (!btn.dataset.armed) { btn.dataset.armed = "1"; btn.textContent = "Click again to delete"; btn.classList.add("danger"); return; }
    btn.disabled = true;
    try {
      await Store.remove(S.session, S.data, m.id, rec.id, titleOf(m, rec));
      if (Store.isShared()) { S.data[m.id] = S.data[m.id].filter(x => x.id !== rec.id); S.data.activity.unshift({ at: new Date().toISOString(), user: S.session.name, action: "deleted", collection: m.id, id: rec.id, title: titleOf(m, rec) }); }
      closeDrawer(); toast("Deleted."); renderPage(true);
    } catch (_) { btn.disabled = false; toast("Could not delete. Only administrators can delete.", true); }
  }

  /* ---------- starting records ---------- */
  async function loadSeed(btn) {
    if (!isAdmin()) return;
    const now = new Date().toISOString(), seed = window.LUX_SEED, records = {};
    Object.keys(seed).forEach(c => { if (!MOD[c]) return; records[c] = seed[c].map((r, i) => Object.assign({ id: c.slice(0, 2) + "seed" + String(i + 1).padStart(3, "0"), createdAt: now, createdBy: "Setup", updatedAt: now, updatedBy: "Setup" }, JSON.parse(JSON.stringify(r)))); });
    btn.disabled = true; btn.textContent = "Loading…";
    try { await Store.bulk(S.session, S.data, records); S.data = await Store.loadAll(S.session); toast("Starting records loaded."); renderPage(); }
    catch (_) { btn.disabled = false; btn.textContent = "Load starting records"; toast("Could not load the records. Try again.", true); }
  }

  /* ---------- help & settings ---------- */
  function helpPage() {
    const T = MOD.tasks;
    return `<div class="page-head"><div><div class="eyebrow">Guide</div><h1>How to use the desk</h1><p>Five minutes to read. Everything here is written for people who are not technical.</p></div></div>
    <div class="card card-pad prose">
      <h2>The idea</h2>
      <p>Everything the company has to do lives here, in one place. Each item has <b>one owner</b>, <b>one date</b> and <b>one status</b>. When something changes, change it here the same day, so the CEO, CFO and CTO always see the truth without asking.</p>
      <h2>What the task statuses mean</h2>
      <ul>${T.statuses.map(s => `<li>${pill(T, s.v)} — ${esc(s.hint)}</li>`).join("")}</ul>
      <h2>Everyday steps</h2>
      <ol>
        <li><b>Find your work:</b> open your department on the left, or open Tasks and choose your name in the “Everyone” list.</li>
        <li><b>Change a status:</b> click the coloured status in any list and pick the new one. It saves straight away.</li>
        <li><b>Edit anything:</b> click a row. A panel opens on the right. Change what you need and press <b>Save changes</b>.</li>
        <li><b>Add a link:</b> in that panel press <b>Add a link</b>, give it a name (for example “Quote PDF”) and paste the address. Links must start with https://.</li>
        <li><b>Waiting on someone?</b> Set the status to <b>To be given</b> and write who must give it in “Waiting on”.</li>
        <li><b>Stuck or late?</b> Set <b>Not done</b> and write why in the notes. That is not a failure — it tells the managers where to help.</li>
        <li><b>Find anything:</b> type in the search box at the top: a guest's name, a trip, a partner.</li>
      </ol>
      <h2>Each register</h2>
      <ul>${MODULES.map(m => `<li><a href="#m-${m.id}">${esc(m.name)}</a> — ${esc(m.intro)}</li>`).join("")}</ul>
      <h2>The Monday review (15 minutes)</h2>
      <ol><li>Open <a href="#overview">Overview</a>.</li><li>Go through “Needs attention” from top to bottom. Give every item an owner and a new date, or mark it done.</li><li>Open each department card and check the overdue number is zero.</li><li>Finance checks <a href="#m-bookings">Bookings</a> for balances still to be received.</li></ol>
      <h2>Two rules</h2>
      <ul><li><b>No passwords, OTPs or card numbers</b> anywhere in this CRM. The Access register records only who holds a login and where it is kept.</li><li><b>Only administrators can delete.</b> If something was added by mistake, change its status or ask an administrator.</li></ul>
    </div>`;
  }

  function settingsPage() {
    const shared = Store.isShared(), total = MODULES.reduce((s, m) => s + (S.data[m.id] || []).length, 0);
    return `<div class="page-head"><div><div class="eyebrow">Administrator</div><h1>Settings</h1><p>Where the data is kept, starting records and backups.</p></div></div>
      <div class="card card-pad prose">
        <h2>Where the data is kept</h2>
        ${shared ? `<p>Connected to the <b>shared Google Sheet</b>. Every change is saved there and everyone sees the same records. The sheet's “Records” tab holds the data and the “Activity” tab keeps a log of every change.</p>`
        : `<div class="notice">This CRM is saving <b>on this computer only</b>. Other people will not see these records. To share it with the whole team, follow the README section “Connect the shared Google Sheet”, then put the web-app address in <span class="kbd">config.js</span>.</div>`}
        <h2>Starting records</h2>
        <p>${total} records in the CRM.</p>
        ${total === 0 ? `<button class="btn" data-act="seed">Load starting records</button>` : `<p class="muted small">Starting records can only be loaded into an empty CRM.</p>`}
        <h2>Backup</h2>
        <p>Download a copy of every record as a file. Keep one each month.</p>
        <button class="btn quiet" data-act="export">Download backup</button>
        ${shared ? "" : `<h2>Restore on this computer</h2><p>Replace the records on this computer with a backup file.</p><input type="file" accept="application/json,.json" id="importFile" class="input" style="max-width:360px">
        <h2>Start over</h2><p>Remove every record from this computer.</p><button class="btn quiet" data-act="reset">Remove all records on this computer</button>`}
      </div>`;
  }

  /* ---------- events ---------- */
  document.addEventListener("click", async e => {
    const t = e.target;
    if (t.closest(".pill-select") || t.closest("a[href^='http']")) return;
    const nw = t.closest("[data-new]"); if (nw) { const p = nw.dataset.presetDept ? { dept: nw.dataset.presetDept } : {}; openDrawer(nw.dataset.new, null, p); return; }
    const op = t.closest("[data-open]"); if (op && !t.closest(".scrim")) { document.getElementById("findResults")?.classList.add("hidden"); openDrawer(op.dataset.open, op.dataset.id); return; }
    const blk = t.closest("[data-scope]");
    if (blk) {
      const scope = blk.dataset.scope, f = filt(scope);
      const chip = t.closest("[data-chip]"); if (chip) { f.status = chip.dataset.chip; rerenderBlock(scope); return; }
      const sb = t.closest("[data-sort]"); if (sb) { const cur = S.sort[scope]; S.sort[scope] = { key: sb.dataset.sort, dir: cur && cur.key === sb.dataset.sort && cur.dir === "desc" ? "asc" : "desc" }; rerenderBlock(scope); return; }
      if (t.closest("[data-clear]")) { S.filters[scope] = { q: "", status: "", extra: {} }; rerenderBlock(scope); return; }
    }
    if (t.closest("[data-cancel]")) { closeDrawer(); return; }
    const sv = t.closest("[data-save]"); if (sv) { saveDrawer(sv); return; }
    const dl = t.closest("[data-del]"); if (dl) { deleteRecord(dl); return; }
    if (t.closest("[data-addlink]")) { const box = document.getElementById("linksEdit"); box.insertAdjacentHTML("beforeend", linkRow({}, box.children.length)); box.lastElementChild.querySelector("input").focus(); return; }
    const rm = t.closest("[data-rmlink]"); if (rm) { rm.closest(".link-row").remove(); return; }
    const act = t.closest("[data-act]");
    if (act) {
      if (act.dataset.act === "seed") return loadSeed(act);
      if (act.dataset.act === "export") { const blob = new Blob([Store.exportJson(S.data)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "luxpackers-crm-backup-" + todayISO() + ".json"; document.body.appendChild(a); a.click(); a.remove(); return; }
      if (act.dataset.act === "reset") { if (!act.dataset.armed) { act.dataset.armed = "1"; act.textContent = "Click again to remove everything"; act.classList.add("danger"); return; } Store.resetLocal(); S.data = await Store.loadAll(S.session); toast("All records removed from this computer."); renderPage(); return; }
    }
    if (!t.closest(".side") && !t.closest(".menu-btn")) closeSide();
  });

  document.addEventListener("change", e => {
    const t = e.target;
    const q = t.closest(".pill-select"); if (q) { const tr = q.closest("tr"); quickStatus(MOD[tr.dataset.open], tr.dataset.id, q.value, q); return; }
    const ex = t.closest("[data-extra]"); if (ex) { const scope = ex.closest("[data-scope]").dataset.scope; filt(scope).extra[ex.dataset.extra] = ex.value; rerenderBlock(scope); return; }
    if (S.drawer && t.closest("#dForm") && (t.type === "radio" || t.dataset.k === "value" || t.dataset.k === "received")) { readForm(); renderForm(); const el = document.querySelector(`#dForm [data-k="${t.dataset.k}"]${t.type === "radio" ? ":checked" : ""}`); el && el.focus(); return; }
    if (t.id === "importFile" && t.files[0]) { const rd = new FileReader(); rd.onload = () => { try { S.data = Store.importLocal(String(rd.result)); toast("Backup restored."); renderPage(); } catch (_) { toast("That file is not a CRM backup.", true); } }; rd.readAsText(t.files[0]); }
  });

  let qTimer;
  document.addEventListener("input", e => {
    const q = e.target.closest("[data-q]"); if (!q) return;
    const scope = q.closest("[data-scope]").dataset.scope; clearTimeout(qTimer);
    qTimer = setTimeout(() => { filt(scope).q = q.value; rerenderBlock(scope); }, 200);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("tbody tr, tbody tr *") && !e.target.matches("select")) { const tr = e.target.closest("tr"); openDrawer(tr.dataset.open, tr.dataset.id); }
  });

  /* ---------- boot ---------- */
  try { S.session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (_) {}
  if (S.session && S.session.name && S.session.code) start(); else loginView();
})();
