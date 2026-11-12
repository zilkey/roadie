import { test, before, after, beforeEach, afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { firestore } from "@/server/admin";
import { newRunId, type Ctx } from "@/server/ctx";
import { Net, setFetcher, type RawPage } from "@/server/events/fetch";
import { roomStats } from "@/lib/venueEvents";
import { refreshAll, refreshVenue, eventId } from "@/server/events/refresh";
import { venueEventNoteId } from "@/schema";
import { resetEmulators, makeUser, makeArtist, venue, TEST_ARTIST } from "./helpers";

let ctx: Ctx;
const NOW = new Date("2026-11-10T18:00:00Z"); // 2026-11-10 at the venue (Denver)
const URL0 = "https://venue.example.com/calendar/";

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

/** A calendar page: one <li> per event, each with its own link. */
type Row = { path: string; title: string; date: string };
let rows: Row[] = [];
let failWith: string | null = null;
const page = () => `<ul>${rows.map((r) => `<li class="ev"><a class="t" href="${r.path}"><span class="name">${r.title}</span></a><span class="when">${r.date}</span></li>`).join("")}</ul>`;
const CAL = { type: "selectors", url: URL0, item: "li.ev", fields: { title: ".name", date: ".when", url: "a.t" } };

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("rudy@example.com", "admin");
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId(), artistId: TEST_ARTIST };
  rows = []; failWith = null;
  setFetcher(async (url: string): Promise<RawPage> => {
    if (failWith) throw new Error(failWith);
    return { url, status: 200, type: "text/html", body: page() };
  });
});
afterEach(() => setFetcher(null));

const makeVenue = async (extra: Record<string, unknown> = {}) => (await db.create(ctx, "venues", venue("Pine Hollow Lounge", "Denver", extra))).id;
const refresh = (venueId: string, now = NOW) => refreshVenue(venueId, { net: new Net(), now });
const events = (venueId: string) => db.list("venueEvents", (q) => q.where("venueId", "==", venueId), { includeDeleted: true });
const byTitle = async (venueId: string, title: string) => (await events(venueId)).find((e) => e.title === title)!;

describe("venues.setCalendar", () => {
  test("writes the calendar and a history entry", async () => {
    const v = await makeVenue();
    await cmd("venues.setCalendar", { id: v, calendar: CAL });
    const got = await db.get("venues", v);
    assert.equal((got!.calendar as any).type, "selectors");
    assert.equal((got!.calendar as any).url, URL0);
    const hist = await db.history("venues", v);
    assert.ok(hist.length >= 2, "create plus the calendar change");
    assert.ok(hist.some((h) => JSON.stringify(h).includes("calendar")));
  });
  test("null clears it", async () => {
    const v = await makeVenue();
    await cmd("venues.setCalendar", { id: v, calendar: CAL });
    await cmd("venues.setCalendar", { id: v, calendar: null });
    assert.ok(!(await db.get("venues", v))!.calendar);
  });
  test("an invalid calendar is rejected and nothing changes", async () => {
    const v = await makeVenue();
    const x = registry["venues.setCalendar"];
    for (const bad of [{ type: "nonsense" }, { type: "ics" }, { type: "ics", url: "" }, { type: "manual" }, { type: "ics", url: "https://a.example/x.ics", extra: 1 }]) {
      assert.throws(() => x.input.parse({ id: v, calendar: bad }), Error, JSON.stringify(bad));
    }
    assert.ok(!(await db.get("venues", v))!.calendar);
  });
  test("an unknown venue is not found", async () => {
    await assert.rejects(cmd("venues.setCalendar", { id: "nope", calendar: CAL }), /not found/i);
  });
});

