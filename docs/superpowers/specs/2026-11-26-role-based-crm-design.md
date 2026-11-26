# Luxpackers CRM v2 — role-based office workspace on Cloudflare

Status: approved · 2026-11-26

## 1. Intent

Luxpackers runs its operations from a static CRM (GitHub Pages + one Google Sheet). It has one shared team code, free-text names, two roles (admin/member) and sends every record to every browser. The company wants a proper office ecosystem: **each person signs in as themselves and lands on a dashboard built for their role** — Admin, Manager, HR, Employee — where managers assign work, employees do it and submit it, and HR looks after people.

Two independent reviews (this session and the terminal session) agreed: keep the visual design and the register definitions in `assets/schema.js`; replace authentication and the backend.

## 2. Goals

1. Real per-person accounts with one role each: `admin`, `manager`, `hr`, `employee`.
2. Every permission enforced **on the server**, including reads. The browser never decides what someone may see.
3. A home dashboard per role (section 7).
4. Task assignment loop: assign → work → submit for review → approve or send back, with comments and history.
5. In-app notifications for anything that needs a person's action.
6. HR basics: people directory, leave requests with approval, onboarding checklist.
7. The travel registers (Enquiries, Bookings, Trips, Finance ledger, Partners, Content calendar, Access register) carried over, scoped by department.
8. Server-written audit log that the browser cannot forge.
9. Import of the existing CRM's JSON backup and the starting records in `seed.js`.
10. Runs on Cloudflare free plan.

## 3. Non-goals (v1)

- Email / WhatsApp notifications (in-app only; add later via a queue).
- Attendance, payroll, salary data.
- File uploads (links stay as links, as today).
- Mobile app. The site works at phone width.
- SSO / Google sign-in / Cloudflare Access (can be added later in front of the Worker).

## 4. Anti-goals — failure even if it works

- Any role being able to fetch data it should not see by calling the API directly.
- A cluttered, generic "AI admin template" look: no purple, no gradients, no card soup. Keep the ink-and-paper house style.
- Employees landing on a company-wide wall of numbers instead of "what do I do today".
- Passwords, OTPs or card numbers stored anywhere in the CRM (the Access register rule stays).

## 5. Constraints

- Cloudflare free plan: Workers (100k requests/day, 10 ms CPU per request), D1 (5 GB, 5M reads/day), static assets free.
- PBKDF2 in Workers is capped at 100,000 iterations.
- The user has no Cloudflare login on this machine yet; build and test locally with Wrangler's local D1. Going live needs the user to run `npx wrangler login` once.
- Small team (≈10–40 people), mostly non-technical. Copy stays plain English, as today.

## 6. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | **One Cloudflare Worker (Hono API) serving a React + Vite app as static assets, D1 database** | Full frontend rewrite and a build step, but four dashboards stay manageable as components; one deploy. |
| B | Cloudflare Pages + Pages Functions + D1, keep vanilla JS | Smallest change, but four role views bolted onto 637 lines of HTML strings hits the same wall again. |
| C | Cloudflare Access for login + A or B | Free up to 50 users, but roles still live in our DB and setup moves to the Cloudflare dashboard. Deferred. |

The user chose Cloudflare over Supabase and picked A.

## 7. Roles and dashboards

| Role | Home dashboard | Can see | Can do |
|---|---|---|---|
| **Employee** | **My work**: due today / overdue / this week, tasks sent back to me, waiting on me, my leave balance, my notifications | Own tasks; tasks they assigned; registers of their own department | Update own tasks (to do → in progress → waiting/blocked → submit); comment; create tasks for themselves; apply for leave; edit records in own department's registers |
| **Manager** | **My team**: review queue (submitted tasks), team workload per person, overdue by person, leave requests from reports, department registers summary | Everything an employee sees + all tasks in their department + their direct reports' tasks | Assign tasks to anyone in their department; approve / send back; reassign; approve reports' leave |
| **HR** | **People**: new joiners and onboarding progress, leave requests (all), people directory, upcoming joining dates, interns ending soon | People directory (all), all leave, onboarding; own tasks | Create employee accounts (role `employee` only); edit people profiles; approve any leave; assign onboarding tasks to anyone |
| **Admin** | **Company overview**: today's Overview page (needs attention, next 7 days, departments) + user management + audit log | Everything | Everything, incl. create/disable users with any role, change roles, delete records, import data, settings |

