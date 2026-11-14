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
import { approve, authorizationServerMetadata, authorize, login, protectedResourceMetadata, register, resourceMetadataUrl, seal, token as tokenEndpoint } from "../../mcp/oauth";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { resetEmulators, makeUser, makeArtist, idToken, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let admin: Ctx;
let adminUid: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

beforeEach(async () => {
  await resetEmulators();
  await fetch(process.env.GMAIL_BASE_URL + "/__reset", { method: "POST" });
  const u = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  adminUid = u.uid;
  await db.update(importCtx(), "users", u.uid, { artists: [{ artistId: TEST_ARTIST, role: "admin", mcpAccess: true }] });
  admin = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
});

const run = async (name: string, input: unknown, c: Ctx = admin) => (await registry[name].run(c, registry[name].input.parse(input))) as Record<string, any>;
/** Keys are minted outside the app now (no command), so tests write the hashed doc directly. */
const newKey = async (label = "Rudy · Claude") => {
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

  await db.update(importCtx(), "users", adminUid, { artists: [{ artistId: TEST_ARTIST, role: "admin", mcpAccess: false }] });
  await assert.rejects(authenticateToken(token), (e: any) => e.status === 403 && /AI access/.test(e.message));
  await db.update(importCtx(), "users", adminUid, { artists: [{ artistId: TEST_ARTIST, role: "admin", mcpAccess: true }] });
  await authenticateToken(token);

  await db.update(importCtx(), "mcpTokens", id, { revokedAt: new Date() });
  await assert.rejects(authenticateToken(token), (e: any) => e.status === 401 && /revoked/.test(e.message));
});

// ---------- tool list ----------

