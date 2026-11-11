// Person form rules: instrument parsing and the shared validation schema (no emulator).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PersonForm, validatePerson, fieldErrors, parseInstruments, personIssues } from "@/schema";

test("parseInstruments splits, trims, drops blanks and repeats", () => {
  assert.deepEqual(parseInstruments(" violin, vocals ,, Violin\nguitar"), ["violin", "vocals", "guitar"]);
});

test("person rules: name, kind, instruments, email, role, AI access, each at its field", () => {
  assert.deepEqual(validatePerson({ name: " ", bandMember: false, team: false }).errors, { name: "Enter a name", kind: "Pick Band Member, Team, or both" });
  assert.deepEqual(validatePerson({ name: "A", bandMember: true, team: false, instruments: " , " }).errors, { instruments: "Add at least one instrument" });
  assert.deepEqual(validatePerson({ name: "A", bandMember: false, team: true, email: "nope", role: "" }).errors, { email: "Email address invalid", role: "Pick a role" });
  assert.deepEqual(validatePerson({ name: "A", bandMember: false, team: true, email: "a@b.co", role: "member", mcpAccess: true }).errors, { mcpAccess: "Only Admins can have AI access" });
  const good = validatePerson({ name: " Ann ", bandMember: true, team: true, instruments: "violin, vocals", email: " Ann@Example.COM ", role: "admin", mcpAccess: true });
  assert.deepEqual(good.values, { name: "Ann", bandMember: true, team: true, instruments: ["violin", "vocals"], email: "ann@example.com", role: "admin", mcpAccess: true });
  // band-only ignores email and role
  assert.equal(PersonForm.safeParse({ name: "B", bandMember: true, team: false, instruments: ["drums"], email: "junk" }).success, true);
  assert.deepEqual(personIssues({ name: "B", bandMember: true, team: false, instruments: ["drums"] }), []);
  assert.deepEqual(fieldErrors({ issues: [{ path: ["musician", "instruments"], message: "x" }, { path: [], message: "root" }] }), { instruments: "x", kind: "root" });
});
