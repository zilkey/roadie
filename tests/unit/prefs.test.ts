// Prefs: Roadie's tool list offers sections.setHidden (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolDefs } from "@/server/assistant/tools";

test("Roadie is offered sections.setHidden", () => {
  assert.ok(toolDefs("admin").some((t) => t.name === "sections.setHidden"));
});
