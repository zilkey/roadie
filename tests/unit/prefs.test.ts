import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { hiddenSections, sectionOrder } from "@/server/prefs";
import { toolDefs } from "@/server/assistant/tools";
import { resetEmulators, makeUser } from "./helpers";

beforeEach(resetEmulators);
const bearer = (t: string) => `Bearer ${t}`;

test("sections.setHidden: per user, idempotent, can be brought back; unknown sections are refused", async () => {
  const jeff = await makeUser("jeff@example.com", "admin");
  const david = await makeUser("david@example.com", "member");
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  assert.deepEqual(await hiddenSections(jeff.uid), []);
  assert.equal((await call(jeff.token, "sections.setHidden", { section: "booking", hidden: true })).status, 200);
  await call(jeff.token, "sections.setHidden", { section: "booking", hidden: true });
  await call(jeff.token, "sections.setHidden", { section: "money", hidden: true });
  assert.deepEqual(await hiddenSections(jeff.uid), ["booking", "money"]);
  assert.deepEqual(await hiddenSections(david.uid), [], "someone else's menu is untouched");
  assert.equal((await call(david.token, "sections.setHidden", { section: "songs", hidden: true })).status, 200);
  const l = await call(jeff.token, "sections.hidden", {});
  assert.deepEqual((l.json as { result: { hiddenSections: string[] } }).result.hiddenSections, ["booking", "money"]);
  await call(jeff.token, "sections.setHidden", { section: "booking", hidden: false });
  assert.deepEqual(await hiddenSections(jeff.uid), ["money"]);
  assert.equal((await call(jeff.token, "sections.setHidden", { section: "home", hidden: true })).status, 400);
  assert.equal((await call(jeff.token, "sections.setHidden", { section: "calendar", hidden: true })).status, 400);
});

test("Roadie is offered sections.setHidden", () => {
  assert.ok(toolDefs("admin").some((t) => t.name === "sections.setHidden"));
});

test("sections.setOrder: per user, completed with the default order, duplicates and unknown sections refused", async () => {
  const call = (tok: string, name: string, body: unknown) => dispatch(name, bearer(tok), body);
  const jeff = await makeUser("jeff@example.com", "admin");
  const david = await makeUser("david@example.com", "member");
  assert.deepEqual(await sectionOrder(jeff.uid), ["shows", "booking", "templates", "songs", "setlists", "rehearsals", "money"]);
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["money", "songs"] })).status, 200);
  assert.deepEqual(await sectionOrder(jeff.uid), ["money", "songs", "shows", "booking", "templates", "setlists", "rehearsals"]);
  assert.deepEqual(await sectionOrder(david.uid), ["shows", "booking", "templates", "songs", "setlists", "rehearsals", "money"], "someone else's menu is untouched");
  await call(jeff.token, "sections.setHidden", { section: "booking", hidden: true });
  assert.deepEqual(await sectionOrder(jeff.uid), ["money", "songs", "shows", "booking", "templates", "setlists", "rehearsals"], "hiding keeps the order");
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["money", "money"] })).status, 400);
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["home"] })).status, 400);
  assert.equal((await call(jeff.token, "sections.setOrder", { order: ["calendar"] })).status, 400);
});
