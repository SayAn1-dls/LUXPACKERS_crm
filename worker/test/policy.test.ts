import { describe, expect, it } from "vitest";
import type { Perms } from "../../shared/schema";
import type { Role, SessionUser } from "../src/env";
import {
  canAddPeople, canApproveTask, canAssignTo, canCreateUserWithPosition, canDecideLeave, canDeleteRecord, canEditSettings,
  canEditTaskStatus, canEditUsers, canImport, canListLeave, canManagePositions, canReadRegister, canSeeAudit,
  canSeePeoplePrivate, canSeeTask, canUseTrash, canWriteRegister, registerLevel,
  type AssigneeRef, type TaskRef,
} from "../src/lib/policy";
import { ADMIN_PERMS, NO_PERMS, STARTER_POSITIONS, parsePerms, roleLabel } from "../src/lib/positions";

const ROLES: Role[] = ["admin", "manager", "hr", "employee"];
const starter = (role: Role) => STARTER_POSITIONS.find((p) => p.id === `pos_${role}`)!;
const mk = (role: Role, dept: string, id = `${role}-${dept}`, managerId: string | null = null): SessionUser => ({
  id, name: id, email: `${id}@x.test`, role, dept, managerId, mustChangePassword: false,
  positionId: `pos_${role}`, positionName: starter(role).name, isAdmin: role === "admin", perms: starter(role).perms,
});
const custom = (perms: Partial<Perms>, dept = "Sales & Reservations", id = "c1", managerId: string | null = null): SessionUser => ({
  ...mk("employee", dept, id, managerId), positionId: "pos_custom", positionName: "Custom", isAdmin: false,
  perms: { ...NO_PERMS, ...perms, registers: { ...NO_PERMS.registers, ...(perms.registers ?? {}) } },
});

const SALES = "Sales & Reservations", OPS = "Operations", FIN = "Finance", TECH = "Technology", MGMT = "Management";

describe("register access by position (department no longer matters)", () => {
  const depts = [SALES, OPS, FIN, TECH, MGMT];
  const expected: Record<Role, Record<string, "none" | "view" | "edit" | "manage">> = {
    admin: { leads: "manage", bookings: "manage", trips: "manage", finance: "manage", partners: "manage", content: "manage", access: "manage" },
    manager: { leads: "manage", bookings: "manage", trips: "manage", finance: "none", partners: "manage", content: "manage", access: "none" },
    hr: { leads: "none", bookings: "none", trips: "none", finance: "none", partners: "none", content: "none", access: "none" },
    employee: { leads: "none", bookings: "none", trips: "none", finance: "none", partners: "none", content: "none", access: "none" },
  };
  for (const role of ROLES) {
    for (const [reg, level] of Object.entries(expected[role])) {
      it(`${role} -> ${reg}: ${level}, in every department`, () => {
        for (const dept of depts) {
          const u = mk(role, dept);
          expect(registerLevel(u, reg)).toBe(level);
          expect(canReadRegister(u, reg)).toBe(level !== "none");
          expect(canWriteRegister(u, reg)).toBe(level === "edit" || level === "manage");
          expect(canDeleteRecord(u, reg)).toBe(level === "manage");
        }
      });
    }
  }
  it("view reads only; edit writes; manage deletes", () => {
    const v = custom({ registers: { finance: "view" } });
    expect([canReadRegister(v, "finance"), canWriteRegister(v, "finance"), canDeleteRecord(v, "finance")]).toEqual([true, false, false]);
    const e = custom({ registers: { finance: "edit" } });
    expect([canReadRegister(e, "finance"), canWriteRegister(e, "finance"), canDeleteRecord(e, "finance")]).toEqual([true, true, false]);
    const m = custom({ registers: { finance: "manage" } });
    expect([canReadRegister(m, "finance"), canWriteRegister(m, "finance"), canDeleteRecord(m, "finance")]).toEqual([true, true, true]);
  });
  it("unknown register ids are denied for everyone, admin included", () => {
    for (const role of ROLES) {
      const u = mk(role, FIN);
      for (const id of ["nope", "", "Finance", "__proto__", "tasks", "toString", "constructor"]) {
        expect(canReadRegister(u, id)).toBe(false);
        expect(canWriteRegister(u, id)).toBe(false);
        expect(canDeleteRecord(u, id)).toBe(false);
      }
    }
  });
});

