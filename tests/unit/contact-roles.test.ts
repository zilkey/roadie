import { test } from "node:test";
import assert from "node:assert/strict";
import { isAgent, isManager } from "@/lib/contactRoles";

test("isManager: any kind of manager, judged on the role, not the company", () => {
  for (const t of ["Booking manager", "Artist manager", "Manager", "Manager at KMA Management for Poe The Passenger", "Manager, JRNE Artist Management", "Artist management", "Tour Mgmt", "General Manager"])
    assert.equal(isManager(t), true, t);
  for (const t of [undefined, "", "Talent buyer", "Booking agent at Foo Management for Bar", "General contact at Team Mgmt", "Publicist for Managerial"])
    assert.equal(isManager(t), false, String(t));
});

test("isAgent: booking and talent agents, not people at an agency", () => {
  for (const t of ["Booking agent", "Booking agent at CAA for Tiny Habits", "Booking agent, Reliant Talent Agency", "Talent Agent", "Agent"])
    assert.equal(isAgent(t), true, t);
  for (const t of [undefined, "Booking manager", "Booking Contact", "Publicist at Agent Co", "Manager, Foo Agency", "Agency rep"])
    assert.equal(isAgent(t), false, String(t));
});
