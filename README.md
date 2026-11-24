# Luxpackers CRM

The Luxpackers operations desk: one place for every task, enquiry, booking, trip, payment, partner, post, team member and login, for every department.

It is a plain website, so it runs on GitHub Pages for free. The data is kept in one shared Google Sheet so the whole team sees the same records.

---

## 1. Put the website online (GitHub Pages)

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute or two the address appears at the top of that page, for example
   `https://sayan1-dls.github.io/LUXPACKERS_crm/`

Until step 2 below is done, the CRM saves on each computer separately. Sign in with:

| Who | Team code |
|---|---|
| Everyone | `luxpackers` |
| Administrators | `luxadmin` |

Change these in `config.js` (`localTeamCode`, `localAdminCode`).

## 2. Connect the shared Google Sheet (do this once, about 10 minutes)

1. In Google Drive, create a new Google Sheet called **Luxpackers CRM data**.
2. In that sheet open **Extensions → Apps Script**.
3. Delete what is there, paste everything from `google-apps-script/Code.gs`, and press **Save**.
4. Set the sign-in codes: click **Project Settings** (gear icon) → **Script properties** → **Add script property**:
   - `TEAM_CODE` → a code for the whole team
   - `ADMIN_CODE` → a different code for administrators only

   Choose codes nobody can guess. These replace the codes in the table above.
5. Click **Deploy → New deployment** → gear icon → **Web app**.
   - Description: `Luxpackers CRM`
   - Execute as: **Me**
   - Who has access: **Anyone**
   Press **Deploy**, allow the permissions Google asks for, and copy the **Web app URL** (it ends in `/exec`).
6. Open `config.js` in this repository, paste that address between the quotes of `sheetApiUrl`, and commit.
7. Open the CRM, sign in with the **admin** code, and press **Load starting records** on the Overview page.

The Google Sheet now has two tabs: **Records** (the data — do not edit the last column by hand) and **Activity** (a log of every change, who made it and when).

> If you later change `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the address stays the same.

## 3. Add the team

Open **Team** in the CRM and replace each role (CEO, CFO, Content intern…) with the person's real name. Their tasks move to the new name automatically. Then give each person the website address and the team code.

## How the CRM is organised

| Section | What it holds |
|---|---|
| Overview | What needs attention, what is due this week, latest changes, every department at a glance |
| Departments | Management, Sales & Reservations, Operations, Trips & Content, Marketing, Finance, Technology, People & Interns — each with its own tasks and registers |
| Tasks | Every job, with owner, due date, priority, status and links |
| Enquiries | Travellers from first message to confirmation, with follow-up dates and quote values |
| Bookings | Confirmed guests, money received, balance and trip status |
| Trips | Each itinerary's steps from draft to live on the website |
| Finance ledger | Money in and out, pending and overdue |
| Partners | Hotels, ground partners, transport and activities |
| Content calendar | Reels, posts and stories by date |
| Team | Everyone at Luxpackers; feeds every Owner list |
| Access register | Who holds which login — **never** passwords |

Task statuses: **To do**, **In progress**, **To be given** (waiting on someone), **Not done** (late or blocked), **Done**.

Only administrators can delete records. **How to use** inside the CRM explains everything for non-technical colleagues.

## Files

```
index.html                    the page
config.js                     settings: company name, Google Sheet address, sign-in codes
assets/styles.css             the look
assets/app.js                 how the CRM works
assets/schema.js              departments, registers, fields and statuses
assets/seed.js                starting records
assets/store.js               saving to this computer or to the Google Sheet
google-apps-script/Code.gs    the Google Sheet connection
```

To add a field or a status, edit `assets/schema.js`. To change a department's name or lead, edit the list at the top of the same file.

## A note on security

The team code keeps casual visitors out, but this is not bank-grade security. Never store passwords, OTPs, card numbers or passport scans in the CRM. Change the codes in Script properties whenever someone leaves the company.
