// Covers stage plot command exposure to Roadie and MCP, and the ask-first policy (no database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registry } from "@/server/commands/registry";
import { isReadOnly, needsConfirm, summarize } from "@/server/assistant/policy";
import { toolDefs } from "@/server/assistant/tools";
import { toolList } from "../../mcp/tools";

const PLOT_COMMANDS = Object.keys(registry).filter((n) => n.startsWith("stagePlots.") || n === "shows.setStagePlot");
const READS = ["stagePlots.list", "stagePlots.get", "stagePlots.staleShows", "stagePlots.engineerLink"];
const ASKS = ["stagePlots.shareLink", "stagePlots.shareOff", "stagePlots.remove"];


test("every stage plot command is a Roadie tool and an MCP tool (the engineer-link read is member-readable and not an MCP-only extra)", () => {
  assert.ok(PLOT_COMMANDS.length >= 20);
  const roadie = new Set(toolDefs("admin").map((t) => t.name));
  const mcp = new Set(toolList().map((t) => t.name));
  for (const n of PLOT_COMMANDS) {
    assert.ok(registry[n].roles.includes("admin"), `${n} admin`);
    const adminOnly = n === "stagePlots.remove"; // archiving stays with signed-in admins, not MCP
    assert.equal(registry[n].roles.includes("mcp"), !adminOnly, `${n} mcp`);
    assert.ok(roadie.has(n), `${n} is offered to Roadie`);
    assert.equal(mcp.has(n), !adminOnly, `${n} is an MCP tool`);
    assert.ok(registry[n].description.length > 40, `${n} has a description a model can pick from`);
  }
  assert.deepEqual(toolDefs("member"), [], "Roadie is for admins");
  for (const n of PLOT_COMMANDS.filter((c) => !READS.includes(c))) assert.equal(registry[n].roles.includes("member"), false, `${n}: members read, admins edit`);
});

test("policy: reads never ask; link on/off and remove always ask; ordinary edits do not, whatever the row count", () => {
  for (const n of READS) assert.equal(isReadOnly(n), true, n);
  for (const n of PLOT_COMMANDS.filter((c) => !READS.includes(c))) assert.equal(isReadOnly(n), false, n);
  for (const n of ASKS) assert.equal(needsConfirm(n, { id: "p" }), true, n);
  const eight = Array.from({ length: 8 }, (_, i) => ({ n: i + 1, source: `Ch ${i + 1}` }));
  assert.equal(needsConfirm("stagePlots.updateInputs", { id: "p", inputs: eight }), false, "filling a whole plot is one record");
  assert.equal(needsConfirm("stagePlots.move", { id: "p", moves: eight.map((r) => ({ id: String(r.n), x: 1, y: 1 })) }), false);
  assert.equal(needsConfirm("stagePlots.setMonitors", { id: "p", monitors: eight.map((r) => ({ n: r.n, wants: "Vox" })) }), false);
  for (const [n, input] of [["stagePlots.create", { name: "Duo", configurationId: "duo" }], ["stagePlots.copy", { id: "p", dropMusicianIds: ["m"] }], ["stagePlots.rename", { id: "p", name: "X" }],
    ["stagePlots.setInputCount", { id: "p", count: 4 }], ["stagePlots.setMixCount", { id: "p", count: 2 }], ["stagePlots.setStage", { id: "p", widthFt: 20, depthFt: 14 }],
    ["stagePlots.setBringNeed", { id: "p", need: "4 wedges" }], ["shows.setStagePlot", { showId: "s", stagePlotId: "p" }]] as const)
    assert.equal(needsConfirm(n, input), false, n);
  assert.match(summarize("stagePlots.shareLink", { id: "p" }, "Duo"), /public engineer link.*no login/);
  assert.match(summarize("stagePlots.shareOff", { id: "p" }), /link already sent stops working/);
  assert.equal(summarize("stagePlots.remove", { id: "p" }, "Duo"), "Archive the stage plot Duo: its engineer link stops working and shows that picked it are cleared");
});