Rules:
- A task created by someone for **themselves** can go straight to Done. A task **assigned by someone else** goes to "Submitted"; only the assigner, the department's manager or an admin can approve it (→ Done) or send it back (→ To do, with a required comment).
- Finance ledger: Finance department + admin only. Access register: Technology department + admin only. Team/people: everyone sees name, role, department, phone, email; only HR/admin see joining date, notes, status changes.
- A manager's "team" = users whose `manager_id` is them **plus** everyone in their department.

Sidebar shows only what the role can open (≈6–9 items instead of ~20).

## 8. Data model (D1 / SQLite)

Real tables for anything permissions or workflow depend on; one generic table for the travel registers so `schema.js` keeps driving their forms.

```
users          id, email (unique), name, role, dept, manager_id → users, title, phone,
               kind (Full-time/Intern/Freelancer), joined_on, status (active/onboarding/left),
               password_hash, password_salt, must_change_password, created_at, updated_at
sessions       id (sha256 of token), user_id, expires_at, created_at, user_agent
tasks          id, title, notes, dept, assignee_id, assigned_by_id, priority, status,
               due, waiting_on, links (JSON), version, created_at, updated_at, completed_at
               status ∈ To do · In progress · Waiting · Blocked · Submitted · Done
task_comments  id, task_id, user_id, body, kind (comment/sent_back/approved), created_at
records        id, collection, dept, owner_id → users, title, data (JSON), version,
               created_at, created_by, updated_at, updated_by, deleted_at
leave_requests id, user_id, kind (Casual/Sick/Earned/Unpaid), start, end, days, reason,
               status (Pending/Approved/Rejected/Cancelled), decided_by, decided_at, note
onboarding     id, user_id, step, done, done_by, done_at   (steps from a fixed list)
notifications  id, user_id, kind, title, link, read_at, created_at
audit_log      id, at, user_id, action, entity, entity_id, title, detail (JSON)
```

- Old statuses map: "To be given" → Waiting, "Not done" → Blocked.
- `version` on tasks and records: every update sends the version it read; a mismatch returns **409** and the UI says "Someone else changed this — reload". No more silent last-write-wins.
- Deletes on `records` are soft (`deleted_at`); admin can restore from a Trash view.
- Owners are user **ids**, so renaming a person changes nothing else.

## 9. API (Hono, `/api/*`, JSON)

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `POST /api/auth/password`
- `GET /api/setup` / `POST /api/setup` — only works while `users` is empty: creates the first admin.
- `GET/POST/PATCH /api/tasks`, `POST /api/tasks/:id/submit|approve|send-back`, `GET/POST /api/tasks/:id/comments`
- `GET/POST/PATCH/DELETE /api/records/:collection[/:id]`
- `GET/POST/PATCH /api/users` (admin; HR limited to employees), `GET /api/people`
- `GET/POST /api/leave`, `POST /api/leave/:id/approve|reject|cancel`
- `GET/PATCH /api/onboarding/:userId`
- `GET /api/notifications`, `POST /api/notifications/read`
- `GET /api/dashboard` — returns the role's home data in one call
- `GET /api/audit` (admin), `POST /api/import` (admin; old backup JSON or seed)

Every handler: session middleware → load user → a single `can(user, action, resource)` policy module → query with role-scoped `WHERE` clauses. Request bodies validated with Zod; unknown fields dropped; `created_by`, `updated_by`, `assigned_by_id` and audit entries are always set by the server from the session.

## 10. Auth details

