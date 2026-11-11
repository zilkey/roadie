import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePeople, guards, MSG } from "@/components/people/shared";
import type { Musician, User } from "@/schema";
import type { Row } from "@/lib/firestore-hooks";

// The People page disables actions with these reasons; the server enforces the same rules (people.test.ts).
const A = "artist-1";
const user = (id: string, role: "admin" | "member", musicianId?: string) =>
  ({ id, email: `${id}@example.com`, name: id, artists: [{ artistId: A, role }], musicianId }) as unknown as Row<User>;
const musician = (id: string, extra: Partial<Musician> = {}) =>
  ({ id, name: id, instruments: ["bass"], active: true, ...extra }) as unknown as Row<Musician>;
const find = (all: ReturnType<typeof derivePeople>, name: string) => all.find((p) => p.name === name)!;

test("last Admin: someone else who is the only Admin can't be demoted, lose Team access or be archived", () => {
  // "me" is Standard here, so the self guards don't mask the last-Admin one
  const all = derivePeople([user("ann", "admin", "m-ann"), user("me", "member")], [musician("m-ann"), musician("m-bo")], A, "me");
  const g = guards(find(all, "ann"), all);
  assert.equal(g.demote, MSG.lastAdmin);
  assert.equal(g.removeTeam, MSG.lastAdmin);
  assert.equal(g.archive, MSG.lastAdmin);
  assert.equal(g.removeBand, null);
});

test("two Admins: neither is the last one", () => {
  const all = derivePeople([user("ann", "admin"), user("cy", "admin"), user("me", "member")], [musician("m-bo")], A, "me");
  assert.deepEqual(guards(find(all, "ann"), all), { demote: null, removeTeam: null, removeBand: null, archive: null });
});

test("last Band Member can't be removed from the band or archived; archived musicians don't count", () => {
  const all = derivePeople([user("me", "admin"), user("cy", "admin", "m-cy")], [musician("m-cy"), musician("old", { archivedAt: new Date() as never })], A, "me");
  const g = guards(find(all, "cy"), all);
  assert.equal(g.removeBand, MSG.lastBand);
  assert.equal(g.archive, MSG.lastBand);
  assert.equal(g.removeTeam, null);
});

test("self: your own row can't lose Team access, be archived or be demoted", () => {
  const all = derivePeople([user("me", "admin", "m-me"), user("cy", "admin")], [musician("m-me"), musician("m-bo")], A, "me");
  const g = guards(find(all, "me"), all);
  assert.equal(g.removeTeam, MSG.ownTeam);
  assert.equal(g.archive, MSG.ownTeam);
  assert.equal(g.demote, MSG.demoteSelf);
});
