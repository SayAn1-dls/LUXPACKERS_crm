import { describe, expect, it } from "vitest";
import {
  DEPARTMENTS, ONBOARDING_STEPS, REGISTERS, ROLES, TASK_STATUSES, registerDepts,
} from "../../shared/schema";

describe("shared schema", () => {
  it("exports roles and task statuses exactly", () => {
    expect([...ROLES]).toEqual(["admin", "manager", "hr", "employee"]);
    expect([...TASK_STATUSES]).toEqual(["To do", "In progress", "Waiting", "Blocked", "Submitted", "Done"]);
  });

  it("has 7 registers without tasks or team", () => {
    expect(REGISTERS.map((r) => r.id)).toEqual(
      ["leads", "bookings", "trips", "finance", "partners", "content", "access"],
    );
  });

  it("never lists tasks or team in department registers", () => {
    for (const d of DEPARTMENTS) {
      expect(d.registers).not.toContain("tasks");
      expect(d.registers).not.toContain("team");
    }
  });

  it("registerDepts returns departments listing the register", () => {
    expect(registerDepts("bookings")).toEqual(["Sales & Reservations", "Operations", "Finance"]);
    expect(registerDepts("access")).toEqual(["Technology"]);
    expect(registerDepts("nope")).toEqual([]);
  });

  it("replaces person owner fields with owner_id", () => {
    for (const r of REGISTERS) {
      expect(r.fields.some((f) => f.key === "owner")).toBe(false);
      if (r.fields.some((f) => f.key === "owner_id")) {
        expect(r.fields.find((f) => f.key === "owner_id")!.type).toBe("person");
      }
    }
  });

  it("has 6 onboarding steps", () => {
    expect(ONBOARDING_STEPS).toHaveLength(6);
  });
});
