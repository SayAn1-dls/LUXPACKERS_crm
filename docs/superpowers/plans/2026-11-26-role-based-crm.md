# Luxpackers CRM v2 (Cloudflare, role dashboards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared-code Google-Sheet CRM with per-person accounts, server-enforced roles (admin, manager, hr, employee) and a home dashboard per role, on Cloudflare Workers + D1.

**Architecture:** One Worker runs a Hono API under `/api/*` and serves the Vite-built React app as static assets (SPA fallback). D1 holds real tables for users, sessions, tasks, leave, onboarding, notifications, audit and settings, plus one generic `records` table for the travel registers whose fields stay defined in a shared schema module. Every route goes session → `policy.ts` → role-scoped SQL.

**Tech Stack:** TypeScript 5, Hono 4, Zod 4, D1, Wrangler 4, `@cloudflare/vite-plugin` 1, Vite 8, React 19, React Router 7, TanStack Query 5, Vitest 4 + `@cloudflare/vitest-pool-workers` 0.23.

**Spec:** `docs/superpowers/specs/2026-11-26-role-based-crm-design.md` (read sections 7, 8, 10 and 13 before any task).

## Global Constraints

- Roles exactly: `admin`, `manager`, `hr`, `employee`. Task statuses exactly: `To do`, `In progress`, `Waiting`, `Blocked`, `Submitted`, `Done`.
- Passwords: PBKDF2-SHA256, **100,000** iterations, 16-byte random salt, constant-time compare. Never log or return hashes.
- Session cookie `lux_session`: `HttpOnly; Secure; SameSite=Lax; Path=/`, 14 days sliding; DB stores only SHA-256 of the token.
- Login lock: 5 failed attempts per email per 15 minutes → `429`.
- Non-GET `/api/*` requires `Content-Type: application/json` and an `Origin` equal to the request's own origin → else `403`.
- `created_by`, `updated_by`, `assigned_by_id`, `decided_by` and all audit rows are set by the server from the session, never from the body. Zod schemas strip unknown keys.
- "Today" is computed in **Asia/Kolkata**; dates are `YYYY-MM-DD` strings.
- Updates send `version`; mismatch → `409 {error:"conflict"}`.
- Copy is plain English for non-technical staff, in the tone of the current app. House style: ink `#11181C`, paper `#F6F5F1`, accent `#7A2333`, Cormorant Garamond titles, Jost body. **No purple, no gradients, no UI kit.**
- Never store passwords/OTPs/card numbers; the Access register keeps its red warning.
- Commits carry no AI co-author or attribution lines.

## Review Focus