const EXPECTED = [
  // places and people (read + write, with dedupe)
  "venues.create", "venues.update", "venues.mergeInto", "promoters.create", "promoters.update", "festivals.create", "festivals.update", "festivals.page", "venueTypes.add", "editions.create", "editions.update",
  "contacts.create", "contacts.update", "contacts.attach", "contacts.detach", "contacts.setRoles",
  // pitches, comments, email templates, drafts
  "pitches.flag", "pitches.update", "pitches.move", "pitches.comment", "pitches.log", "emailTemplates.create", "emailTemplates.update", "pitches.draftEmail",
  // shows
  "shows.create", "shows.update", "shows.setStatus", "shows.cancel", "shows.drop", "shows.setChecklists", "shows.checkItem", "shows.calendarPreview", "shows.calendar", "shows.calendarLink", "showDeals.update",
  "shows.comment", "shows.editComment", "shows.removeComment", "shows.folder", "shows.posters.attach", "shows.posters.remove",
  "shows.afterShow", "checklistTemplates.list", "checklistTemplates.create", "checklistTemplates.update", "checklistTemplates.reorder", "checklistTemplates.remove",
  // availability: ask and read, not mark
  "availability.ask", "availability.remind", "availability.close", "availability.reopen",
  // fans: admins' list and Bandzoogle; counts for everyone
  "fans.add", "fans.update", "fans.remove", "fans.list", "fans.counts", "fans.near", "fans.newSince", "fans.forBandzoogle", "fans.markSynced",
  // songs, setlists, rehearsals, files
  "drive.search", "drive.fix", "files.attach", "files.update", "files.remove", "files.check", "files.shareWithBand", "files.copyToBand",
  "songs.create", "songs.merge", "songs.update", "setlistTemplates.create", "setlistTemplates.update", "setlists.printLink", "setlists.setItems", "setlists.seed",
  "rehearsals.create", "rehearsals.update",
  "rehearsals.setLocation", "rehearsals.importSetlist", "rehearsals.folder", "rehearsals.newRecordings", "rehearsals.adoptRecording", "rehearsals.calendarPreview", "rehearsals.calendar", "rehearsals.calendarLink",
  // stage plots
  "stagePlots.create", "stagePlots.copy", "stagePlots.rename", "stagePlots.setInputCount", "stagePlots.setMixCount", "stagePlots.updateInputs", "stagePlots.reorderInputs",
  "stagePlots.move", "stagePlots.addItems", "stagePlots.removeItems", "stagePlots.setMonitors", "stagePlots.setStage", "stagePlots.setBringNeed", "shows.setStagePlot",
  "stagePlots.list", "stagePlots.get", "stagePlots.staleShows", "stagePlots.shareLink", "stagePlots.shareOff", "stagePlots.engineerLink",
  // releases: the record, its tracks and its files
  "releases.create", "releases.update", "releases.folder", "releases.connectFolder", "releases.tracks.add", "releases.tracks.update", "releases.tracks.remove", "releases.tracks.reorder", "releases.tracks.sideBreak",
  "releases.files.attach", "releases.files.approve", "releases.files.note", "releases.files.copyToFolder",
  // tours: the tour, putting shows and pitches on it, its entries, booking an option
  "tours.list", "tours.get", "tours.summary", "tours.create", "tours.update", "tours.remove", "tours.addShow", "tours.addPitch", "tours.removeItem",
  "tours.entries.add", "tours.entries.update", "tours.entries.move", "tours.entries.remove", "tours.book",
  // money, stats
  "income.add", "income.update", "income.remove", "income.setReceived", "payouts.add", "payouts.update", "payouts.remove", "payouts.markPaid",
  "expenses.add", "expenses.update", "expenses.remove", "expenses.setPaidBack", "expenses.payPerson", "expenses.markPaid", "expenses.estimateGas", "stats.pull", "stats.importCsv", "stats.current",
  // acts (#77): finding acts, the shortlist, our take
  "acts.find", "acts.create", "acts.update", "acts.shortlist", "acts.note",
  // geo (address typeahead, read-only)
  "geo.autocomplete", "people.updateDriving",
  // posts (#75): the Socials folder; the rest of Posts joins as its phases land
  "posts.setup", "posts.photos", "posts.list", "posts.get", "posts.createDraft", "posts.addToDraft", "posts.updateDraft", "posts.rename", "posts.removeFromDraft", "posts.deleteDraft", "posts.publish", "posts.tidy",
  // read tools and undo
  "search", "records.get", "records.list", "shows.list", "pitches.needingFollowUp", "songs.missingFiles", "availability.check", "stats.movement",
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
    "pitches.sendEmail", "pitches.checkReplies", "availability.mark", "availability.answer", "venues.remove"]) {
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
  assert.ok(paths.includes("name") && paths.includes("address.state") && paths.includes("region"), paths.join(","));
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
  const { id: venueId } = await db.create(admin, "venues", venue("Marisol"));
  const artist = await db.create(admin, "artists", { name: "Nora Quill Band", configurations: [] }).catch(() => null);
  void artist;
  const p = await db.create(admin, "pitches", { target: { kind: "venue", id: venueId, name: "Marisol" }, status: "toPitch", artistId: "a", personnel: [], showIds: [] });
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
  const m = await db.create(admin, "musicians", { name: "Hugo", instruments: [], active: true, email: "hugo@example.com" });
  const r = parse(await callTool("availability.ask", { date: "2027-03-05", musicianIds: [m.id] }, async () => mcpCtx()));
  assert.deepEqual(r.result.drafted, ["Hugo"]);
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
  assert.equal(bad.headers.get("www-authenticate"), `Bearer resource_metadata="${resourceMetadataUrl()}"`, "401s point at the OAuth metadata");

  const client = await connect(token);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), EXPECTED);

  const text = (r: any) => JSON.parse(r.content[0].text);
  const a = text(await client.callTool({ name: "venues.create", arguments: venue("Deep End") }));
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

