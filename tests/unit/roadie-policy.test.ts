import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { sessionFor, type Who } from "@/server/assistant/confirm";
import { BAND_SETTINGS, isExcluded, needsConfirm, refusal, summarize } from "@/server/assistant/policy";
import { execTool, readback } from "@/server/assistant/tools";
import { contextNow, searchAll } from "@/server/assistant/context";
import { ensureThread, newThreadId } from "@/server/assistant/threads";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.CALENDAR_BASE_URL = s.running["fake-calendar"].url;
  process.env.BANDSINTOWN_BASE_URL = s.running["fake-bandsintown"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

let admin: { uid: string; token: string };
let who: Who;
let sys: Ctx;
let showId: string;
let venueId: string;
const noop = () => {};

beforeEach(async () => {
  await resetEmulators();
  admin = await makeUser("jeff@example.com", "admin", { name: "Jeff" });
  who = { uid: admin.uid, role: "admin", name: "Jeff" };
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId() };
  const mus = (await db.create(sys, "musicians", { name: "Ingrid", instruments: ["vocals"], active: true })).id;
  await db.create(sys, "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: { website: "https://a.example", spotify: "https://s.example" },
    configurations: [{ id: "trio", name: "Trio", billingName: "Trio", musicianIds: [mus] }],
  }, { id: TEST_ARTIST });
  const v = (await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("Hi-Dive", "Denver", { address: { street: "7 S Broadway", city: "Denver", state: "CO" } })))) as { id: string };
  venueId = v.id;
  const r = (await registry["shows.create"].run(sys, registry["shows.create"].input.parse({
    date: "2026-11-14", venueId, status: "hold", times: { loadIn: "19:00", set: "21:15" }, sound: { provider: "venueProvided", notes: "in-house engineer" }, addToCalendar: false,
  }))) as { id: string };
  showId = r.id;
});

async function sess() {
  const threadId = newThreadId();
  await ensureThread({ uid: admin.uid, threadId, pageContext: { route: "calendar" }, at: new Date() });
  return { ...sessionFor(who, threadId), artistId: TEST_ARTIST };
}
const show = async () => (await db.get("shows", showId))!;

test("confirm: status changes and Bandsintown listing on shows.update, invites on shows.create", () => {
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { status: "canceled" } }), true);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { publishToBandsintown: true } }), true);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { publishToBandsintown: false } }), true);
  assert.equal(needsConfirm("shows.update", { id: "x", patch: { times: { loadIn: "18:00" } } }), false);
  assert.equal(needsConfirm("shows.create", { date: "2026-11-14", venueId: "v" }), true);
  assert.equal(needsConfirm("shows.create", { date: "2026-11-14", venueId: "v", addToCalendar: true, sendInvites: true }), true);
  assert.equal(needsConfirm("shows.create", { date: "2026-11-14", venueId: "v", addToCalendar: false }), false);
  assert.equal(needsConfirm("shows.create", { date: "2026-11-14", venueId: "v", sendInvites: false }), false);
  assert.equal(needsConfirm("musicians.archive", { id: "m" }), true);
  assert.equal(needsConfirm("musicians.removeFromBand", { id: "m" }), true);
  assert.equal(needsConfirm("artists.removeSongField", { id: "a", fieldId: "f" }), true);
  assert.equal(needsConfirm("artists.removeShowField", { id: "a", fieldId: "f" }), true);
  assert.equal(needsConfirm("artists.addSongField", { id: "a", label: "Capo" }), false);
  assert.equal(needsConfirm("people.list", {}), false);
});

test("eligibility: band settings are open except creating a band; users.addToBand is the one users.* exception", () => {
  assert.equal(isExcluded("artists.create"), true);
  assert.equal(isExcluded("artists.update"), false);
  assert.equal(isExcluded("artists.addSongField"), false);
  assert.equal(isExcluded("users.addToBand"), false);
  assert.equal(isExcluded("users.add"), true);
  assert.equal(isExcluded("users.update"), true);
  assert.equal(isExcluded("shows.setChecklists"), true);
  assert.equal(isExcluded("google.disconnect"), true);
  assert.equal(isExcluded("google.connectUrl"), true);
});

