# Luxpackers CRM

The Luxpackers operations desk: one place for every task, enquiry, booking, trip, payment, partner, post and team member, for every department.

Everyone signs in with **Continue with Google** (there are no passwords), and sees a home page made for their job: Admin, Manager, HR or Employee. It runs on Cloudflare's free plan (a Worker for the website and a D1 database for the records), so there is no server to look after. A **Worker** is a small program Cloudflare runs for you whenever someone opens the site; **D1** is Cloudflare's hosted database; **migrations** are the numbered files in `worker/migrations` that create or change the database tables, applied once, in order.

---

## Who sees what

| Role | Home page | Can see | Can do |
|---|---|---|---|
| **Employee** | **My work**: due today, overdue, this week, tasks sent back, leave balance, notifications | Own tasks, tasks they gave out, the registers of their own department | Update own tasks and submit them, comment, create tasks for themselves, apply for leave, edit records in their department's registers |
| **Manager** | **My team**: tasks waiting for review, workload per person, overdue by person, leave requests from reports | Everything an employee sees, plus all tasks in their department and their direct reports' tasks | Assign tasks within their department, approve or send back submitted work, reassign, approve their reports' leave, delete records (to Trash) |
| **HR** | **People**: new joiners and onboarding, all leave requests, people directory, interns ending soon | The whole people directory, all leave, onboarding, own tasks | Add employee accounts (employees only), edit people's profiles, approve any leave, give onboarding tasks to anyone |
| **Admin** | **Company overview**: what needs attention, the next 7 days, every department | Everything | Everything: add or disable users with any role, change roles, delete and restore records, import data, settings, audit log |

Good to know:

- A task you give to yourself can go straight to Done. A task someone else gave you goes to **Submitted**, and only the person who gave it, the department's manager or an admin can mark it Done or send it back with a note.
- The Finance ledger is for the Finance department and admins only. The Access register is for the Technology department and admins only.
- Everyone sees a colleague's name, role, department, phone and email. Only HR and admins see joining dates, notes and status changes.
- The menu on the left shows only what your role can open. **How to use** inside the CRM explains the day-to-day steps for everyone.

---

## Run it on your computer