test("read tools: search, follow-ups, availability, missing files, stats movement", async () => {
  const ctx = { ...mcpCtx(), artistId: "a" };
  const call = async (n: string, a: unknown) => parse(await callTool(n, a, async () => ctx)).result;
  const contact = await db.create(admin, "contacts", { artistId: "a", name: "Wren Booker", emails: ["wren@example.com"], phones: [] });
  const v = await call("venues.create", venue("Heron Theatre", "Boulder", { contactIds: [contact.id] })); // the contact link is this band's private note
  const p = await db.create(admin, "pitches", {
    target: { kind: "venue", id: v.id, name: "Heron Theatre" }, status: "pitched", artistId: "a", personnel: [], showIds: [],
    lastContactAt: new Date(Date.now() - 21 * 86_400_000), // clear of the 20-day threshold: exactly 20 floors to 19 once a few ms have passed
  });
  await db.create(admin, "pitches", { target: { kind: "venue", id: v.id, name: "Other" }, status: "pitched", artistId: "a", personnel: [], showIds: [], lastContactAt: new Date() });

  const s = await call("search", { q: "wren" });
  assert.deepEqual(s.results.map((r: any) => r.kind).sort(), ["contact", "venue"], "a venue is found through its people");
  assert.equal((await call("search", { q: "heron boulder", kinds: ["venue"] })).count, 1);

  const f = await call("pitches.needingFollowUp", {});
  assert.equal(f.count, 1);
  assert.equal(f.pitches[0].id, p.id);
  assert.match(f.pitches[0].reasons[0], /No contact for 2\d days/);
  assert.equal(f.pitches[0].people[0].emails[0], "wren@example.com");

  const mk = (date: string, status: string) => ({
    date, status, venue: { id: v.id, name: "Heron Theatre", city: "Boulder" }, times: { set: "20:00" }, artistId: "a", personnel: [],
    sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, docs: [],
  });
  await db.create(admin, "shows", mk("2027-05-01", "confirmed"));
  await db.create(admin, "shows", mk("2027-05-02", "hold"));
  const av = await call("availability.check", { dates: ["2027-05-01", "2027-05-02", "2027-05-03"] });
  assert.deepEqual(av.dates.map((d: any) => d.verdict), ["conflict", "conflict", "free"]);

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
  assert.equal(rec.target.name, "Heron Theatre");
  assert.equal(typeof rec.createdAt, "string", "timestamps are ISO strings");
  const notReadable = await callTool("records.list", { kind: "users" }, async () => ctx);
  assert.equal(parse(notReadable).error.code, "invalid_input");
});

// ---------- OAuth (Claude's "Add custom connector") ----------

/** The app's routes for the OAuth flow, served in-process like /mcp above. APP_URL is http://app.test for these tests. */
const routes: Record<string, (req: Request) => Response | Promise<Response>> = {
  "/mcp": handleMcpRequest,
  "/.well-known/oauth-protected-resource": protectedResourceMetadata,
  "/.well-known/oauth-protected-resource/mcp": protectedResourceMetadata,
  "/.well-known/oauth-authorization-server": authorizationServerMetadata,
  "/oauth/register": register,
  "/oauth/authorize": authorize,
  "/oauth/approve": approve,
  "/oauth/token": tokenEndpoint,
  "/oauth/login": login,
};
const app: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const h = routes[new URL(req.url).pathname];
  return h ? h(req) : new Response("not found", { status: 404 });
};
const REDIRECT = "https://claude.example/api/mcp/auth_callback";

