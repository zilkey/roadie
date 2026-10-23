import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "@/server/commands/dispatch";
import { hiddenSections } from "@/server/prefs";
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
});

test("Roadie is offered sections.setHidden", () => {
  assert.ok(toolDefs("admin").some((t) => t.name === "sections.setHidden"));
});