describe("admin-only areas", () => {
  it.each(ROLES)("%s", (role) => {
    const u = mk(role, MGMT);
    const exp = role === "admin";
    for (const f of [canManagePositions, canEditUsers, canImport, canSeeAudit, canUseTrash, canEditSettings]) expect(f(u)).toBe(exp);
  });
  it("a custom position with every permission is still not admin", () => {
    const u = custom({ ...ADMIN_PERMS });
    for (const f of [canManagePositions, canEditUsers, canImport, canSeeAudit, canUseTrash, canEditSettings]) expect(f(u)).toBe(false);
  });
});

describe("positions helpers", () => {
  it("parsePerms fails closed on anything unreadable", () => {
    expect(parsePerms(null)).toEqual(NO_PERMS);
    expect(parsePerms("not json")).toEqual(NO_PERMS);
    expect(parsePerms(JSON.stringify({ ...NO_PERMS, tasks: "everything" }))).toEqual(NO_PERMS);
    expect(parsePerms(JSON.stringify({ ...NO_PERMS, registers: { leads: "edit" } }))).toEqual(NO_PERMS);
    expect(parsePerms(JSON.stringify(ADMIN_PERMS))).toEqual(ADMIN_PERMS);
  });
  it("role label follows the starter positions", () => {
    for (const p of STARTER_POSITIONS) expect(roleLabel(p.isAdmin, p.perms)).toBe(p.role);
  });
});

describe("canAssignTo", () => {
  const target = (id: string, dept: string, managerId: string | null = null) => ({ id, dept, managerId });
  it("admin (all) assigns to anyone; hr starter (own) only to themselves", () => {
    expect(canAssignTo(mk("admin", MGMT), target("z", TECH))).toBe(true);
    expect(canAssignTo(mk("hr", "People & Interns"), target("z", TECH))).toBe(false);
    expect(canAssignTo(mk("hr", "People & Interns", "h"), target("h", TECH))).toBe(true);
  });
  it("custom tasks=all assigns to anyone; tasks=team like a manager", () => {
    expect(canAssignTo(custom({ tasks: "all" }, SALES), target("z", TECH))).toBe(true);
    const t = custom({ tasks: "team" }, SALES, "t1");
    expect(canAssignTo(t, target("a", SALES))).toBe(true);
    expect(canAssignTo(t, target("b", FIN, "t1"))).toBe(true);
    expect(canAssignTo(t, target("c", FIN))).toBe(false);
  });
  it("manager: same dept or direct report only", () => {
    const m = mk("manager", SALES, "m1");
    expect(canAssignTo(m, target("a", SALES))).toBe(true);
    expect(canAssignTo(m, target("b", FIN, "m1"))).toBe(true);
    expect(canAssignTo(m, target("c", FIN, "other"))).toBe(false);
    expect(canAssignTo(m, target("d", FIN))).toBe(false);
  });
  it("employee: only themselves", () => {
    const e = mk("employee", SALES, "e1");
    expect(canAssignTo(e, target("e1", SALES))).toBe(true);
    expect(canAssignTo(e, target("e2", SALES))).toBe(false);
    expect(canAssignTo(e, target("e3", FIN, "e1"))).toBe(false);
  });
  it("manager and hr can always assign to themselves", () => {
    expect(canAssignTo(mk("manager", SALES, "m1"), target("m1", FIN))).toBe(true);
  });
});