/** What Claude keeps between steps: registration, PKCE verifier, tokens; and where it sent the browser. */
function claudeLike() {
  const store: { client?: any; verifier?: string; tokens?: any; authUrl?: URL } = {};
  const provider: OAuthClientProvider = {
    get redirectUrl() { return REDIRECT; },
    get clientMetadata() { return { client_name: "Claude", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
    state: () => "st4te",
    clientInformation: () => store.client,
    saveClientInformation: (c) => { store.client = c; },
    tokens: () => store.tokens,
    saveTokens: (t) => { store.tokens = t; },
    redirectToAuthorization: (u) => { store.authUrl = u; },
    saveCodeVerifier: (v) => { store.verifier = v; },
    codeVerifier: () => store.verifier!,
  };
  return { store, provider };
}
/** The browser: /oauth/authorize sends it to /connect; that page calls /oauth/approve with the person's ID token. */
async function toConnect(authUrl: URL) {
  const r = await app(authUrl, { redirect: "manual" });
  assert.equal(r.status, 302);
  const to = new URL(r.headers.get("location")!);
  assert.equal(to.origin + to.pathname, "http://app.test/connect");
  return to.searchParams.get("req")!;
}
const approveAs = async (req: string, token: string | null, body: Record<string, unknown> = {}) => {
  const res = await app("http://app.test/oauth/approve", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ req, ...body }) });
  return { status: res.status, body: (await res.json()) as any };
};
const useAppUrl = (t: { after: (fn: () => void) => void }) => {
  const prev = process.env.APP_URL;
  process.env.APP_URL = "http://app.test";
  t.after(() => { if (prev === undefined) delete process.env.APP_URL; else process.env.APP_URL = prev; });
};

test("OAuth: Claude's connector discovers sign-in, the person signs in to Roadie and picks the artist, and /mcp works", async (t) => {
  useAppUrl(t);
  await makeArtist("The Test Band", "test-band");
  await makeArtist("Other Band", "other-band", "other-artist");
  await db.update(importCtx(), "users", adminUid, { artists: [{ artistId: TEST_ARTIST, role: "admin", mcpAccess: true }, { artistId: "other-artist", role: "member" }] });
  const { store, provider } = claudeLike();

  // First connect: 401 -> metadata -> registration -> sent to authorize -> our /connect page.
  const first = new StreamableHTTPClientTransport(new URL(URL_), { fetch: app, authProvider: provider });
  await assert.rejects(new Client({ name: "claude", version: "1" }).connect(first), UnauthorizedError);
  assert.ok(store.client?.client_id, "registered");
  assert.equal(store.authUrl!.searchParams.get("code_challenge_method"), "S256");
  const req = await toConnect(store.authUrl!);

  // Not signed in: refused. Signed in: your artists, and which have AI access.
  assert.equal((await approveAs(req, null)).status, 401);
  const token = await idToken(adminUid);
  const info = await approveAs(req, token);
  assert.equal(info.status, 200);
  assert.equal(info.body.client, "Claude");
  assert.equal(info.body.returnTo, "claude.example");
  assert.deepEqual(info.body.artists.map((a: any) => [a.name, a.ai]), [["Other Band", false], ["The Test Band", true]]);
  // An artist without AI access, or one you're not in, is refused.
  assert.equal((await approveAs(req, token, { artistId: "other-artist" })).status, 403);
  assert.equal((await approveAs(req, token, { artistId: "nope" })).status, 403);
  // Cancel goes back with access_denied.
  assert.equal(new URL((await approveAs(req, null, { cancel: true })).body.redirect).searchParams.get("error"), "access_denied");

  const ok = await approveAs(req, token, { artistId: TEST_ARTIST });
  const back = new URL(ok.body.redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get("state"), "st4te");
  await first.finishAuth(back.searchParams.get("code")!);
  assert.match(store.tokens.access_token, /^btk_/);
  assert.ok(store.tokens.refresh_token);

  // The key is a normal MCP key: stored hashed, for this person and artist, named after the client.
  const keys = await db.list("mcpTokens", (q) => q.where("userId", "==", adminUid));
  assert.equal(keys.length, 1);
  assert.equal(keys[0].id, hashToken(store.tokens.access_token));
  assert.equal(keys[0].artistId, TEST_ARTIST);
  assert.equal(keys[0].client, "Claude");

  const client = new Client({ name: "claude", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_), { fetch: app, authProvider: provider }));
  assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(), EXPECTED);
  await client.close().catch(() => {});

  // Refresh hands back the same key; the code can't be used with another verifier.
  const tokenReq = (body: Record<string, string>) => app("http://app.test/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const refreshed = await tokenReq({ grant_type: "refresh_token", refresh_token: store.tokens.refresh_token, client_id: store.client.client_id });
  assert.equal((await refreshed.json()).access_token, store.tokens.access_token);
  const stolen = await tokenReq({ grant_type: "authorization_code", code: back.searchParams.get("code")!, code_verifier: "not-the-verifier", redirect_uri: REDIRECT, client_id: store.client.client_id });
  assert.equal((await stolen.json()).error, "invalid_grant");

  // Connecting again replaces the key instead of adding one; the old one stops working.
  const oldKey = store.tokens.access_token;
  const again = await approveAs(req, token, { artistId: TEST_ARTIST });
  const verifier = store.verifier!;
  const second = await (await tokenReq({ grant_type: "authorization_code", code: new URL(again.body.redirect).searchParams.get("code")!, code_verifier: verifier, redirect_uri: REDIRECT, client_id: store.client.client_id })).json();
  assert.match(second.access_token, /^btk_/);
  assert.notEqual(second.access_token, oldKey);
  await assert.rejects(authenticateToken(oldKey), /revoked/);
  await authenticateToken(second.access_token);

  // Turning off AI access stops the key and refresh.
  await db.update(importCtx(), "users", adminUid, { artists: [{ artistId: TEST_ARTIST, role: "admin", mcpAccess: false }] });
  assert.equal((await (await tokenReq({ grant_type: "refresh_token", refresh_token: second.refresh_token })).json()).error, "invalid_grant");
});

