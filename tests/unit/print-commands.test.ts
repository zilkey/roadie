// Print commands: printLink is an MCP tool and a read-only Roadie tool (registry only, no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { isReadOnly } from "@/server/assistant/policy";
import { toolDefs } from "@/server/assistant/tools";
import { toolList } from "../../mcp/tools";

test("setlists.printLink is an MCP tool and a read-only Roadie tool; the prefs commands are the app's only", () => {
  assert.ok(registry["setlists.printLink"].roles.includes("mcp"));
  assert.ok(registry["setlists.printLink"].roles.includes("admin"));
  assert.ok(registry["setlists.printLink"].roles.includes("member"));
  assert.ok(toolList().some((t) => t.name === "setlists.printLink"));
  assert.ok(isReadOnly("setlists.printLink"));
  assert.ok(toolDefs("admin").some((t) => t.name === "setlists.printLink"));
  assert.equal(registry["setlists.printPrefs"].roles.includes("mcp"), false);
  assert.equal(registry["setlists.setPrintPrefs"].roles.includes("mcp"), false);
  assert.equal(isReadOnly("setlists.setPrintPrefs"), false);
});
