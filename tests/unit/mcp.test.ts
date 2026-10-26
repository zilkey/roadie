import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { gmailClient } from "@/server/integrations";
import { hashToken } from "@/server/availability";
import { authenticateToken } from "../../mcp/auth";
import { callTool, toolList } from "../../mcp/tools";
import { handleMcpRequest, sessionIdFor, SESSION_HEADER } from "../../mcp/web";
import { resetEmulators, makeUser, venue } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let admin: Ctx;
let adminUid: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.BANDSINTOWN_BASE_URL = s.running["fake-bandsintown"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.GMAIL_BASE_URL + "/__reset", { method: "POST" });
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  adminUid = u.uid;
  await db.update(importCtx(), "users", u.uid, { mcpAccess: true });
  admin = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
});

const run = async (name: string, input: unknown, c: Ctx = admin) => (await registry[name].run(c, registry[name].input.parse(input))) as Record<string, any>;
/** Keys are minted outside the app now (no command), so tests write the hashed doc directly. */
const newKey = async (label = "Jeff · Claude") => {
  const token = `btk_${randomBytes(32).toString("base64url")}`;
  const id = hashToken(token);
  await db.create(importCtx(), "mcpTokens", { userId: adminUid, label }, { id });
  return { token, id };
};
const mcpCtx = (uid = adminUid, runId = newRunId()): Ctx => ({ uid, role: "mcp", via: "mcp", runId });
const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);

// ---------- token auth ----------

test("token auth: hashed lookup, lastUsedAt, revoked and no-AI-access are refused", async () => {
  const { token, id } = await newKey();
  assert.notEqual(id, token);
  assert.match(id, /^[0-9a-f]{64}$/);
  const doc = (await db.get("mcpTokens", id))!;
  assert.equal(JSON.stringify(doc).includes(token), false, "the raw token is never stored");

  const who = await authenticateToken(token);
  assert.equal(who.uid, adminUid);
  assert.ok((await db.get("mcpTokens", id))!.lastUsedAt, "lastUsedAt set");

  await assert.rejects(authenticateToken("btk_nope"), (e: any) => e.status === 401);
  await assert.rejects(authenticateToken(undefined), (e: any) => e.status === 401);

  await db.update(importCtx(), "users", adminUid, { mcpAccess: false });
  await assert.rejects(authenticateToken(token), (e: any) => e.status === 403 && /AI access/.test(e.message));
  await db.update(importCtx(), "users", adminUid, { mcpAccess: true });
  await authenticateToken(token);

  await db.update(importCtx(), "mcpTokens", id, { revokedAt: new Date() });
  await assert.rejects(authenticateToken(token), (e: any) => e.status === 401 && /revoked/.test(e.message));
});

// ---------- tool list ----------

const EXPECTED = [
  // places and people (read + write, with dedupe)
  "venues.create", "venues.update", "venues.mergeInto", "promoters.create", "promoters.update", "festivals.create", "festivals.update", "editions.create", "editions.update",
  "contacts.create", "contacts.update", "contacts.attach", "contacts.detach",
  // pitches, comments, email templates, drafts
  "pitches.flag", "pitches.update", "pitches.move", "pitches.comment", "pitches.log", "emailTemplates.create", "emailTemplates.update", "pitches.draftEmail",
  // shows
  "shows.create", "shows.update", "shows.setStatus", "shows.cancel", "shows.drop", "shows.sync", "shows.setChecklists", "shows.checkItem", "shows.calendarPreview", "shows.calendar", "showDeals.update",
  "showDeals.setIncome", "shows.comment", "shows.editComment", "shows.removeComment",
  "shows.afterShow", "checklistTemplates.list", "checklistTemplates.create", "checklistTemplates.update", "checklistTemplates.reorder", "checklistTemplates.remove",
  // availability: ask and read, not mark
  "availability.ask", "availability.remind", "availability.close", "availability.reopen",
  // fans: admins' list and Bandzoogle; counts for everyone
  "fans.add", "fans.update", "fans.remove", "fans.list", "fans.counts", "fans.near", "fans.newSince", "fans.forBandzoogle", "fans.markSynced",
  // songs, setlists, rehearsals, files
  "drive.search", "drive.fix", "files.attach", "files.update", "files.remove", "files.check", "files.shareWithBand", "files.copyToBand",
  "songs.create", "songs.update", "setlistTemplates.create", "setlistTemplates.update", "setlists.printLink", "setlists.setItems", "setlists.seed",
  "rehearsals.create", "rehearsals.update",
  "rehearsals.setLocation", "rehearsals.importSetlist", "rehearsals.calendarPreview", "rehearsals.calendar",
  // stage plots
  "stagePlots.create", "stagePlots.copy", "stagePlots.rename", "stagePlots.setInputCount", "stagePlots.setMixCount", "stagePlots.updateInputs", "stagePlots.reorderInputs",
  "stagePlots.move", "stagePlots.addItems", "stagePlots.removeItems", "stagePlots.setMonitors", "stagePlots.setStage", "stagePlots.setBringNeed", "shows.setStagePlot",
  "stagePlots.list", "stagePlots.get", "stagePlots.staleShows", "stagePlots.shareLink", "stagePlots.shareOff", "stagePlots.engineerLink",
  // money, stats
  "expenses.setPaidBack", "expenses.payPerson", "expenses.estimateGas", "stats.pull", "stats.importCsv", "stats.current",
  // geo (address typeahead, read-only)
  "geo.autocomplete",
  // read tools and undo
  "search", "records.get", "records.list", "shows.list", "pitches.needingFollowUp", "songs.missingFiles", "availability.check", "bandsintown.reconcile", "stats.movement",
  "history.undoRun", "history.myRuns",
].sort();