describe("refreshVenue", () => {
  test("upserts events and writes the source's health", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [
      { path: "/e/1", title: "The Pine Hollows w/ Marlow Creek", date: "Sat, Nov 14 8pm" },
      { path: "/e/2", title: "Tin Cup Jane", date: "Fri, Nov 20" },
    ];
    const r = await refresh(v);
    assert.equal(r.error, undefined);
    assert.deepEqual([r.count, r.added, r.gone, r.upcoming], [2, 2, 0, 2]);
    const evs = await events(v);
    assert.equal(evs.length, 2);
    const e = await byTitle(v, "The Pine Hollows w/ Marlow Creek");
    assert.equal(e.id, eventId(v, "https://venue.example.com/e/1|2026-11-14"));
    assert.equal(e.date, "2026-11-14");
    assert.equal(e.start, "20:00");
    assert.equal(e.status, "onsale");
    assert.equal(e.source, "selectors");
    assert.deepEqual((e.acts as any[]).map((a) => a.name), ["The Pine Hollows", "Marlow Creek"]);
    assert.equal(e.firstSeenAt, NOW.toISOString());
    const h = (await firestore().doc(`venueEventSources/${v}`).get()).data()!;
    assert.equal(h.lastCount, 2);
    assert.equal(h.lastSuccessAt, NOW.toISOString());
    assert.equal(h.lastRunAt, NOW.toISOString());
    assert.equal(h.lastError, undefined);
    // the room's record (#76), over the stored shows: both are under 2 weeks out, so settled; one has a support act
    assert.deepEqual([h.billsSeen, h.supportShare], [2, roomStats(evs as any, NOW.toISOString().slice(0, 10)).supportShare]);
  });
  test("a second refresh keeps firstSeenAt and moves lastSeenAt", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/1", title: "Tin Cup Jane", date: "Fri, Nov 20" }];
    await refresh(v);
    const later = new Date("2026-11-11T18:00:00Z");
    const r = await refresh(v, later);
    assert.equal(r.added, 0);
    const e = await byTitle(v, "Tin Cup Jane");
    assert.equal(e.firstSeenAt, NOW.toISOString());
    assert.equal(e.lastSeenAt, later.toISOString());
    assert.equal((await events(v)).length, 1);
  });
  test("an upcoming event that disappears is marked gone, not deleted; a past one is left alone", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [
      { path: "/e/past", title: "Old Band", date: "Sat, Nov 7" },
      { path: "/e/up", title: "Soon Band", date: "Sat, Nov 14" },
      { path: "/e/keep", title: "Staying Band", date: "Sat, Nov 21" },
    ];
    await refresh(v);
    // Ten days on, the page lists only one of them; Old Band was already past before that.
    rows = [{ path: "/e/keep", title: "Staying Band", date: "Sat, Nov 21" }];
    const r = await refresh(v, new Date("2026-11-12T18:00:00Z"));
    assert.equal(r.gone, 1);
    const evs = await events(v);
    assert.equal(evs.length, 3, "nothing deleted");
    assert.equal((await byTitle(v, "Soon Band")).status, "gone");
    assert.equal((await byTitle(v, "Old Band")).status, "onsale");
    assert.equal((await byTitle(v, "Staying Band")).status, "onsale");
    assert.ok(!(await byTitle(v, "Soon Band")).deletedAt);
    // Already gone: not counted again.
    assert.equal((await refresh(v, new Date("2026-11-13T18:00:00Z"))).gone, 0);
  });
  test("a gone event that comes back is on sale again", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/up", title: "Soon Band", date: "Sat, Nov 14" }];
    await refresh(v);
    rows = [{ path: "/e/other", title: "Other Band", date: "Sat, Nov 21" }];
    await refresh(v, new Date("2026-11-11T18:00:00Z"));
    assert.equal((await byTitle(v, "Soon Band")).status, "gone");
    rows = [{ path: "/e/up", title: "Soon Band", date: "Sat, Nov 14" }];
    await refresh(v, new Date("2026-11-12T18:00:00Z"));
    assert.equal((await byTitle(v, "Soon Band")).status, "onsale");
  });
  test("a source that suddenly lists nothing marks nothing gone (a bot wall or a redesign, not every show called off)", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/up", title: "Soon Band", date: "Sat, Nov 14" }];
    await refresh(v);
    rows = [];
    const r = await refresh(v, new Date("2026-11-11T18:00:00Z"));
    assert.deepEqual([r.count, r.gone], [0, 0]);
    assert.equal((await byTitle(v, "Soon Band")).status, "onsale");
  });
  test("a fetch error records lastError and keeps the previous lastSuccessAt and count", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/1", title: "Tin Cup Jane", date: "Fri, Nov 20" }];
    await refresh(v);
    failWith = "boom: the calendar is down";
    const later = new Date("2026-11-11T18:00:00Z");
    const r = await refresh(v, later);
    assert.match(r.error!, /boom/);
    const h = (await firestore().doc(`venueEventSources/${v}`).get()).data()!;
    assert.match(h.lastError, /boom/);
    assert.equal(h.lastSuccessAt, NOW.toISOString());
    assert.equal(h.lastCount, 1);
    assert.equal(h.lastRunAt, later.toISOString());
    // The events are untouched.
    assert.equal((await byTitle(v, "Tin Cup Jane")).status, "onsale");
    // A later success clears the error.
    failWith = null;
    await refresh(v, new Date("2026-11-12T18:00:00Z"));
    assert.equal((await firestore().doc(`venueEventSources/${v}`).get()).data()!.lastError, undefined);
  });
  test("a first-ever failure has no lastSuccessAt", async () => {
    const v = await makeVenue({ calendar: CAL });
    failWith = "down";
    await refresh(v);
    const h = (await firestore().doc(`venueEventSources/${v}`).get()).data()!;
    assert.equal(h.lastSuccessAt, undefined);
    assert.equal(h.lastError, "down");
  });
  test("unparsed dates are counted on the health", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/1", title: "Tin Cup Jane", date: "Fri, Nov 20" }, { path: "/e/2", title: "Mystery Band", date: "soon" }];
    const r = await refresh(v);
    assert.equal(r.unparsed, 1);
    assert.equal((await firestore().doc(`venueEventSources/${v}`).get()).data()!.lastUnparsed, 1);
  });
  test("manual and no calendar are skipped, nothing written", async () => {
    const none = await makeVenue();
    const manual = (await db.create(ctx, "venues", venue("Instagram Only Tavern", "Denver", { calendar: { type: "manual", note: "Instagram only" } }))).id;
    assert.equal((await refresh(none)).skipped, "no calendar");
    const m = await refresh(manual);
    assert.equal(m.type, "manual");
    assert.equal(m.skipped, "Instagram only");
    for (const id of [none, manual]) {
      assert.equal((await events(id)).length, 0);
      assert.equal((await firestore().doc(`venueEventSources/${id}`).get()).exists, false);
    }
  });
  test("an unknown venue is not found", async () => {
    await assert.rejects(refresh("nope"), /not found/i);
  });
  test("the refresh command runs the same refresh", async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/1", title: "Tin Cup Jane", date: "Fri, Nov 20" }];
    const r = await cmd("venueEvents.refresh", { venueId: v });
    assert.equal(r.count, 1);
    assert.equal((await events(v)).length, 1);
  });
});