test("refusal: artists.update never touches the name, URL or Drive folder, even mixed with links", async () => {
  assert.equal(refusal("artists.update", { id: "a", patch: { name: "X" } }), BAND_SETTINGS);
  assert.equal(refusal("artists.update", { id: "a", patch: { slug: "x" } }), BAND_SETTINGS);
  assert.equal(refusal("artists.update", { id: "a", patch: { slug: "x", links: { website: "https://x" } } }), BAND_SETTINGS);
  assert.match(refusal("artists.update", { id: "a", patch: { driveFolderId: "f" } }) ?? "", /Drive folder/);
  assert.equal(refusal("artists.update", { id: "a", patch: { links: { website: "https://x" } } }), undefined);
  assert.equal(refusal("shows.update", { id: "a", patch: { name: "x" } }), undefined);
  const s = await sess();
  const out = await execTool(s, "artists.update", { id: TEST_ARTIST, patch: { name: "New Name", links: { website: "https://new.example" } } }, noop);
  assert.equal((out.output as { error: { code: string } }).error.code, "not_allowed");
  const a = (await db.get("artists", TEST_ARTIST))!;
  assert.equal(a.name, "Ingrid Avison Band");
  assert.equal(a.links.website, "https://a.example"); // the whole call was refused
});

test("a partial links patch keeps the other links", async () => {
  const s = await sess();
  await execTool(s, "artists.update", { id: TEST_ARTIST, patch: { links: { website: "https://new.example" } } }, noop);
  const a = (await db.get("artists", TEST_ARTIST))!;
  assert.deepEqual(a.links, { website: "https://new.example", spotify: "https://s.example" });
});

test("a partial times patch keeps the other times, null clears one; a partial sound keeps its notes", async () => {
  const s = await sess();
  await execTool(s, "shows.update", { id: showId, patch: { times: { loadIn: "18:00" } } }, noop);
  assert.deepEqual((await show()).times, { loadIn: "18:00", set: "21:15" });
  await execTool(s, "shows.update", { id: showId, patch: { times: { set: null } } }, noop);
  assert.deepEqual((await show()).times, { loadIn: "18:00" });
  await execTool(s, "shows.update", { id: showId, patch: { sound: { provider: "bandProvided" } } }, noop);
  assert.deepEqual((await show()).sound, { provider: "bandProvided", notes: "in-house engineer" });
});

test("a partial venue address asks first and shows old -> new; nothing changes until yes", async () => {
  const s = await sess();
  const out = await execTool(s, "venues.update", { id: venueId, patch: { address: { street: "9 S Broadway" } } }, noop);
  assert.equal((out.output as { needsConfirmation?: boolean }).needsConfirmation, true);
  assert.match(out.action!.label, /address: 7 S Broadway, Denver, CO → 9 S Broadway, Denver, CO/);
  assert.equal(((await db.get("venues", venueId))!.address as { street: string }).street, "7 S Broadway");
});

test("summaries: cancel, Bandsintown, book and invite, archive, remove field", () => {
  assert.equal(summarize("shows.update", { id: "x", patch: { status: "canceled", reason: "rain" } }, "Hi-Dive · 2026-11-14"), "Change the show Hi-Dive · 2026-11-14 to canceled (rain)");
  assert.equal(summarize("shows.update", { id: "x", patch: { publishToBandsintown: true } }, "Hi-Dive"), "List Hi-Dive on Bandsintown");
  assert.equal(summarize("shows.update", { id: "x", patch: { publishToBandsintown: false } }, "Hi-Dive"), "Take Hi-Dive off Bandsintown");
  assert.equal(summarize("shows.create", { date: "2026-11-14", venueId: "v" }, "Hi-Dive"), "Book Hi-Dive on 2026-11-14: add it to Google Calendar and invite the band");
  assert.equal(summarize("musicians.archive", { id: "m" }, "Mae"), "Archive Mae: they leave the band and lose their sign-in for this band");
  assert.equal(summarize("musicians.removeFromBand", { id: "m" }, "Mae"), "Take Mae out of the band (they keep their sign-in)");
  assert.equal(summarize("artists.removeSongField", { id: "a", fieldId: "f" }), "Delete the song field: every song loses its value");
});