test("the tool list is exactly the registry commands allowed for MCP (the access table's MCP column)", () => {
  const tools = toolList();
  assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED);
  for (const t of tools) {
    assert.ok(registry[t.name].roles.includes("mcp"));
    assert.ok(t.description.length > 10, `${t.name} has a description`);
    assert.equal(t.inputSchema.type, "object");
  }
  const names = new Set(tools.map((t) => t.name));
  for (const banned of ["users.add", "users.update", "users.remove", "musicians.create", "musicians.update", "musicians.remove", "artists.update",
    "pitches.sendEmail", "pitches.checkReplies", "availability.mark", "availability.answer", "expenses.add", "venues.remove"]) {
    assert.equal(names.has(banned), false, `${banned} must not be an MCP tool`);
  }
  // JSON schema comes from the Zod input
  const vc = tools.find((t) => t.name === "venues.create")!.inputSchema as any;
  assert.deepEqual(vc.required.sort(), ["address", "name", "region", "type"].sort());
  assert.deepEqual(vc.properties.region.enum.slice(0, 2), ["boulder", "denver"]);
  assert.equal(vc.additionalProperties, false);
});

// ---------- structured errors ----------

test("validation errors come back as structured tool errors listing the Zod issues", async () => {
  const r = await callTool("venues.create", { name: "", type: "spaceship", address: { city: "Denver" }, bogus: 1 }, async () => mcpCtx());
  assert.equal(r.isError, true);
  const e = parse(r).error;
  assert.equal(e.code, "invalid_input");
  const paths = e.issues.map((i: any) => i.path);
  assert.ok(paths.includes("name") && paths.includes("type") && paths.includes("address.state") && paths.includes("region"), paths.join(","));
  assert.ok(e.issues.every((i: any) => typeof i.message === "string" && i.code));
  // nothing was written
  assert.equal((await db.list("venues")).length, 0);
  // unknown and app-only tools look the same: not a tool
  for (const n of ["pitches.sendEmail", "users.add", "nope"]) {
    const x = await callTool(n, {}, async () => mcpCtx());
    assert.equal(x.isError, true);
    assert.equal(parse(x).error.code, "unknown_tool");
  }
});

test("a good call returns the result and the session runId; dedupe merges instead of duplicating", async () => {
  const ctx = mcpCtx();
  const call = (n: string, a: unknown) => callTool(n, a, async () => ctx);
  const a = parse(await call("venues.create", venue("The Walnut Room")));
  assert.equal(a.runId, ctx.runId);
  const b = parse(await call("venues.create", venue("The  Walnut Room", "Denver", { capacity: 400 })));
  assert.equal(b.result.merged, true);
  assert.equal(b.result.id, a.result.id);
  const h = await db.listGroup("history", (q) => q.where("runId", "==", ctx.runId));
  assert.deepEqual(h.map((x) => x.op).sort(), ["create", "merge"]);
  assert.ok(h.every((x) => x.actor.via === "mcp" && x.actor.uid === adminUid));
});

// ---------- drafts, never sends ----------