describe("venueEvents.setTake", () => {
  const seedEvent = async () => {
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/1", title: "Tin Cup Jane", date: "Fri, Nov 20" }];
    await refresh(v);
    return { v, e: await byTitle(v, "Tin Cup Jane") };
  };
  test("creates venueEventNotes/{artistId}__{eventId}, updates it, and null clears the take", async () => {
    const { v, e } = await seedEvent();
    const id = venueEventNoteId(TEST_ARTIST, e.id);
    assert.equal(id, `${TEST_ARTIST}__${e.id}`);
    await cmd("venueEvents.setTake", { eventId: e.id, take: "notFit", note: "  good room for us  " });
    let n = (await db.get("venueEventNotes", id))!;
    assert.equal(n.take, "notFit");
    assert.equal(n.note, "good room for us");
    assert.equal(n.artistId, TEST_ARTIST);
    assert.equal(n.venueId, v);
    assert.equal(n.eventId, e.id);
    await cmd("venueEvents.setTake", { eventId: e.id, pitchId: "p1" });
    n = (await db.get("venueEventNotes", id))!;
    assert.equal(n.take, "notFit");
    assert.equal(n.note, "good room for us", "a field left out is untouched");
    assert.equal(n.pitchId, "p1");
    await cmd("venueEvents.setTake", { eventId: e.id, take: null });
    n = (await db.get("venueEventNotes", id))!;
    assert.ok(n && !n.take, "take cleared");
    assert.equal(n.note, "good room for us");
  });
  test("a first call with null leaves the field off", async () => {
    const { e } = await seedEvent();
    await cmd("venueEvents.setTake", { eventId: e.id, take: null, note: "just a note" });
    const n = (await db.get("venueEventNotes", venueEventNoteId(TEST_ARTIST, e.id)))!;
    assert.ok(!n.take);
    assert.equal(n.note, "just a note");
  });
  test("a blank note clears the note", async () => {
    const { e } = await seedEvent();
    await cmd("venueEvents.setTake", { eventId: e.id, take: "notFit", note: "x" });
    await cmd("venueEvents.setTake", { eventId: e.id, note: "   " });
    const n = (await db.get("venueEventNotes", venueEventNoteId(TEST_ARTIST, e.id)))!;
    assert.ok(!n.note);
    assert.equal(n.take, "notFit");
  });
  test("each band has its own note; an unknown show is not found; a bad take is refused", async () => {
    const { e } = await seedEvent();
    await cmd("venueEvents.setTake", { eventId: e.id, take: "notFit" });
    await cmd("venueEvents.setTake", { eventId: e.id, take: null, note: "theirs" }, { ...ctx, artistId: "other-artist" });
    assert.equal((await db.get("venueEventNotes", `${TEST_ARTIST}__${e.id}`))!.take, "notFit");
    assert.ok(!(await db.get("venueEventNotes", `other-artist__${e.id}`))!.take);
    await assert.rejects(cmd("venueEvents.setTake", { eventId: "nope", take: "notFit" }), /not found/i);
    assert.throws(() => registry["venueEvents.setTake"].input.parse({ eventId: e.id, take: "maybe" }));
    // a show isn't shortlisted or pitched by hand: Pitch this pitches the venue
    assert.throws(() => registry["venueEvents.setTake"].input.parse({ eventId: e.id, take: "interested" }));
    assert.throws(() => registry["venueEvents.setTake"].input.parse({ eventId: e.id, take: "pitched" }));
  });
  test("members cannot set a take (admin-only command)", () => {
    assert.deepEqual(registry["venueEvents.setTake"].roles, ["admin"]);
    assert.ok(registry["venueEvents.refresh"].roles.includes("member"));
  });
});

