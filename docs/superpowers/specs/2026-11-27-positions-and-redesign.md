# Positions, admin-set logins, clean sidebar, visual refresh

Status: approved by user 2026-11-27. Builds on 2026-11-26-role-based-crm-design.md.

## Why
The admin is non-technical and wants to decide, per post, exactly what each person can open. The four fixed roles are too rigid, and the sidebar shows too much.

## 1. Positions (replace fixed roles as the source of permissions)
- New table `positions(id, name UNIQUE, is_admin INTEGER, perms TEXT JSON, created_at, updated_at)`; `users.position_id` → positions. Only admin may create/edit/delete positions or change a user's position. A position in use can't be deleted (409).
- `perms` shape (every key required, validated with zod):
  ```
  { tasks: "own" | "team" | "all",
    registers: { [registerId]: "none" | "view" | "edit" | "manage" },   // manage = edit + delete
    leave: "own" | "team" | "all",                                      // who they can approve
    people: "basic" | "full",                                           // full = private fields + onboarding
    addPeople: boolean }                                                // may create employee-level accounts (no position change rights)
  ```
- `is_admin` positions have everything regardless of perms. Exactly one built-in "Admin" position, undeletable, can't be un-admined; the last admin user can't lose admin.
- "team" = users in the same department OR whose manager_id is me (existing rule).
- **Register access rule:** admin → everything. Everyone else gets exactly the level their position sets for that register; department no longer gates registers. view = read; edit = read + create + edit; manage = edit + move to Trash.
- Migration 0002 creates four starter positions and maps existing users by role:
  - Admin (is_admin)
  - Manager: tasks team, leave team, people basic, addPeople false; registers leads/bookings/trips/partners/content = manage, finance/access = none
  - HR: tasks own, leave all, people full, addPeople true; all registers none
  - Employee: tasks own, leave own, people basic; registers leads/bookings/trips/partners/content = edit, finance/access = none
  Admin then adjusts or adds positions (e.g. "Finance Head" with finance = manage).
- `users.role` stays as a derived label for display (admin / head / staff) — all server checks go through `policy.ts` using the position.

## 2. Admin-set logins
- Admin creates a person with work email + a password the admin types (min 10 chars) or "Generate". Admin can change a person's email and set a new password any time; setting a password signs that person out everywhere. `must_change_password` is optional (checkbox "Ask them to choose their own password at first sign-in", default on).
- Existing passwords are never shown or retrievable.

## 3. Sidebar
- Built only from the caller's permissions (from `/api/me`, which now returns `perms` and `isAdmin`). Groups: **Work** (Home, My tasks, Leave), **Registers** (only those not "none"), **Team** (People — only if people=full or addPeople), **Admin** (Positions, People & logins, Import, Audit, Trash, Settings — admin only). Simple inline SVG icons; at most ~5 items for a typical employee.

## 4. Visual refresh
- Keep ink/paper/oxblood identity, no purple, no gradients. Softer surfaces (warm off-white cards, 12px radius, subtle shadow), friendlier type scale, pill buttons, coloured status chips, simple icons, illustrated-feeling empty states (text + icon, no images), generous spacing, mobile-first.
- Admin home leads with three big actions: Add a person, Create a position, Assign a task; then needs-attention and figures.
- A **Positions** page: list of positions with member counts; editor is a plain checklist/radio grid with one-line explanations ("Can see every task in the company").