test("MCP can draft an email but never send one", async () => {
  const { id: venueId } = await db.create(admin, "venues", venue("Cervantes"));
  const artist = await db.create(admin, "artists", { name: "Ingrid Avison Band", configurations: [] }).catch(() => null);
  void artist;
  const p = await db.create(admin, "pitches", { target: { kind: "venue", id: venueId, name: "Cervantes" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
  const gmail = gmailClient();
  const before = (await gmail.listMessages()).length;

  const ok = parse(await callTool("pitches.draftEmail", { id: p.id, to: ["booker@example.com"], subject: "Hello", body: "We would love to play." }, async () => mcpCtx()));
  assert.equal(ok.result.sent, false);
  const drafts = await gmail.listDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].subject, "Hello");
  assert.equal((await gmail.listMessages()).length, before, "nothing was sent");
  const acts = await db.list(`pitches/${p.id}/activity`);
  assert.ok(acts.some((a) => a.type === "note" && /drafted \(not sent\)/.test(a.text)));
  assert.ok(!acts.some((a) => a.type === "emailSent"));

  const unfilled = await callTool("pitches.draftEmail", { id: p.id, to: ["b@example.com"], subject: "Hi {{contact.firstName}}", body: "x" }, async () => mcpCtx());
  assert.equal(parse(unfilled).error.code, "unfilled_fields");

  const send = await callTool("pitches.sendEmail", { id: p.id, to: ["booker@example.com"], subject: "Hello", body: "Hi" }, async () => mcpCtx());
  assert.equal(parse(send).error.code, "unknown_tool");
  assert.deepEqual(registry["pitches.sendEmail"].roles, ["admin"]);
  assert.equal((await gmail.listMessages()).length, before);
});

test("asking who is free through MCP drafts the emails instead of sending them", async () => {
  const m = await db.create(admin, "musicians", { name: "David", instruments: [], active: true, email: "david@example.com" });
  const r = parse(await callTool("availability.ask", { date: "2027-03-05", musicianIds: [m.id] }, async () => mcpCtx()));
  assert.deepEqual(r.result.drafted, ["David"]);
  assert.deepEqual(r.result.emailed, []);
  const gmail = gmailClient();
  assert.equal((await gmail.listDrafts()).length, 1);
  assert.equal((await gmail.listMessages()).filter((x) => x.direction === "sent").length, 0);
});

// ---------- over HTTP (the Next route handler, called in-process) ----------

const URL_ = "http://app.test/mcp";
/** What `fetch` does for the SDK client: hand the request to the route handler, no socket. */
const viaHandler: typeof fetch = (input, init) => handleMcpRequest(new Request(input, init));
const connect = async (token: string) => {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { fetch: viaHandler, requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
};
const post = (headers: Record<string, string>, body: unknown) =>
  handleMcpRequest(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(body) }));
const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

test("HTTP: bearer auth, one runId per session, revoking a key stops a live session", async () => {
  const { token, id } = await newKey();
  const bad = await post({}, {});
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("www-authenticate"), "Bearer");

  const client = await connect(token);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), EXPECTED);

  const text = (r: any) => JSON.parse(r.content[0].text);
  const a = text(await client.callTool({ name: "venues.create", arguments: venue("Hi-Dive") }));
  const b = text(await client.callTool({ name: "contacts.create", arguments: { name: "Pat Booker", emails: ["pat@example.com"] } }));
  assert.equal(a.runId, b.runId);
  const hist = await db.listGroup("history", (q) => q.where("runId", "==", a.runId));
  assert.equal(hist.length, 2);

  const bad2 = await client.callTool({ name: "venues.create", arguments: { name: "x" } });
  assert.equal(bad2.isError, true);
  assert.equal(text(bad2).error.code, "invalid_input");

  // undo through MCP: own run only
  const mine = text(await client.callTool({ name: "history.myRuns", arguments: {} }));
  assert.equal(mine.result.runs[0].runId, a.runId);
  const other = await db.create(importCtx("someone-else", "other-run"), "venues", venue("Not Mine"));
  const refused = await client.callTool({ name: "history.undoRun", arguments: { runId: "other-run" } });
  assert.equal(refused.isError, true);
  assert.equal(text(refused).error.code, "forbidden");
  assert.equal((await db.get("venues", other.id))!.deletedAt, null);
  const undone = text(await client.callTool({ name: "history.undoRun", arguments: { runId: a.runId } }));
  assert.equal(undone.result.reverted.length, 2);
  assert.notEqual(undone.result.undoRunId, a.runId);

  await db.update(importCtx(), "mcpTokens", id, { revokedAt: new Date() });
  await assert.rejects(client.callTool({ name: "stats.current", arguments: {} }), /revoked/);
  // and at the tool layer a failed re-check is a structured error too
  const viaTool = await callTool("stats.current", {}, () => authenticateToken(token).then(() => mcpCtx()));
  assert.equal(viaTool.isError, true);
  assert.equal(text(viaTool).error.code, "unauthenticated");
  await client.close().catch(() => {});
});