describe("venueEvents.pitch (#79)", () => {
  const seed = async () => {
    await makeArtist("Nora Quill Band", "nora-quill-band");
    const v = await makeVenue({ calendar: CAL });
    rows = [{ path: "/e/1", title: "Tin Cup Jane", date: "Fri, Dec 18" }];
    await refresh(v);
    return { v, e: await byTitle(v, "Tin Cup Jane") };
  };
  const pitchesOf = async (v: string) => (await db.list("pitches", (q) => q.where("target.id", "==", v))).filter((p) => !p.deletedAt);
  const notesOf = async (id: string) => (await db.list(`pitches/${id}/activity`)).filter((a) => a.type === "note").map((a) => a.text);

  test("no pitch yet: puts the venue on the Pitch List with the show's date and a timeline note, and links the show", async () => {
    const { v, e } = await seed();
    await cmd("venueEvents.setTake", { eventId: e.id, take: "notFit" });
    const r = await cmd("venueEvents.pitch", { eventId: e.id });
    assert.equal(r.existing, false);
    const [p] = await pitchesOf(v);
    assert.equal(p.id, r.pitchId);
    assert.deepEqual([p.target.kind, p.status, p.dates], ["venue", "toPitch", ["2026-12-18"]]);
    assert.deepEqual(await notesOf(p.id), ["Added Tin Cup Jane on Fri, Dec 18 (from the venue's calendar)"]);
    const n = (await db.get("venueEventNotes", venueEventNoteId(TEST_ARTIST, e.id)))!;
    assert.deepEqual([n.take, n.pitchId, n.venueId], [undefined, p.id, v], "pitching it clears Not a fit");
  });
  test("an open pitch on the venue is reused and gets the date", async () => {
    const { v, e } = await seed();
    const first = await cmd("pitches.flag", { kind: "venue", id: v, dates: ["2027-02-01"] });
    const r = await cmd("venueEvents.pitch", { eventId: e.id });
    assert.deepEqual([r.pitchId, r.existing], [first.id, true]);
    assert.deepEqual((await db.get("pitches", first.id))!.dates, ["2026-12-18", "2027-02-01"]);
    assert.equal((await pitchesOf(v)).length, 1);
  });
  test("campaignId (#82): a new pitch goes in that campaign; an existing pitch keeps its own and says which", async () => {
    const { v, e } = await seed();
    const spring = (await cmd("campaigns.create", { name: "Spring" })).id;
    const r = await cmd("venueEvents.pitch", { eventId: e.id, campaignId: spring });
    assert.deepEqual([r.existing, r.campaignId], [false, spring]);
    assert.equal((await db.get("pitches", r.pitchId))!.campaignId, spring);
    const fall = (await cmd("campaigns.create", { name: "Fall" })).id;
    const again = await cmd("venueEvents.pitch", { eventId: e.id, campaignId: fall });
    assert.deepEqual([again.pitchId, again.existing, again.campaignId], [r.pitchId, true, spring], "never moved: the page asks first (Q2)");
    assert.equal((await db.get("pitches", r.pitchId))!.campaignId, spring);
  });
  test("unpitch takes the show and its date off the pitch, logs it, and leaves the pitch on the Pitch List", async () => {
    const { v, e } = await seed();
    await cmd("pitches.flag", { kind: "venue", id: v, dates: ["2027-02-01"] });
    const { pitchId } = await cmd("venueEvents.pitch", { eventId: e.id });
    await cmd("venueEvents.unpitch", { eventId: e.id });
    const p = (await db.get("pitches", pitchId))!;
    assert.deepEqual([p.status, p.dates, !!p.deletedAt], ["toPitch", ["2027-02-01"], false]);
    assert.match((await notesOf(pitchId)).join("\n"), /Took Tin Cup Jane on Fri, Dec 18 off the pitch/);
    assert.ok(!(await db.get("venueEventNotes", venueEventNoteId(TEST_ARTIST, e.id)))!.pitchId);
    // again, or a show never pitched: nothing to do
    assert.deepEqual(await cmd("venueEvents.unpitch", { eventId: e.id }), { pitchId: null });
  });
  test("an unknown show is not found; admin only", async () => {
    await assert.rejects(cmd("venueEvents.pitch", { eventId: "nope" }), /not found/i);
    await assert.rejects(cmd("venueEvents.unpitch", { eventId: "nope" }), /not found/i);
    assert.deepEqual(registry["venueEvents.pitch"].roles, ["admin"]);
    assert.deepEqual(registry["venueEvents.unpitch"].roles, ["admin"]);
  });
});