1. An employee calling `/api/records/finance` or `/api/users` directly → 403, even though the UI hides them (Task 6, Task 4 tests).
2. Two people editing the same task/record → second save gets 409 and the UI says "Someone else changed this. Reload to see their change." (Task 5, 6, 12).
3. A user set to `left` while their browser is open → next request 401 and the app returns to sign-in (Task 4).
4. Leave across a weekend, a holiday, a half day, and more days than remain → correct `days`, and a 400 "Not enough Casual leave left (2 days)." (Task 7).
5. An assignee who is also a manager trying to approve their own submitted task → 403; only assigner / another dept manager / admin may approve (Task 5).

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, wrangler.jsonc
shared/schema.ts            DEPARTMENTS, REGISTERS (ported MODULES minus tasks/team), TASK_STATUSES, ROLES, ONBOARDING_STEPS, types
worker/migrations/0001_init.sql
worker/src/index.ts         Hono app: middleware, route mounting, 404 JSON for /api, assets fallback
worker/src/env.ts           Env { DB: D1Database; ASSETS: Fetcher }, AppContext type with c.var.user
worker/src/lib/crypto.ts    hashPassword, verifyPassword, randomToken, sha256Hex
worker/src/lib/session.ts   createSession, readSession middleware, destroySessions, requireUser
worker/src/lib/policy.ts    pure permission functions (no DB)
worker/src/lib/dates.ts     todayIST, leaveDays
worker/src/lib/audit.ts     audit(db, user, action, entity, id, title, detail?)
worker/src/lib/notify.ts    notify(db, userIds, kind, title, link)
worker/src/routes/{auth,setup,users,people,tasks,records,leave,onboarding,notifications,dashboard,search,audit,settings,import}.ts
worker/test/helpers.ts      applyMigrations, makeUser(role, dept, opts) → {user, cookie}, api(cookie, method, path, body)
worker/test/*.test.ts
web/index.html
web/src/main.tsx, api.ts, auth.tsx, styles.css, router.tsx
web/src/components/{Shell,Sidebar,RecordTable,RecordDrawer,TaskDrawer,TaskList,NotificationBell,Search,Figure,Pill}.tsx
web/src/pages/{Login,Setup,ChangePassword,Tasks,Register,People,Leave,Users,Audit,Import,Settings,Trash,Help}.tsx
web/src/dashboards/{EmployeeHome,ManagerHome,HrHome,AdminHome}.tsx
legacy/                     old index.html, config.js, assets/, google-apps-script/ (moved, kept read-only until cut-over)
```

---

### Task 1: Scaffold, database schema, shared schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vite.config.ts`, `vitest.config.ts`, `worker/migrations/0001_init.sql`, `shared/schema.ts`, `worker/src/index.ts`, `worker/src/env.ts`, `worker/test/helpers.ts`, `worker/test/schema.test.ts`, `web/index.html`, `web/src/main.tsx`
- Move: `index.html config.js assets google-apps-script` → `legacy/`

**Interfaces:**
- Produces: `Env`, `AppContext`; `app` (Hono) default export with `fetch`; tables listed below; `shared/schema.ts` exports `ROLES`, `TASK_STATUSES`, `DEPARTMENTS: {id,name,about,registers:string[]}[]`, `REGISTERS: RegisterDef[]` (`{id,name,singular,intro,titleKey,statusKey,statuses,columns,filters,fields,dueKey?,doneValues}` exactly as `legacy/assets/schema.js` minus `tasks` and `team`, minus `owner` fields of type `person` which become `owner_id`), `ONBOARDING_STEPS` (6 strings, spec §13.6), `registerDepts(registerId): string[]`.
- Test helper: `applyMigrations(env)`, `makeUser(role, deptName, {managerId?, status?}) → Promise<{id:string, cookie:string}>`, `api(cookie|null, method, path, body?) → Promise<Response>` (sets JSON content-type and same Origin).

- [ ] **Step 1:** `npm init -y`; install deps: `hono zod react react-dom react-router-dom @tanstack/react-query`; dev: `typescript@5 vite@8 @vitejs/plugin-react @cloudflare/vite-plugin wrangler vitest@4 @cloudflare/vitest-pool-workers @cloudflare/workers-types @types/react @types/react-dom`. Scripts: `dev: vite`, `build: vite build`, `test: vitest run`, `db:migrate:local: wrangler d1 migrations apply luxcrm --local`, `deploy: vite build && wrangler deploy`.
- [ ] **Step 2:** `wrangler.jsonc`: name `luxpackers-crm`, `main: worker/src/index.ts`, `compatibility_date: "2026-11-01"`, `compatibility_flags: ["nodejs_compat"]`, `d1_databases: [{binding:"DB", database_name:"luxcrm", database_id:"local-dev", migrations_dir:"worker/migrations"}]`, `assets: {directory:"./dist/client", not_found_handling:"single-page-application", run_worker_first:["/api/*"]}`.
- [ ] **Step 3:** Write `0001_init.sql` with the spec §8 tables plus: `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)`, `login_attempts(email TEXT, at TEXT)`, `leave_requests.half_day INTEGER NOT NULL DEFAULT 0`. All ids `TEXT PRIMARY KEY`, timestamps ISO `TEXT`. CHECK constraints on `users.role`, `tasks.status`, `leave_requests.status`. Indexes: `tasks(assignee_id)`, `tasks(dept,status)`, `records(collection,deleted_at)`, `notifications(user_id,read_at)`, `sessions(user_id)`, `audit_log(at)`. Seed `settings` rows: `leave_allowances` = `{"Casual":12,"Sick":6,"Earned":15}`, `holidays` = `[]`.
- [ ] **Step 4: Failing test** `schema.test.ts`: after `applyMigrations`, `SELECT name FROM sqlite_master WHERE type='table'` contains all 12 tables; `GET /api/health` → `200 {ok:true}`; `GET /api/nope` → `404 {error:"not_found"}`.
- [ ] **Step 5:** Run `npm test` → FAIL. Implement `index.ts` (health + JSON 404 for `/api/*`), port `shared/schema.ts`. Run → PASS.
- [ ] **Step 6:** `npm run dev` serves a placeholder React page at `/` and `/api/health`. Commit `chore: scaffold Cloudflare Worker, D1 schema and React app`.

### Task 2: Passwords, sessions, first-admin setup, sign-in

**Files:** Create `worker/src/lib/crypto.ts`, `worker/src/lib/session.ts`, `worker/src/lib/audit.ts`, `worker/src/routes/auth.ts`, `worker/src/routes/setup.ts`, `worker/test/auth.test.ts`. Modify `worker/src/index.ts`.

**Interfaces:**
- Produces: `hashPassword(pw): Promise<{hash:string,salt:string}>`, `verifyPassword(pw,hash,salt): Promise<boolean>`, `randomToken(): string` (base64url 32 bytes), `sha256Hex(s): Promise<string>`; `createSession(db, userId, ua) → token`; middleware `readSession` sets `c.var.user: SessionUser | null` where `SessionUser = {id,name,email,role,dept,managerId,mustChangePassword}`; `requireUser` → 401 `{error:"signed_out"}`; `destroySessions(db,userId)`; `audit(db, user, action, entity, entityId, title, detail?)`; CSRF middleware per Global Constraints.
- Routes: `GET /api/setup → {needed:boolean}`; `POST /api/setup {name,email,password}` (only while `users` empty, else 403; password ≥ 10 chars) → creates admin + session; `POST /api/auth/login {email,password}` → `{user}` + cookie; `POST /api/auth/logout`; `GET /api/me → {user}`; `POST /api/auth/password {current,next}` clears `must_change_password`. While `mustChangePassword`, every route except `/api/me`, `/api/auth/*` → `403 {error:"must_change_password"}`.

- [ ] **Step 1: Failing tests** in `auth.test.ts`:
  - `hash/verify round-trip; wrong password false; two hashes of same pw differ`
  - `setup works once, second POST /api/setup → 403`
  - `login sets HttpOnly SameSite=Lax cookie; /api/me returns user without password fields`
  - `wrong password 5 times → 6th attempt 429 even with right password`
  - `POST without Origin → 403; with foreign Origin → 403`
  - `must_change_password user gets 403 on /api/tasks until password changed`
  - `logout then /api/me → 401`
- [ ] **Step 2:** Run → FAIL. Implement with WebCrypto `crypto.subtle.deriveBits` PBKDF2; `timingSafeEqual` via `crypto.subtle.timingSafeEqual` or byte XOR loop. Sliding expiry: on each request extend `expires_at` if less than 13 days remain.
- [ ] **Step 3:** Run → PASS. Commit `feat: per-person sign-in with hashed passwords and sessions`.

### Task 3: Policy module

**Files:** Create `worker/src/lib/policy.ts`, `worker/test/policy.test.ts`.

**Interfaces:**
- Consumes: `SessionUser`, `DEPARTMENTS`, `registerDepts`.
- Produces (all pure, synchronous):
  - `canReadRegister(u, registerId): boolean` — admin, or `registerDepts(registerId).includes(u.dept)`.
  - `canWriteRegister(u, registerId): boolean` — same rule (create + edit).
  - `canDeleteRecord(u, registerId): boolean` — admin, or manager with `canWriteRegister`.
  - `canAssignTo(u, target: {id,dept,managerId}): boolean` — admin; manager when `target.dept===u.dept || target.managerId===u.id`; hr always; anyone to themselves.
  - `canSeeTask(u, t: {assigneeId,assignedById,dept}, assignee?: {managerId}): boolean` — admin; assignee; assigner; manager of `t.dept`; manager of assignee.
  - `canEditTaskStatus(u, t, next): boolean` — assignee may set `To do|In progress|Waiting|Blocked|Submitted`, and `Done` only when `t.assignedById === t.assigneeId`; approvers may set any.
  - `canApproveTask(u, t, assignee): boolean` — `u.id !== t.assigneeId` AND (admin OR `u.id===t.assignedById` OR (manager AND (`t.dept===u.dept` OR `assignee.managerId===u.id`))).
  - `canManageUser(u, targetRole): boolean` — admin any; hr only `employee`.
  - `canDecideLeave(u, requester: {id,managerId}): boolean` — `u.id!==requester.id` AND (admin OR hr OR `requester.managerId===u.id`).
  - `canSeePeoplePrivate(u): boolean` — admin or hr.
- [ ] **Step 1: Failing tests:** a table-driven matrix: each role × `finance` (Finance dept only), `access` (Technology only), `bookings` (Sales, Operations, Finance), plus every function above with at least one allow and one deny case, including Review Focus #5 (`manager who is assignee cannot approve`) and "nobody decides own leave".
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: role policy module`.

### Task 4: Users and people

**Files:** Create `worker/src/routes/users.ts`, `worker/src/routes/people.ts`, `worker/src/lib/notify.ts`, `worker/test/users.test.ts`.

**Interfaces:**
- Produces: `GET /api/users` (admin, hr) full list incl. status; `POST /api/users {name,email,role,dept,managerId?,title?,phone?,kind,joinedOn?,status}` → `{user, tempPassword}` (12-char random, shown once; `must_change_password=1`); `PATCH /api/users/:id` (role changes admin-only; setting `status:"left"` calls `destroySessions`); `POST /api/users/:id/reset-password` → `{tempPassword}`. `GET /api/people` for everyone: `{id,name,role,dept,title,phone,email,managerId,status}`, plus `joinedOn,kind` only when `canSeePeoplePrivate`. Creating with `status:"onboarding"` inserts the 6 `ONBOARDING_STEPS` rows (first step `Account created` done). `notify(db, userIds:string[], kind, title, link)`.
- [ ] **Step 1: Failing tests:** `employee GET /api/users → 403`; `hr can create employee, cannot create manager (403)`; `duplicate email → 409 {error:"email_taken"}`; `set status left → that user's cookie gets 401` (Review Focus #3); `onboarding user gets 6 steps, 1 done`; `/api/people hides joinedOn from employee`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: user management and people directory`.

### Task 5: Tasks, review loop, comments

**Files:** Create `worker/src/routes/tasks.ts`, `worker/src/lib/dates.ts` (only `todayIST(): string` now), `worker/test/tasks.test.ts`.

**Interfaces:**
- Produces: `GET /api/tasks?scope=mine|assigned|team|all&status=&dept=&q=` (scope `all` admin only; `team` manager/admin) → `Task[]` with `assigneeName, assignedByName, late:boolean`; `POST /api/tasks {title,notes?,dept,assigneeId?,priority,due?,waitingOn?,links?}` (assignee defaults to self; checks `canAssignTo`; notifies assignee kind `assigned`); `PATCH /api/tasks/:id {version, ...fields}` (assignment/field edits: assigner or approvers; status via `canEditTaskStatus`); `POST /api/tasks/:id/submit` (assignee; `Submitted`; notify assigner + dept managers); `POST /api/tasks/:id/approve {comment?}` (`Done`, `completed_at`); `POST /api/tasks/:id/send-back {comment}` (comment required, → `To do`, notify assignee); `GET|POST /api/tasks/:id/comments`. Every mutation bumps `version`, writes audit. `Task` type exported from `shared/schema.ts`.
- [ ] **Step 1: Failing tests:** `employee sees only own and assigned-by-me tasks`; `manager assigns to dept member ok, to other dept non-report 403`; `self-created task can go to Done directly`; `assigned task: assignee PATCH status Done → 403, submit → Submitted`; `assignee-manager cannot approve own task (403)`; `send-back without comment → 400`; `approve sets completed_at and notifies assignee`; `PATCH with stale version → 409` (Review Focus #2); `late flag true when due < todayIST and not Done`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: task assignment and review loop`.

### Task 6: Registers (records)

**Files:** Create `worker/src/routes/records.ts`, `worker/test/records.test.ts`.

**Interfaces:**
- Produces: `GET /api/records/:collection?q=&status=&trash=1` (`trash=1` admin only) → `{rows: RecordRow[]}` where `RecordRow = {id, collection, dept, ownerId, ownerName, title, data, version, updatedAt, updatedByName}`; `POST /api/records/:collection {dept?, ownerId?, data}`; `PATCH /api/records/:collection/:id {version, dept?, ownerId?, data}`; `DELETE /api/records/:collection/:id` (soft, `canDeleteRecord`); `POST /api/records/:collection/:id/restore` (admin). Server validates `data` against the register's `fields` (required fields, `select` options, `money/number` numeric, links `https?://` only), strips unknown keys, computes `title` from `titleKey`. Unknown collection → 404.
- [ ] **Step 1: Failing tests:** `Sales employee reads bookings ok, finance 403` (Review Focus #1); `Finance employee reads finance ok`; `missing required field → 400 {error:"invalid", field:"guest"}`; `link "javascript:x" → 400`; `employee DELETE → 403, manager DELETE → soft (row hidden, visible with trash=1 for admin)`; `stale version → 409`; `unknown data keys are dropped`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: department-scoped registers`.

### Task 7: Leave and settings

**Files:** Create `worker/src/routes/leave.ts`, `worker/src/routes/settings.ts`, extend `worker/src/lib/dates.ts`, `worker/test/leave.test.ts`.

**Interfaces:**
- Produces: `leaveDays(start, end, halfDay, holidays: string[]): number` — counts Mon–Fri dates in `[start,end]` not in `holidays`; if `halfDay` then `start` must equal `end` and result is `0.5`. `GET /api/settings` / `PATCH /api/settings {leaveAllowances?, holidays?}` (admin). `GET /api/leave?scope=mine|team|all` (team: manager's reports; all: hr/admin) → requests + for `mine` a `balance: Record<Kind,{allowed,used,left}>` for the current calendar year (Approved + Pending count as used). `POST /api/leave {kind,start,end,halfDay,reason}` → 400 `"Not enough {kind} leave left ({left} days)."` when exceeded (Unpaid unlimited); notify manager + all HR. `POST /api/leave/:id/approve|reject {note?}` via `canDecideLeave`; `POST /api/leave/:id/cancel` (own, Pending only).
- [ ] **Step 1: Failing tests:** `leaveDays Fri→Mon = 2`; `holiday on Tue excluded`; `halfDay single day = 0.5`; `halfDay over two days → 400`; `exceeding Casual balance → 400 with exact message` (Review Focus #4); `manager approves report's leave; employee cannot approve own; hr approves anyone's`; `balance counts pending`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: leave requests, balances and settings`.

### Task 8: Onboarding, notifications, dashboard, search, audit

**Files:** Create `worker/src/routes/{onboarding,notifications,dashboard,search,audit}.ts`, `worker/test/dashboard.test.ts`.

**Interfaces:**
- Produces: `GET /api/onboarding/:userId` (hr/admin or self), `PATCH /api/onboarding/:userId {step, done}` (hr/admin). `GET /api/notifications → {items, unread}` (latest 50); `POST /api/notifications/read {ids?: string[]}` (none = all). `GET /api/audit?limit=100&before=` (admin). `GET /api/search?q=` (≥2 chars) → up to 12 `{kind:"task"|"record"|"person", id, title, sub, link}`, only what the caller may see. `GET /api/dashboard` → by role:
  - employee `{overdue, today, week, sentBack, waitingOnMe, submitted, leaveBalance, unread}` (task arrays)
  - manager: employee keys + `{reviewQueue, workload:[{userId,name,open,late,submitted}], pendingLeave, registers:[{id,name,open}]}`
  - hr: employee keys + `{onboarding:[{userId,name,done,total,joinedOn}], pendingLeave, joiningSoon:[{userId,name,joinedOn}] (next 30 days)}`
  - admin: all of the above + `{figures:{openTasks,late,waiting,openEnquiries,quoted,receivedThisMonth,tripsLive,tripsTotal}, attention, next7, departments:[{name,open,late,done,total}], latest: audit[]}`.
- [ ] **Step 1: Failing tests:** `employee dashboard has no reviewQueue/figures keys`; `manager reviewQueue contains a submitted task from their dept`; `hr onboarding lists onboarding user with 1/6`; `search as employee never returns finance records`; `notifications read-all sets unread 0`; `audit as employee → 403`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: role dashboards API, notifications, search and audit`.

### Task 9: Import from the old CRM

**Files:** Create `worker/src/routes/import.ts`, `worker/test/import.test.ts`, `worker/test/fixtures/old-backup.json` (small: 3 tasks, 2 bookings, 1 team row, 1 finance).

**Interfaces:**
- Produces: `POST /api/import/preview {backup}` (admin) → `{counts:{collection:number}, owners:string[]}` (distinct old `owner`/`holder` texts); `POST /api/import {backup, ownerMap: Record<string,string|null>}` → `{created, updated, skipped}`. Old `tasks` → `tasks` (`To be given`→`Waiting`, `Not done`→`Blocked`; `assigned_by_id` = importing admin; `assignee_id` from `ownerMap` or null). Other collections → `records` keyed by old `id` (upsert, idempotent). `team` rows are skipped (counted). Also accepts `{seed:true}` to import `legacy/assets/seed.js` data bundled as `worker/src/seed.ts`.
- [ ] **Step 1: Failing tests:** `preview lists owners ["CFO","Ops intern",...]`; `import twice → second run created 0, updated N`; `status mapping`; `unmapped owner → assignee null`; `non-admin → 403`.
- [ ] **Step 2:** FAIL → implement → PASS. Commit `feat: import old CRM backup and starting records`.

### Task 10: Web foundation — style, auth screens, shell

**Files:** Create `web/src/{api.ts,auth.tsx,styles.css,router.tsx}`, `web/src/components/{Shell,Sidebar,NotificationBell,Search,Pill,Figure}.tsx`, `web/src/pages/{Login,Setup,ChangePassword,Help}.tsx`. Modify `web/src/main.tsx`.

**Interfaces:**
- Consumes: all Task 2, 4, 8 routes.
- Produces: `api<T>(method, path, body?) → Promise<T>` throwing `ApiError{status, code, message}`; on 401 it clears the user and navigates to `/login`; on 409 code `conflict`. Dashboard and notifications queries use `refetchInterval: 60_000` only while `document.visibilityState === "visible"`. `useAuth() → {user, signOut, refresh}`. `<Shell>` with role-filtered `<Sidebar>` (items per spec §7; Finance/Access links only when the user's dept owns them; admin sees all). Routes: `/`, `/tasks`, `/registers/:id`, `/people`, `/leave`, `/users`, `/audit`, `/import`, `/settings`, `/trash`, `/help`, `/login`, `/setup`, `/change-password`.
- [ ] **Step 1:** Port tokens and component styles from `legacy/assets/styles.css` (sidebar, figures, cards, pills, tables, drawer, toast, login split screen) into `styles.css`; keep mobile breakpoints.
- [ ] **Step 2:** Implement screens. Login copy: "Sign in" / "Use your work email and password." Wrong password: "That email and password don't match." Locked: "Too many tries. Wait 15 minutes and try again." `/setup` shown when `GET /api/setup` says needed. Must-change-password forces `/change-password`.
- [ ] **Step 3: Verify** with `npm run dev` in the browser: setup first admin → lands on `/`; sign out → sign in; bell shows unread count. Commit `feat: web shell, sign-in and setup`.

### Task 11: Tasks UI and Employee home

**Files:** Create `web/src/components/{TaskList,TaskDrawer}.tsx`, `web/src/pages/Tasks.tsx`, `web/src/dashboards/EmployeeHome.tsx`.

**Interfaces:**
- Produces: `<TaskList tasks onOpen />` (title, assignee, due with late styling, priority, status pill), `<TaskDrawer taskId | new preset>` (fields, assignee picker limited to people the user may assign — server re-checks; status buttons per role; Submit for review; Approve / Send back with required comment; comment thread; history). Tasks page tabs: "My tasks", "I assigned", "My team" (manager), "All" (admin).
- [ ] **Step 1:** EmployeeHome: greeting, figures (Overdue, Due today, Sent back, Waiting on me), lists "Sent back to you" (with the comment), "Due today and overdue", "This week", leave balance card, notifications.
- [ ] **Step 2: Verify** in browser as an employee: create a self task → Done directly; a task assigned by a manager → only "Submit for review"; 409 shows "Someone else changed this. Reload to see their change." Commit `feat: tasks UI and employee dashboard`.

### Task 12: Manager home and registers UI

**Files:** Create `web/src/dashboards/ManagerHome.tsx`, `web/src/components/{RecordTable,RecordDrawer}.tsx`, `web/src/pages/{Register,Trash}.tsx`.

**Interfaces:**
- Produces: `<RecordTable register rows />` and `<RecordDrawer register record?/>` generated from `REGISTERS` fields (port of legacy `listInner`, `cell`, `fieldHtml`: chips by status, search, sort, quick status select, links, checklist, computed balance). Owner field = people picker.
- [ ] **Step 1:** ManagerHome: review queue with inline Approve / Send back, team workload table (open, late, submitted per person, click → that person's tasks), pending leave with Approve/Reject, department register summaries, "New task" for the team.
- [ ] **Step 2: Verify** in browser as a Sales manager: bookings visible, finance not in sidebar and `/registers/finance` shows "You don't have access to this register."; delete moves to Trash; admin restores. Commit `feat: manager dashboard and registers`.

### Task 13: HR and Admin

**Files:** Create `web/src/dashboards/{HrHome,AdminHome}.tsx`, `web/src/pages/{People,Leave,Users,Audit,Import,Settings}.tsx`.

- [ ] **Step 1:** HrHome: onboarding progress per new joiner (tick steps), pending leave (all), joining soon, people directory link, "Add a person" (employee). Leave page: apply form with live day count, my requests + balance, team/all tabs for approvers.
- [ ] **Step 2:** AdminHome: port of legacy Overview (figures, needs attention, next 7 days, latest changes, department cards). Users page: create (shows temp password once with copy button and "It won't be shown again."), change role/manager/dept, disable, reset password. Audit page (paged). Import page: upload backup → preview counts → owner mapping dropdowns → import → result. Settings: leave allowances, holidays list.
- [ ] **Step 3: Verify** in browser through each role (admin creates manager, hr, two employees; import fixture; walk the assign→submit→approve and leave loops). Commit `feat: HR and admin dashboards`.

### Task 14: Docs, cleanup, full check

**Files:** Rewrite `README.md`; Modify `.gitignore` (`node_modules`, `dist`, `.wrangler`).

- [ ] **Step 1:** README: what it is; roles table; local dev (`npm install`, `npm run db:migrate:local`, `npm run dev`, open `/setup`); going live (`npx wrangler login`, `npx wrangler d1 create luxcrm` → paste id in `wrangler.jsonc`, `npx wrangler d1 migrations apply luxcrm --remote`, `npm run deploy`); cut-over steps from spec §13.7; security notes.
- [ ] **Step 2:** Run `npm test`, `npx tsc --noEmit`, `npm run build` → all clean. Commit `docs: README for the Cloudflare CRM`.