test("HTTP sessions are signed: the id carries the runId, is bound to the key, and can't be forged", async () => {
  const { token } = await newKey();
  const auth = { Authorization: `Bearer ${token}` };
  // No session and not an initialize: refused.
  assert.equal((await post(auth, toolsList)).status, 400);
  // Initialize issues a session id whose first part is the runId used from then on.
  const init = await post(auth, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.equal(init.status, 200);
  const sid = init.headers.get(SESSION_HEADER)!;
  const runId = sid.slice(0, sid.lastIndexOf("."));
  assert.equal(sid, sessionIdFor(runId, hashToken(token)));
  const ok = await post({ ...auth, [SESSION_HEADER]: sid }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "stats.current", arguments: {} } });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse((await ok.json()).result.content[0].text).runId, runId);
  // A made-up id, a tampered signature, and another key's id all get 404 (the client then initializes again).
  for (const forged of [`${runId}.nope`, `other-run.${sid.slice(sid.lastIndexOf(".") + 1)}`, "x"]) {
    assert.equal((await post({ ...auth, [SESSION_HEADER]: forged }, toolsList)).status, 404, forged);
  }
  const theirs = await newKey("Someone else");
  assert.equal((await post({ Authorization: `Bearer ${theirs.token}`, [SESSION_HEADER]: sid }, toolsList)).status, 404);
  // No push stream: GET is 405 even with a valid session, so nothing is held open.
  const get = await handleMcpRequest(new Request(URL_, { headers: { ...auth, accept: "text/event-stream", [SESSION_HEADER]: sid } }));
  assert.equal(get.status, 405);
  // Unknown or missing key: 401.
  assert.equal((await post({ Authorization: "Bearer btk_wrong", [SESSION_HEADER]: sid }, toolsList)).status, 401);
});