describe("On tour (#79)", () => {
  test("a headliner at 2+ Colorado rooms within 3 weeks gets tourStops on each show; a later refresh drops it when the run is gone", async () => {
    const byUrl: Record<string, Row[]> = {};
    setFetcher(async (url: string): Promise<RawPage> => ({ url, status: 200, type: "text/html", body: `<ul>${(byUrl[url] ?? []).map((r) => `<li class="ev"><a class="t" href="${r.path}"><span class="name">${r.title}</span></a><span class="when">${r.date}</span></li>`).join("")}</ul>` }));
    const cal = (u: string) => ({ ...CAL, url: u });
    const a = (await db.create(ctx, "venues", venue("Aggie Theatre", "Fort Collins", { calendar: cal("https://a.example.com/") }))).id;
    const b = (await db.create(ctx, "venues", venue("Bluebird Theater", "Denver", { calendar: cal("https://b.example.com/") }))).id;
    const w = (await db.create(ctx, "venues", venue("Cowboy Bar", "Cheyenne", { calendar: cal("https://w.example.com/"), address: { city: "Cheyenne", state: "WY" } }))).id;
    byUrl["https://a.example.com/"] = [{ path: "/1", title: "Arlo", date: "Fri, Jan 15" }, { path: "/2", title: "Twin Fin", date: "Sat, Jan 16" }];
    byUrl["https://b.example.com/"] = [{ path: "/1", title: "Arlo", date: "Thu, Jan 28" }];
    byUrl["https://w.example.com/"] = [{ path: "/1", title: "Arlo", date: "Sun, Jan 17" }, { path: "/2", title: "Twin Fin", date: "Mon, Jan 18" }];
    await refresh(a);
    assert.equal((await byTitle(a, "Arlo")).tourStops, undefined, "one Colorado room so far");
    await refresh(w);
    await refresh(b);
    assert.equal((await byTitle(a, "Arlo")).tourStops, 2, "the other room's refresh marks this one too");
    assert.equal((await byTitle(b, "Arlo")).tourStops, 2);
    assert.equal((await byTitle(w, "Arlo")).tourStops, undefined, "Wyoming isn't counted or marked");
    assert.equal((await byTitle(a, "Twin Fin")).tourStops, undefined);
    // Arlo drops off the Bluebird's calendar (gone): the Aggie show is no longer part of a run
    byUrl["https://b.example.com/"] = [{ path: "/9", title: "Someone Else", date: "Thu, Jan 28" }];
    await refresh(b);
    assert.equal((await byTitle(a, "Arlo")).tourStops, undefined);
  });
});