describe("canSeeTask", () => {
  const t: TaskRef = { assigneeId: "emp", assignedById: "boss", dept: SALES };
  const assignee: AssigneeRef = { managerId: "mgr-other" };
  it.each([
    ["admin", mk("admin", MGMT), true],
    ["assignee", mk("employee", FIN, "emp"), true],
    ["assigner", mk("employee", FIN, "boss"), true],
    ["manager of task dept", mk("manager", SALES, "m1"), true],
    ["manager of assignee", mk("manager", FIN, "mgr-other"), true],
    ["manager of other dept", mk("manager", FIN, "m2"), false],
    ["unrelated employee in same dept", mk("employee", SALES, "x"), false],
    ["hr, unrelated", mk("hr", "People & Interns", "h"), false],
    ["employee whose managerId matches (not a manager)", mk("employee", FIN, "mgr-other"), false],
  ])("%s -> %s", (_n, u, exp) => {
    expect(canSeeTask(u, t, assignee)).toBe(exp);
  });
  it("works with no assignee info and unassigned tasks", () => {
    expect(canSeeTask(mk("manager", FIN, "mgr-other"), t)).toBe(false);
    const un: TaskRef = { assigneeId: null, assignedById: "boss", dept: SALES };
    expect(canSeeTask(mk("employee", SALES, "x"), un)).toBe(false);
    expect(canSeeTask(mk("employee", SALES, "boss"), un)).toBe(true);
    expect(canSeeTask(mk("manager", SALES, "m"), un)).toBe(true);
  });
});

describe("canApproveTask", () => {
  const t: TaskRef = { assigneeId: "emp", assignedById: "boss", dept: SALES };
  const assignee: AssigneeRef = { managerId: "mgr-other" };
  it.each([
    ["admin", mk("admin", MGMT), true],
    ["assigner", mk("employee", FIN, "boss"), true],
    ["manager of dept", mk("manager", SALES, "m1"), true],
    ["manager of assignee", mk("manager", FIN, "mgr-other"), true],
    ["manager elsewhere", mk("manager", FIN, "m2"), false],
    ["assignee employee", mk("employee", SALES, "emp"), false],
    ["unrelated employee", mk("employee", SALES, "x"), false],
    ["hr", mk("hr", "People & Interns", "h"), false],
  ])("%s -> %s", (_n, u, exp) => {
    expect(canApproveTask(u, t, assignee)).toBe(exp);
  });
  it("manager who is the assignee cannot approve their own task", () => {
    const own: TaskRef = { assigneeId: "m1", assignedById: "boss", dept: SALES };
    expect(canApproveTask(mk("manager", SALES, "m1"), own, { managerId: null })).toBe(false);
  });
  it("admin who is the assignee cannot approve; assigner==assignee cannot approve", () => {
    expect(canApproveTask(mk("admin", MGMT, "a1"), { assigneeId: "a1", assignedById: "boss", dept: SALES }, { managerId: null })).toBe(false);
    expect(canApproveTask(mk("employee", SALES, "s"), { assigneeId: "s", assignedById: "s", dept: SALES }, { managerId: null })).toBe(false);
  });
  it("missing assignee info does not grant manager-of-assignee", () => {
    expect(canApproveTask(mk("manager", FIN, "mgr-other"), t, null)).toBe(false);
  });
});