test("OAuth: an AI-only login can connect; unknown clients and return addresses get a page; expired requests and codes are refused", async (t) => {
  useAppUrl(t);
  await makeArtist("The Test Band", "test-band");
  const bot = await makeUser("bot@example.com", "ai", { name: "Band Bot" });
  const reg = await (await app("http://app.test/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Claude" }) })).json();
  for (const redirect_uris of [["javascript:alert(1)"], ["http://evil.example/cb"], []]) {
    const r = await app("http://app.test/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris }) });
    assert.equal(r.status, 400, JSON.stringify(redirect_uris));
  }
  const q = (p: Record<string, string>) => `http://app.test/oauth/authorize?${new URLSearchParams({ response_type: "code", code_challenge: "x", code_challenge_method: "S256", ...p })}`;
  assert.equal((await app(q({ client_id: "made-up", redirect_uri: REDIRECT }), { redirect: "manual" })).status, 400);
  assert.equal((await app(q({ client_id: reg.client_id, redirect_uri: "https://evil.example/cb" }), { redirect: "manual" })).status, 400);
  const noPkce = await app(`http://app.test/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT })}`, { redirect: "manual" });
  assert.equal(new URL(noPkce.headers.get("location")!).searchParams.get("error"), "invalid_request");

  const verifier = "v".repeat(50);
  const challenge = (await import("node:crypto")).createHash("sha256").update(verifier).digest("base64url");
  const req = await toConnect(new URL(q({ client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, state: "s" })));
  const info = await approveAs(req, bot.token);
  assert.deepEqual(info.body.artists.map((a: any) => a.ai), [true], "the ai role always has AI access");
  const ok = await approveAs(req, bot.token, { artistId: TEST_ARTIST });
  const code = new URL(ok.body.redirect).searchParams.get("code")!;
  const tokenReq = (body: Record<string, string>) => app("http://app.test/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const got = await (await tokenReq({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT })).json();
  assert.equal((await authenticateToken(got.access_token)).uid, bot.uid);

  const expiredReq = seal({ t: "req", c: reg.client_id, r: REDIRECT, p: challenge, s: "", e: Date.now() - 1 });
  assert.equal((await approveAs(expiredReq, bot.token)).status, 400);
  const expiredCode = seal({ t: "code", u: bot.uid, a: TEST_ARTIST, c: reg.client_id, r: REDIRECT, p: challenge, e: Date.now() - 1 });
  assert.equal((await (await tokenReq({ grant_type: "authorization_code", code: expiredCode, code_verifier: verifier })).json()).error, "invalid_grant");
});