describe("venueEvents.looked (#79)", () => {
  test("returns the previous look (null the first time) and stores now, per artist", async () => {
    assert.deepEqual(await cmd("venueEvents.looked", {}), { previous: null });
    const t = (await firestore().doc(`userPrefs/${ctx.uid}`).get()).data()!.calendarsLookedAt[TEST_ARTIST];
    assert.match(t, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(await cmd("venueEvents.looked", {}), { previous: t });
    assert.ok(registry["venueEvents.looked"].roles.includes("member"));
  });
});

describe("firestore rules", () => {
  let env: RulesTestEnvironment;
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8280").split(":");
  before(async () => {
    env = await initializeTestEnvironment({
      projectId: process.env.GCLOUD_PROJECT ?? "demo-band-tracker",
      firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
    });
  });
  // The file's top-level beforeEach wipes the emulator before every test, so the rules fixtures are seeded after it.
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const d = c.firestore();
      await setDoc(doc(d, "venueEvents/v1__e1"), { venueId: "v1", title: "Tin Cup Jane", date: "2026-11-20", status: "onsale" });
      await setDoc(doc(d, "venueEventSources/v1"), { venueId: "v1", type: "selectors", lastRunAt: "2026-11-10T18:00:00Z" });
      await setDoc(doc(d, "venueEventNotes/x__v1__e1"), { artistId: "x", venueId: "v1", eventId: "v1__e1", take: "interested", deletedAt: null });
      await setDoc(doc(d, "venueEventNotes/y__v1__e1"), { artistId: "y", venueId: "v1", eventId: "v1__e1", take: "notFit", deletedAt: null });
    });
  });
  after(async () => { await env.cleanup(); });
  const adminX = () => env.authenticatedContext("rudy", { artists: { x: "admin" } }).firestore();
  const memberX = () => env.authenticatedContext("hugo", { artists: { x: "member" } }).firestore();
  const adminY = () => env.authenticatedContext("olga", { artists: { y: "admin" } }).firestore();
  const noBand = () => env.authenticatedContext("new", { artists: {} }).firestore();
  const anon = () => env.unauthenticatedContext().firestore();

  test("any signed-in band user reads venueEvents and venueEventSources", async () => {
    for (const c of [adminX, memberX, adminY]) {
      await assertSucceeds(getDoc(doc(c(), "venueEvents/v1__e1")));
      await assertSucceeds(getDoc(doc(c(), "venueEventSources/v1")));
      await assertSucceeds(getDocs(query(collection(c(), "venueEvents"), where("venueId", "==", "v1"))));
    }
  });
  test("signed-out and band-less logins read neither", async () => {
    for (const c of [anon, noBand]) {
      await assertFails(getDoc(doc(c(), "venueEvents/v1__e1")));
      await assertFails(getDoc(doc(c(), "venueEventSources/v1")));
    }
  });
  test("only that artist's admin reads venueEventNotes", async () => {
    await assertSucceeds(getDoc(doc(adminX(), "venueEventNotes/x__v1__e1")));
    await assertFails(getDoc(doc(adminY(), "venueEventNotes/x__v1__e1")));
    await assertFails(getDoc(doc(memberX(), "venueEventNotes/x__v1__e1")));
    await assertFails(getDoc(doc(noBand(), "venueEventNotes/x__v1__e1")));
    await assertFails(getDoc(doc(anon(), "venueEventNotes/x__v1__e1")));
    await assertSucceeds(getDoc(doc(adminY(), "venueEventNotes/y__v1__e1")));
  });
  test("note lists must filter by artistId", async () => {
    await assertSucceeds(getDocs(query(collection(adminX(), "venueEventNotes"), where("artistId", "==", "x"))));
    await assertFails(getDocs(query(collection(adminX(), "venueEventNotes"), where("artistId", "==", "y"))));
    await assertFails(getDocs(collection(adminX(), "venueEventNotes")));
    await assertFails(getDocs(query(collection(memberX(), "venueEventNotes"), where("artistId", "==", "x"))));
  });
  test("nothing here is writable from the client", async () => {
    for (const p of ["venueEvents/v1__new", "venueEvents/v1__e1", "venueEventSources/v1", "venueEventNotes/x__new", "venueEventNotes/x__v1__e1"]) {
      await assertFails(setDoc(doc(adminX(), p), { artistId: "x", title: "hack" }));
    }
  });
});

describe("refreshAll", () => {
  test("rooms on one page share one fetch; each gets its own events", async () => {
    let fetches = 0;
    setFetcher(async (url: string): Promise<RawPage> => { fetches++; return { url, status: 200, type: "text/html", body: page() }; });
    rows = [{ path: "/e/1", title: "Tin Cup Jane", date: "Fri, Nov 20" }];
    const a = (await db.create(ctx, "venues", venue("Example Room A", "Denver", { calendar: CAL }))).id;
    const b = (await db.create(ctx, "venues", venue("Example Room B", "Denver", { calendar: CAL }))).id;
    const out = await refreshAll({ only: [a, b], now: NOW });
    assert.equal(fetches, 1);
    assert.deepEqual(out.map((r) => r.count), [1, 1]);
    assert.equal((await events(a)).length, 1);
    assert.equal((await events(b)).length, 1);
  });
});