describe("canEditTaskStatus", () => {
  const assigned: TaskRef = { assigneeId: "emp", assignedById: "boss", dept: SALES };
  const selfOwned: TaskRef = { assigneeId: "emp", assignedById: "emp", dept: SALES };
  const emp = mk("employee", SALES, "emp");
  const nonDone = ["To do", "In progress", "Waiting", "Blocked", "Submitted"];
  it("assignee may set non-Done statuses on an assigned task", () => {
    for (const s of nonDone) expect(canEditTaskStatus(emp, assigned, s)).toBe(true);
  });
  it("assignee may not set Done on a task someone else assigned", () => {
    expect(canEditTaskStatus(emp, assigned, "Done")).toBe(false);
  });
  it("assignee may set Done on a self-assigned task", () => {
    expect(canEditTaskStatus(emp, selfOwned, "Done")).toBe(true);
  });
  it("approvers may set any status", () => {
    for (const s of [...nonDone, "Done"]) {
      expect(canEditTaskStatus(mk("employee", FIN, "boss"), assigned, s, { managerId: null })).toBe(true);
      expect(canEditTaskStatus(mk("admin", MGMT), assigned, s, { managerId: null })).toBe(true);
      expect(canEditTaskStatus(mk("manager", SALES, "m1"), assigned, s, { managerId: null })).toBe(true);
    }
  });
  it("manager-of-assignee approves only when assignee info is passed", () => {
    const m = mk("manager", FIN, "mgr-other");
    expect(canEditTaskStatus(m, assigned, "Done")).toBe(false);
    expect(canEditTaskStatus(m, assigned, "Done", { managerId: "mgr-other" })).toBe(true);
  });
  it("manager who is the assignee follows the assignee rule, not approver", () => {
    const m = mk("manager", SALES, "m1");
    const t: TaskRef = { assigneeId: "m1", assignedById: "boss", dept: SALES };
    expect(canEditTaskStatus(m, t, "Submitted", { managerId: null })).toBe(true);
    expect(canEditTaskStatus(m, t, "Done", { managerId: null })).toBe(false);
  });
  it("others cannot edit; unknown statuses denied for everyone", () => {
    expect(canEditTaskStatus(mk("employee", SALES, "x"), assigned, "In progress")).toBe(false);
    expect(canEditTaskStatus(mk("hr", "People & Interns"), assigned, "In progress")).toBe(false);
    for (const s of ["", "done", "Cancelled", "DONE "]) {
      expect(canEditTaskStatus(emp, selfOwned, s)).toBe(false);
      expect(canEditTaskStatus(mk("admin", MGMT), assigned, s)).toBe(false);
    }
  });
  it("unassigned task: only approvers", () => {
    const un: TaskRef = { assigneeId: null, assignedById: "boss", dept: SALES };
    expect(canEditTaskStatus(emp, un, "In progress")).toBe(false);
    expect(canEditTaskStatus(mk("employee", SALES, "boss"), un, "Done")).toBe(true);
  });
});

describe("canDecideLeave", () => {
  const req = { id: "r", managerId: "mgr" };
  it.each([
    ["admin", mk("admin", MGMT, "a"), true],
    ["hr", mk("hr", SALES, "h"), true],
    ["requester's manager", mk("manager", FIN, "mgr"), true],
    ["other manager", mk("manager", SALES, "m2"), false],
    ["employee", mk("employee", SALES, "e"), false],
  ])("%s -> %s", (_n, u, exp) => expect(canDecideLeave(u, req)).toBe(exp));
  it("nobody decides their own leave", () => {
    for (const role of ROLES) {
      expect(canDecideLeave(mk(role, SALES, "r"), { id: "r", managerId: "r" })).toBe(false);
      expect(canDecideLeave(mk(role, SALES, "r"), { id: "r", managerId: null })).toBe(false);
    }
  });
  it("no manager: only hr or admin", () => {
    const none = { id: "r", managerId: null };
    expect(canDecideLeave(mk("manager", SALES, "m"), none)).toBe(false);
    expect(canDecideLeave(mk("hr", SALES, "h"), none)).toBe(true);
    expect(canDecideLeave(mk("admin", SALES, "a"), none)).toBe(true);
  });
});

describe("canSeePeoplePrivate", () => {
  it.each([["admin", true], ["hr", true], ["manager", false], ["employee", false]] as const)("%s -> %s", (r, exp) => {
    expect(canSeePeoplePrivate(mk(r, SALES))).toBe(exp);
  });
});