test("shows.create with invites asks, and names the venue on the card", async () => {
  const s = await sess();
  const out = await execTool(s, "shows.create", { date: "2026-12-01", venueId }, noop);
  assert.equal((out.output as { needsConfirmation?: boolean }).needsConfirmation, true);
  assert.equal(out.action?.label, "Book Hi-Dive on 2026-12-01: add it to Google Calendar and invite the band");
});

test("read-backs use names, not ids", async () => {
  const s = await sess();
  const mae = await makeUser("mae@example.com", "member", { name: "Mae" });
  await db.create(sys, "musicians", { name: "Mae", instruments: ["bass"], active: true, userId: mae.uid });
  assert.equal(await readback("expenses.add", { amount: 2000, what: "strings", category: "travel", userId: mae.uid }, {}, s), "Logged $20 strings, paid by Mae");
  assert.equal(await readback("expenses.add", { amount: 2000, what: "strings", category: "travel" }, {}, s), "Logged $20 strings, paid by Jeff");
  assert.equal(await readback("shows.setStatus", { id: showId, status: "confirmed" }, {}, s), "Set Hi-Dive · 2026-11-14 to confirmed");
  assert.equal(await readback("shows.create", { date: "2026-11-14", venueId, status: "confirmed" }, { id: showId }, s), "Booked Hi-Dive on 2026-11-14");
  assert.equal(await readback("shows.update", { id: showId, patch: { venueId, billedAs: "trio", times: { loadIn: "18:00" } } }, {}, s), "Updated Hi-Dive · 2026-11-14: venue Hi-Dive, billed as Trio, loadIn 18:00");
  assert.equal(await readback("venues.create", { name: "Hi-Dive" }, { id: venueId, merged: true }, s), "Hi-Dive was already in the directory: merged into the existing venue");
  assert.equal(await readback("setlists.setItems", { showId, items: [{ type: "song" }, { type: "break" }, { type: "song" }] }, {}, s), "Set the setlist for Hi-Dive · 2026-11-14: 2 songs");
  assert.match(await readback("artists.update", { id: TEST_ARTIST, patch: { links: { website: "x" } } }, {}, s), /^Updated the band: links \(website\)$/);
  assert.equal(await readback("something.else", {}, {}, s), "Ran something.else");
});

test("a checklist tick reads back the item and the show", async () => {
  const s = await sess();
  const listId = "list1", itemId = "item1";
  await db.update(sys, "shows", showId, { checklists: [{ id: listId, name: "Gear", templateId: null, items: [{ id: itemId, label: "merch table", done: false }] }] });
  assert.equal(await readback("shows.checkItem", { id: showId, listId, itemId, done: true }, {}, s), "Checked 'merch table' on Hi-Dive · 2026-11-14");
  assert.equal(await readback("shows.checkItem", { id: showId, listId, itemId, done: false }, {}, s), "Unchecked 'merch table' on Hi-Dive · 2026-11-14");
});

test("context.now names the artist and the band; search finds setlist templates and carries a musician's userId", async () => {
  const c = await contextNow({ ...sys, artistId: TEST_ARTIST }, { ...who });
  assert.equal(c.artist?.id, TEST_ARTIST);
  assert.equal(c.artist?.slug, "ingrid-avison-band");
  assert.deepEqual(c.artist?.configurations, [{ id: "trio", name: "Trio" }]);
  assert.ok(c.band.some((m) => m.name === "Ingrid" && m.userId === null && m.instruments.includes("vocals")));
  await db.create(sys, "setlistTemplates", { name: "Club 60", items: [] });
  const r = await searchAll({ ...sys, artistId: TEST_ARTIST }, { q: "club", kinds: ["setlistTemplate"] });
  assert.deepEqual(r.results.map((x) => [x.kind, x.name]), [["setlistTemplate", "Club 60"]]);
});

test("help.explain with no arguments explains the page the person is on, tab included", async () => {
  const s = { ...(await sess()), pageContext: { route: "shows", tab: "canceled" } };
  const out = await execTool(s, "help.explain", {}, noop);
  assert.equal((out.output as { untrustedContent: { topic: { id: string } } }).untrustedContent.topic.id, "canceledShows");
  const named = await execTool(s, "help.explain", { topic: "pitch" }, noop);
  assert.equal((named.output as { untrustedContent: { topic: { id: string } } }).untrustedContent.topic.id, "pitch");
});