- Email + password. PBKDF2-SHA256, 100k iterations, 16-byte random salt, constant-time compare.
- Session token: 32 random bytes, cookie `lux_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, 14 days sliding. Only its SHA-256 is stored.
- Login rate limit: 5 failed attempts per email per 15 minutes (counted in D1).
- New accounts get a temporary password shown once to the admin/HR; `must_change_password` forces a change at first sign-in.
- Disabling a user (status `left`) deletes their sessions immediately.
- State-changing requests require `Content-Type: application/json` and a same-origin `Origin` header (CSRF).

## 11. Frontend

- React 18 + Vite + TypeScript, React Router, TanStack Query for fetching/caching. No UI kit; port `styles.css` tokens (ink, paper, oxblood accent, Cormorant Garamond + Jost) into CSS modules or one global stylesheet.
- Shared pieces: shell + role-aware sidebar, `RecordTable` and `RecordDrawer` generated from `schema.js` (ported to TS), `TaskDrawer` with comment thread and approve/send-back, notification bell, global search (server-side `/api/search`, scoped by role).
- Polling: notifications and dashboard refetch every 60 s while the tab is visible (cheap, scoped queries — not the whole database).

## 12. Project layout and tooling

```
/worker/src        index.ts (Hono), auth.ts, policy.ts, routes/*.ts, db.ts
/worker/migrations 0001_init.sql …
/web/src           main.tsx, routes/, dashboards/, components/, schema.ts, api.ts, styles.css
wrangler.jsonc     D1 binding DB, assets dir = web build
package.json       npm run dev (vite + @cloudflare/vite-plugin), test, deploy, db:migrate
```

- The old static files move to `/legacy` for reference until import is verified, then are removed.
- Tests: Vitest with `@cloudflare/vitest-pool-workers` against local D1, focused on the policy: every role × every endpoint read/write matrix, the task approval loop, leave approval, version conflict, setup lock.
- README rewritten: local dev, first-admin setup, `wrangler login`, `wrangler d1 create`, `wrangler deploy`, importing the old backup.

## 13. Decisions from the builder review (builder's calls unless marked)

1. **Register access is by register, not by record.** A department that lists a register in `DEPARTMENTS[].registers` can read, create and edit *every* record in it (Bookings: Sales, Operations, Finance). A record's `dept` is a label for filtering only. Admin sees all. Registers no department lists (none today) are admin-only.
2. **Team register is replaced** by `users` + `/api/people`. The People & Interns department stays as a department. Role and department are independent: an HR user may sit in People & Interns, an admin in Management; their department grants that department's registers like anyone else's.
3. **Managers:** a department may have several managers. Any manager of the department can assign within it and approve its tasks. A manager may also assign to and approve for their direct reports (`manager_id`) in other departments.
4. **Create/delete below admin:** employees can create and edit records in their department's registers; managers can also soft-delete them; admin can soft-delete anything and restore from Trash. Hard delete: none in v1.
5. **Leave approval:** one approval is enough — the person's manager *or* any HR user *or* admin. Nobody approves their own request. A person with no manager is approved by HR or admin. Both the manager and HR get a notification.
6. **Onboarding steps** (fixed list, created automatically when a user is created with status `onboarding`): Account created · Welcome call done · Logins given (recorded in Access register) · Role brief and first tasks assigned · Policies read · One-week check-in. HR switches the person to `active` by hand; the dashboard nudges when all steps are done.
7. **Cut-over from the Google Sheet:** freeze edits, admin downloads a final backup from the old CRM, imports it into v2, checks counts, then the Apps Script deployment is archived. Import is idempotent: records are keyed by their old `id`, re-running updates instead of duplicating.
8. **Import and people** *(approved by user 2026-11-26)*: import never creates logins. Admin/HR first create real accounts. The import screen then lists every distinct old owner text ("Ops intern", "CFO", …) with a dropdown to map each to a real user; unmapped ones import as unassigned and show up in a "needs an owner" list.
9. **Leave allowances** *(approved by user 2026-11-26)*: calendar year; per year Casual 12, Sick 6, Earned 15; no carry-over; half days allowed; weekends excluded from `days`; public holidays list editable by admin and excluded too. Allowances editable by admin in Settings.

## 14. Left to the builder

Component structure, exact copy, table/column choices per dashboard, query shapes, index choices, how search ranks results — within the house style and the rules above.