describe("canDecideLeave role check", () => {
  const req = { id: "r", managerId: "mgr" };
  it("employee who is someone's managerId cannot decide", () => {
    expect(canDecideLeave(mk("employee", SALES, "mgr"), req)).toBe(false);
  });
  it("manager with that id can", () => {
    expect(canDecideLeave(mk("manager", SALES, "mgr"), req)).toBe(true);
  });
});


describe("tasks scope from position", () => {
  const t: TaskRef = { assigneeId: "emp", assignedById: "boss", dept: SALES };
  it("tasks=all sees and approves everything (but never their own)", () => {
    const u = custom({ tasks: "all" }, TECH, "x");
    expect(canSeeTask(u, t)).toBe(true);
    expect(canApproveTask(u, t)).toBe(true);
    expect(canApproveTask(custom({ tasks: "all" }, TECH, "emp"), t)).toBe(false);
  });
  it("tasks=team sees same department and reports, not others", () => {
    expect(canSeeTask(custom({ tasks: "team" }, SALES, "x"), t)).toBe(true);
    expect(canSeeTask(custom({ tasks: "team" }, FIN, "x"), t, { managerId: "x" })).toBe(true);
    expect(canSeeTask(custom({ tasks: "team" }, FIN, "x"), t, { managerId: "y" })).toBe(false);
  });
  it("tasks=own sees only on-me or by-me", () => {
    expect(canSeeTask(custom({ tasks: "own" }, SALES, "x"), t, { managerId: "x" })).toBe(false);
  });
});

describe("leave approval and lists from position", () => {
  it("leave=all decides anyone's but their own", () => {
    const u = custom({ leave: "all" }, TECH, "x");
    expect(canDecideLeave(u, { id: "r", managerId: null, dept: SALES })).toBe(true);
    expect(canDecideLeave(u, { id: "x", managerId: null, dept: TECH })).toBe(false);
  });
  it("leave=team decides same department or reports", () => {
    const u = custom({ leave: "team" }, SALES, "x");
    expect(canDecideLeave(u, { id: "r", managerId: null, dept: SALES })).toBe(true);
    expect(canDecideLeave(u, { id: "r", managerId: "x", dept: FIN })).toBe(true);
    expect(canDecideLeave(u, { id: "r", managerId: "y", dept: FIN })).toBe(false);
  });
  it("leave=own decides nobody's", () => {
    expect(canDecideLeave(custom({ leave: "own" }, SALES, "x"), { id: "r", managerId: "x", dept: SALES })).toBe(false);
  });
  it("list tabs", () => {
    expect(["mine", "team", "all"].map((s) => canListLeave(custom({ leave: "own" }), s as never))).toEqual([true, false, false]);
    expect(["mine", "team", "all"].map((s) => canListLeave(custom({ leave: "team" }), s as never))).toEqual([true, true, false]);
    expect(["mine", "team", "all"].map((s) => canListLeave(custom({ leave: "all" }), s as never))).toEqual([true, true, true]);
    expect(canListLeave(mk("admin", MGMT), "all")).toBe(true);
  });
});

describe("people", () => {
  it("addPeople creates Employee-position accounts only; admin any position", () => {
    const hr = mk("hr", "People & Interns");
    expect(canAddPeople(hr)).toBe(true);
    expect(canCreateUserWithPosition(hr, "pos_employee")).toBe(true);
    for (const p of ["pos_manager", "pos_hr", "pos_admin", "pos_custom"]) expect(canCreateUserWithPosition(hr, p)).toBe(false);
    expect(canCreateUserWithPosition(mk("admin", MGMT), "pos_manager")).toBe(true);
    expect(canAddPeople(mk("manager", SALES))).toBe(false);
    expect(canCreateUserWithPosition(mk("manager", SALES), "pos_employee")).toBe(false);
  });
  it("people=full sees private fields", () => {
    expect(canSeePeoplePrivate(custom({ people: "full" }))).toBe(true);
    expect(canSeePeoplePrivate(custom({ people: "basic" }))).toBe(false);
  });
});