test("OAuth with Google configured: authorize goes to Google, the callback learns who, /connect needs no Firebase", async (t) => {
  useAppUrl(t);
  const env = { GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
  const realFetch = globalThis.fetch;
  let googleEmail = "rudy@example.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://oauth2.googleapis.com/token")) {
      const idt = `x.${Buffer.from(JSON.stringify({ email: googleEmail, email_verified: true })).toString("base64url")}.y`;
      return new Response(JSON.stringify({ access_token: "g", expires_in: 3600, scope: "openid email", id_token: idt }), { headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
  const { GET: googleCallbackRoute } = await import("@/app/api/google/callback/route");
  await makeArtist("The Test Band", "test-band");

  const reg = await (await app("http://app.test/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Claude" }) })).json();
  const verifier = "w".repeat(50);
  const challenge = (await import("node:crypto")).createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = `http://app.test/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "st" })}`;
  const toGoogle = async () => {
    const r = await app(authorizeUrl, { redirect: "manual" });
    const g = new URL(r.headers.get("location")!);
    assert.equal(g.origin, "https://accounts.google.com");
    assert.equal(g.searchParams.get("redirect_uri"), "http://app.test/api/google/callback");
    assert.equal(g.searchParams.get("scope"), "openid email");
    return g.searchParams.get("state")!;
  };
  const back = async (q: Record<string, string>) => {
    const r = await googleCallbackRoute(new Request(`http://app.test/api/google/callback?${new URLSearchParams(q)}`));
    return { status: r.status, to: r.headers.get("location") ? new URL(r.headers.get("location")!) : undefined };
  };

  // Signed in at Google: on to /connect with who; approve lists the artists without any Firebase token.
  const st = await toGoogle();
  const { to } = await back({ code: "g-code", state: st });
  assert.equal(to!.pathname, "/connect");
  const req = to!.searchParams.get("req")!, who = to!.searchParams.get("who")!;
  const info = await approveAs(req, null, { who });
  assert.equal(info.status, 200);
  assert.equal(info.body.email, "rudy@example.com");
  const ok = await approveAs(req, null, { who, artistId: TEST_ARTIST });
  const code = new URL(ok.body.redirect).searchParams.get("code")!;
  const tokenReq = (body: Record<string, string>) => app("http://app.test/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const tok = await (await tokenReq({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT })).json();
  assert.equal((await authenticateToken(tok.access_token)).uid, adminUid);

  // A who is only good for the request it came with.
  const other = (await back({ code: "g-code", state: await toGoogle() })).to!;
  assert.equal((await approveAs(other.searchParams.get("req")!, null, { who })).status, 401);
  // A Google account nobody invited: told so.
  googleEmail = "stranger@example.com";
  const stranger = (await back({ code: "g-code", state: await toGoogle() })).to!;
  const refused = await approveAs(stranger.searchParams.get("req")!, null, { who: stranger.searchParams.get("who")! });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /stranger@example.com isn't on any band/);
  // Cancelled at Google: back to Claude with access_denied.
  const cancelled = await back({ error: "access_denied", state: await toGoogle() });
  assert.equal(cancelled.to!.origin + cancelled.to!.pathname, REDIRECT);
  assert.equal(cancelled.to!.searchParams.get("error"), "access_denied");
  // "Use a different account" goes back to Google for the same request.
  const again = await app(`http://app.test/oauth/login?${new URLSearchParams({ req })}`, { redirect: "manual" });
  assert.equal(new URL(again.headers.get("location")!).origin, "https://accounts.google.com");
});