You need [Node.js](https://nodejs.org) installed. Open a terminal in this folder and run these one at a time.

```bash
npm install
```

```bash
npm run db:migrate:local
```

Make the local two-step sign-in key (once). This writes a `.dev.vars` file, which git ignores:

```bash
echo "MFA_KEY=$(openssl rand -base64 32)" > .dev.vars
```

Add your Google sign-in credentials to the same file (see **Create your Google sign-in credentials** below; the `http://localhost:5173` entries there are for this):

```bash
echo "GOOGLE_CLIENT_ID=paste-the-client-id" >> .dev.vars
echo "GOOGLE_CLIENT_SECRET=paste-the-client-secret" >> .dev.vars
```

```bash
npm run dev
```

Open the address it prints (usually `http://localhost:5173`).

Run `db:migrate:local` **before** `dev` on a fresh copy. It creates the empty database on your computer, and the site cannot start properly without it. You only need to repeat it when new files appear in `worker/migrations`.

The very first visit goes to a **setup** page: press **Continue with Google**. The first Google account to finish signing in becomes the administrator (only ever once). Administrators are then asked to turn on two-step sign-in (see below) before they can do anything else.

---

## Add your team

There are two ways in, and both use the person's Google account:

- **They ask, you approve.** Send them the address. They press **Continue with Google** and see "Waiting for approval". Every admin gets a notification. Open **People & logins → Waiting**, press **Approve**, choose their position (any, Admin included), department and (optionally) manager. They're told and can start straight away. **Decline** turns them away: they see "Your request wasn't approved". You can **Undo decline** later.
- **You add them first.** On **People & logins**, press **Add a person** with their name, work email, position and department. When they sign in with the Google account for that email, they go straight in.

HR can add people too, but only as **Employees**. Only an admin can approve requests, create managers, HR or other admins, or change someone's position.

Existing accounts (made before Google sign-in) are linked automatically the first time that person signs in with a Google account whose verified email matches. After that the account is tied to that Google account, so a change of email on the Google side does not lock them out, and a different Google account that later gets the same email cannot take it over.

Add the real people **before** importing the old data, so old owner names can be matched to them.

---

## Bring over the old data

1. In the **old** CRM, open **Settings → Download backup**. Keep the file safe.
2. In the new CRM, sign in as admin and open **Import**.
3. Choose the backup file. Nothing is saved yet. You see a preview with the number of records of each kind.
4. The old CRM used names like "CFO" or "Ops intern" as owners. The preview lists each one with a drop-down. Pick the real person for each. Any you leave unmatched are imported as **unassigned**. Admins see them in the **Needs an owner** section on their home page, which links to the open tasks with no one assigned (Tasks, All tab, owner "No owner") and, for each register, to the records with no owner (owner filter "No owner").
5. Press **Import**.

Importing never creates logins; people must already have accounts (see above).

> **Importing again overwrites changes made here** to the same records. Each record is matched by its old id, so a second import updates records instead of duplicating them, but it also puts back the old values. Import once at cut-over, then work only in the new CRM.

Starting from scratch instead? On the same page, **Load starting records** adds the open tasks, the trips, the team roles, the access register and the partner hotels so you can see how everything fits.

---

## Move off the Google Sheet

Do these in order, on a quiet day.

1. **Freeze edits.** Tell everyone to stop using the old CRM.
2. **Final backup.** In the old CRM, download a fresh backup (Settings → Download backup).
3. **Import.** In the new CRM, import that file as described above, matching owners to real people.
4. **Check the counts.** Compare the numbers on the import preview with the old CRM (tasks, enquiries, bookings and so on). Open a few records you know well.
5. **Archive the old setup.** In Google Apps Script, archive the old deployment (Deploy → Manage deployments → Archive), and keep the Google Sheet as a read-only record.
6. **Tidy up.** Once everyone is working in the new CRM and you are happy, the `legacy/` folder in this repository (the old website and Apps Script) can be deleted. Keep it until then.

---

## Go live on Cloudflare (free plan)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up). Run these one at a time.

Sign in to Cloudflare (a browser window opens):

```bash
npx wrangler login
```

Create the live database:

```bash
npx wrangler d1 create luxcrm
```

It prints a `database_id`. Open `wrangler.jsonc` and replace `local-dev` with that id:

```jsonc
"database_id": "paste-the-id-here"
```

Create the tables in the live database:

```bash
npx wrangler d1 migrations apply luxcrm --remote
```

Give the live site its two-step sign-in key. It encrypts everyone's authenticator secrets, so set it once and keep it. When it asks for the value, paste the output of `openssl rand -base64 32`:

```bash
npx wrangler secret put MFA_KEY
```

Without it, two-step sign-in cannot be turned on or used, and administrators cannot get past the setup screen. **Do not change or delete it later:** everyone who has two-step sign-in on would have to have it reset.

Give the live site its Google sign-in credentials (see **Create your Google sign-in credentials** below). Paste each value when asked:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
```

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Without them nobody can sign in: the sign-in page says Google sign-in isn't set up.

Build and publish the site:

```bash
npm run deploy
```

When it finishes it prints a `workers.dev` address. On a brand-new database, open the address and press **Continue with Google** straight away: until someone does, the first Google account to sign in becomes the admin. Then you are live. Share the address with the team.

**Later updates:** run `npm run deploy` again. If a new file has appeared in `worker/migrations`, run the `migrations apply luxcrm --remote` command first. Your records are never touched by a deploy.

---

## Create your Google sign-in credentials

Do this once. It gives the CRM a **Client ID** and **Client secret** so Google will sign people in to it.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and sign in with the Google account that should own the setup (for example the company admin account).
2. **Create a project:** click the project picker at the top → **New project** → name it `Luxpackers CRM` → **Create**. Make sure it is selected in the picker.
3. **OAuth consent screen:** in the menu, open **APIs & Services → OAuth consent screen** (in newer consoles, **Google Auth Platform → Branding**). Press **Get started** / **Configure**.
   - App name: `Luxpackers CRM`. User support email: your email.
   - Audience / user type: **External** (so people with any Google account, including Gmail, can ask to join).
   - Contact information: your email. Accept the policy and **Create**.
   - If you have your own domain (for example `luxpackers.com`), add it under **Authorised domains**. With only the `workers.dev` address you can leave this empty.
   - Scopes: nothing extra is needed. The CRM only asks for `openid`, `email` and `profile`.
4. **Credentials:** open **APIs & Services → Credentials** (or **Google Auth Platform → Clients**) → **Create credentials → OAuth client ID**.
   - Application type: **Web application**. Name: `Luxpackers CRM web`.
   - **Authorised JavaScript origins:** add both
     - `https://luxpackers-crm.luxpackers-crm.workers.dev`
     - `http://localhost:5173`
   - **Authorised redirect URIs:** add both
     - `https://luxpackers-crm.luxpackers-crm.workers.dev/api/auth/google/callback`
     - `http://localhost:5173/api/auth/google/callback`
   - Press **Create**.
5. **Copy the Client ID and the Client secret** from the box that appears (you can see them again later under Credentials / Clients).
6. Give them to the live site (paste each when asked):

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   ```

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

   For your own computer, put them in `.dev.vars` instead (see **Run it on your computer**).
7. **Publish the app.** A new consent screen starts in **Testing** mode, where only the Google accounts listed under **Test users** can sign in; everyone else gets an error from Google. Open **OAuth consent screen** (or **Google Auth Platform → Audience**) and press **Publish app** → **Confirm**. Because the CRM only asks for basic sign-in details, Google does not need to review it.

If the address of the site changes (a custom domain, say), add the new origin and `/api/auth/google/callback` address in step 4 too. The redirect address is always the address in the browser plus `/api/auth/google/callback`.

---

## Two-step sign-in

After Google, people with two-step sign-in on also type a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and so on).

- **Turn it on:** open **My account** (bottom of the menu) → **Turn on two-step sign-in**. Scan the QR code (or type the key shown under it), then type the code the app shows. Eight **backup codes** are shown once: copy or download them and keep them away from the phone. Each works once instead of an app code.
- **Turning it on needs a fresh sign-in.** If you last signed in with Google more than 10 minutes ago, you're asked to **Continue with Google** again first and come straight back. Turning it on signs you out on every other device.
- **Administrators must have it on.** An admin without it can only reach the setup screen until it is done, and cannot turn it off.
- **Everyone else** may turn it off from **My account** with a current code.
- **New backup codes** can be made from **My account** with a current app code; the old ones stop working.
- **Lost phone:** sign in with a backup code, or ask an administrator to press **Reset two-step sign-in** next to your name on **People & logins**. That clears it and signs you out everywhere; turn it on again afterwards. Resets are recorded in the audit log.
- Five wrong codes for an account within 15 minutes block code checks for that account until the oldest is 15 minutes old. The code step expires 5 minutes after Google, and starting a new Google sign-in cancels the previous one.

**Locked-out administrator (no phone, no backup codes, no other admin).** Clear two-step sign-in for that one email straight in the database, then sign in with Google and set it up again at once:

```bash
npx wrangler d1 execute luxcrm --remote --command "UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE email = 'admin@example.com'; DELETE FROM mfa_backup_codes WHERE user_id = (SELECT id FROM users WHERE email = 'admin@example.com'); DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'admin@example.com');"
```

Use the real email (lower case) in all three places. Anyone who can run this already controls the Cloudflare account, so keep that account itself behind two-step sign-in too.

---

## What is in this folder

```
worker/src/          the server: sign-in, permissions, records, tasks, leave, import
worker/migrations/   the database tables (applied in order)
worker/test/         automatic checks for the server
web/src/             the website people see: pages, dashboards, styles
shared/              lists used by both sides (departments, registers, statuses)
docs/                the design notes
legacy/              the old Google Sheet version, kept until cut-over is finished
wrangler.jsonc       Cloudflare settings (name, database)
```

To check everything still works after a change, run `npm test`.

---

## A note on security

- Google is the only way in. The CRM keeps no passwords. Sign-in uses Google's standard secure flow (authorisation code with PKCE, a one-time `state` tied to your browser, and a `nonce`); the answer from Google is checked against Google's published signing keys, and only verified email addresses are accepted.
- New people cannot see anything until an admin approves them.
- Sign-in lasts 14 days and is kept in a secure cookie that scripts on the page cannot read.
- The server checks permissions on **every** request, so hiding a button is never the only protection.
- After 5 wrong two-step codes for an account within 15 minutes, code checks for that account are blocked until the oldest of those tries is 15 minutes old.
- Two-step sign-in secrets are stored encrypted with the `MFA_KEY` secret; backup codes are stored only as hashes. Administrators must use two-step sign-in.
- **Never store passwords, OTPs, card numbers or passport scans in the CRM.** The Access register records only who holds a login and where it is kept.
- When someone leaves, press **Turn off** next to their name on the **People & logins** page. They are signed out immediately and cannot sign in again.