test("stdio entry: MCP_TOKEN authenticates, tools list, a bad token fails fast", async () => {
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { token } = await newKey();
  const env = { ...process.env, MCP_TOKEN: token } as Record<string, string>;
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/server.ts", "--stdio"], env, stderr: "ignore" }));
  try {
    assert.equal((await client.listTools()).tools.length, EXPECTED.length);
    const r = (await client.callTool({ name: "stats.current", arguments: {} })) as any;
    assert.ok(JSON.parse(r.content[0].text).runId);
  } finally { await client.close(); }

  const bad = new Client({ name: "test", version: "1" });
  await assert.rejects(bad.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/server.ts", "--stdio"], env: { ...env, MCP_TOKEN: "btk_wrong" }, stderr: "ignore" })));
});

test("read tools: search, follow-ups, availability, missing files, Bandsintown reconcile, stats movement", async () => {
  const ctx = { ...mcpCtx(), artistId: "a" };
  const call = async (n: string, a: unknown) => parse(await callTool(n, a, async () => ctx)).result;
  const contact = await db.create(admin, "contacts", { name: "Dana Booker", emails: ["dana@example.com"], phones: [] });
  const v = await call("venues.create", venue("Fox Theatre", "Boulder", { contactIds: [contact.id] })); // the contact link is this band's private note
  const p = await db.create(admin, "pitches", {
    target: { kind: "venue", id: v.id, name: "Fox Theatre" }, status: "pitched", artistId: "a", personnel: [], showIds: [],
    lastContactAt: new Date(Date.now() - 21 * 86_400_000), // clear of the 20-day threshold: exactly 20 floors to 19 once a few ms have passed
  });
  await db.create(admin, "pitches", { target: { kind: "venue", id: v.id, name: "Other" }, status: "pitched", artistId: "a", personnel: [], showIds: [], lastContactAt: new Date() });

  const s = await call("search", { q: "dana" });
  assert.deepEqual(s.results.map((r: any) => r.kind).sort(), ["contact", "venue"], "a venue is found through its people");
  assert.equal((await call("search", { q: "fox boulder", kinds: ["venue"] })).count, 1);

  const f = await call("pitches.needingFollowUp", {});
  assert.equal(f.count, 1);
  assert.equal(f.pitches[0].id, p.id);
  assert.match(f.pitches[0].reasons[0], /No contact for 2\d days/);
  assert.equal(f.pitches[0].people[0].emails[0], "dana@example.com");

  const mk = (date: string, status: string, pub = false) => ({
    date, status, venue: { id: v.id, name: "Fox Theatre", city: "Boulder" }, times: { set: "20:00" }, artistId: "a", personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, checklist: [], gear: [], docs: [], public: pub, listings: {},
  });
  await db.create(admin, "shows", mk("2027-05-01", "confirmed", true));
  await db.create(admin, "shows", mk("2027-05-02", "hold"));
  const av = await call("availability.check", { dates: ["2027-05-01", "2027-05-02", "2027-05-03"] });
  assert.deepEqual(av.dates.map((d: any) => d.verdict), ["conflict", "conflict", "free"]);

  // Bandsintown: the public confirmed show is not listed yet, then it is, then a changed time is a mismatch
  let r = await call("bandsintown.reconcile", { today: "2027-01-01" });
  assert.equal(r.missingOnBandsintown.length, 1);
  const sh = (await db.list("shows")).find((x) => x.date === "2027-05-01")!;
  const ev = await (await import("@/server/integrations")).bandsintownClient().create({ datetime: "2027-05-01T21:00:00", venueName: "Fox Theatre", city: "Boulder" });
  await (await import("@/server/integrations")).bandsintownClient().create({ datetime: "2027-06-01T21:00:00", venueName: "Ghost Hall", city: "Denver" });
  r = await call("bandsintown.reconcile", { today: "2027-01-01" });
  assert.equal(r.missingOnBandsintown.length, 0);
  assert.equal(r.mismatches[0].showId, sh.id);
  assert.ok(r.mismatches[0].diffs.datetime);
  assert.equal(r.notExpected[0].venue, "Ghost Hall");
  await (await import("@/server/integrations")).bandsintownClient().delete(ev.id);

  // songs
  const withFile = await db.create(admin, "songs", { title: "Has File", status: "active" });
  await db.create(admin, "songs", { title: "No File", status: "active" });
  await db.create(admin, "files", {
    kind: "chart", title: "chart", songId: withFile.id, driveFileId: "d1", url: "https://x.example", ownerEmail: "a@example.com",
    inBandFolder: false, sharing: { missing: ["m1"] }, checkedAt: new Date(),
  });
  let mf = await call("songs.missingFiles", {});
  assert.deepEqual(mf.songsWithoutFiles.map((x: any) => x.title), ["No File"]);
  // No band folder chosen yet: being outside it isn't reported (the sharing gap still is).
  assert.deepEqual([mf.bandFolderChosen, mf.sharingProblems[0].outsideBandFolder], [false, false]);
  assert.equal(mf.sharingProblems[0].song, "Has File");
  await db.create(admin, "artists", { name: "Band A", slug: "band-a", configurations: [], links: {}, driveFolderId: "band-folder" }, { id: "a" });
  mf = await call("songs.missingFiles", {});
  assert.deepEqual([mf.bandFolderChosen, mf.sharingProblems[0].outsideBandFolder], [true, true]);

  // stats movement around a release and a played show
  const snap = (date: string, followers: number, monthlyListeners: number) =>
    db.create(admin, "statSnapshots", { source: "spotifyForArtists", date, followers, monthlyListeners }, { id: `spotifyForArtists_${date}` });
  await snap("2026-09-01", 100, 1000); await snap("2026-09-10", 110, 1500); await snap("2026-09-20", 130, 1800);
  await db.create(admin, "shows", mk("2026-09-05", "played"));
  const m = await call("stats.movement", { releases: [{ name: "Single", date: "2026-09-01" }], windowDays: 14, today: "2027-01-01" });
  const rel = m.events.find((e: any) => e.type === "release");
  const fol = rel.movement.find((x: any) => x.metric === "followers");
  assert.equal(fol.delta, 10);
  assert.equal(fol.pct, 10);
  assert.equal(m.events.find((e: any) => e.type === "show").movement.find((x: any) => x.metric === "followers").after.value, 110);
  assert.equal(rel.movement.find((x: any) => x.metric === "streams").delta, undefined);

  // records
  const rec = await call("records.get", { kind: "pitches", id: p.id });
  assert.equal(rec.target.name, "Fox Theatre");
  assert.equal(typeof rec.createdAt, "string", "timestamps are ISO strings");
  const notReadable = await callTool("records.list", { kind: "users" }, async () => ctx);
  assert.equal(parse(notReadable).error.code, "invalid_input");
});
