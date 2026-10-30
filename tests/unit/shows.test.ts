import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { BAND_CALENDAR_ID, READONLY_CALENDAR_ID } from "../../fakes/fake-calendar/server";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { calendarClient, bandsintownClient, gmailClient } from "@/server/integrations";
import { answerByToken, viewByToken } from "@/server/availability";
import { planHome, addDays, retargetAskMessage, fmtTime, showFilter, showTabFor, showName, publicShowName, showCity } from "@/lib/shows";
import { firestore } from "@/server/admin";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let mctx: Ctx;
let ids: Record<string, string>;
let artistId: string;
let venueId: string;
let pitchId: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
  process.env.CALENDAR_BASE_URL = s.running["fake-calendar"].url;
  process.env.BANDSINTOWN_BASE_URL = s.running["fake-bandsintown"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

beforeEach(async () => {
  await resetEmulators();
  for (const f of ["fake-gmail", "fake-calendar", "fake-bandsintown"]) {
    const url = { "fake-gmail": process.env.GMAIL_BASE_URL, "fake-calendar": process.env.CALENDAR_BASE_URL, "fake-bandsintown": process.env.BANDSINTOWN_BASE_URL }[f]!;
    await fetch(url + "/__reset", { method: "POST" });
  }
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" });
  ctx = { uid: u.uid, role: "admin", via: "app", runId: newRunId() };
  ids = {};
  const sys = ctx;
  for (const [k, email] of [["ingrid", "ingrid@example.com"], ["jeff", "jeff@example.com"], ["david", "david@example.com"], ["sam", undefined]] as const) {
    ids[k] = (await db.create(sys, "musicians", { name: k[0].toUpperCase() + k.slice(1), instruments: [], active: true, ...(email ? { email } : {}) })).id;
  }
  artistId = (await db.create(sys, "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: {},
    configurations: [
      { id: "trio", name: "Trio", billingName: "Ingrid Avison Trio", musicianIds: [ids.ingrid, ids.jeff, ids.david] },
      { id: "duo", name: "Duo", billingName: "Ingrid Avison Duo", musicianIds: [ids.ingrid, ids.jeff] },
    ],
  }, { id: TEST_ARTIST })).id;
  venueId = (await cmd("venues.create", venue("Hi-Dive", "Denver", { address: { street: "7 S Broadway", city: "Denver", state: "CO" }, sound: { provider: "venueProvided", notes: "House engineer" } }))).id;
  pitchId = (await cmd("pitches.flag", { kind: "venue", id: venueId, pitchedAs: "trio" })).id;
  mctx = { uid: "m-david", role: "member", musicianId: ids.david, via: "app", runId: newRunId() };
});

const create = (extra: Record<string, unknown> = {}) =>
  cmd("shows.create", { pitchId, date: "2027-01-16", venueId, times: { loadIn: "18:00", set: "20:00", setLengthSec: 2400 }, needs: { poster: true, backline: false, merch: true }, ...extra });

test("pure: dates, home plan", () => {
  assert.equal(addDays("2027-03-01", -1), "2027-02-28");
  assert.equal(fmtTime("19:05"), "7:05 pm");

  const sh = (i: string, date: string, status: "hold" | "confirmed" | "played" | "canceled" = "confirmed") => ({ id: i, date, status });
  const shows = [sh("t1", "2026-10-23"), sh("t2", "2026-10-23"), sh("y", "2026-10-22"), sh("old", "2026-10-01", "played"), sh("n1", "2026-11-14"), sh("x", "2026-10-30", "canceled")];
  const open = { id: "a1", askedMusicianIds: ["me"], responses: {} as Record<string, never> };
  const closed = { id: "a2", askedMusicianIds: ["me"], responses: {}, closedAt: new Date() };
  const answered = { id: "a3", askedMusicianIds: ["me"], responses: { me: { answer: "yes" as const } } };
  const admin = planHome({ role: "admin", musicianId: "me", shows, asks: [open, closed, answered], today: "2026-10-23", unsettled: new Set(["y", "old"]) });
  assert.deepEqual(admin.today.map((s) => s.id), ["t1", "t2"]);
  assert.deepEqual(admin.recent.map((s) => s.id), ["y"]);
  assert.equal(admin.next?.id, "n1");
  assert.deepEqual(admin.asks.map((a) => a.id), ["a1"]);
  const settled = planHome({ role: "admin", shows, asks: [], today: "2026-10-23", unsettled: new Set() });
  assert.equal(settled.recent.length, 0);
  const member = planHome({ role: "member", musicianId: "me", shows, asks: [open], today: "2026-10-23" });
  assert.deepEqual(member.recent.map((s) => s.id), ["y"]);
});

test("Booked it: show + showDeal in one go, pitch linked and booked, no checklists, personnel, calendar", async () => {
  const r = await create({ deal: { deal: "guarantee", guarantee: 30000 }, dayOfContact: { name: "Sam", phone: "(303) 555-0117" } });
  const show = (await db.get("shows", r.id))!;
  const deal = (await db.get("showDeals", r.id))!;
  assert.equal(deal.pitchId, pitchId);
  assert.equal(deal.guarantee, undefined, "the guarantee is an income doc now");
  assert.equal(deal.income, undefined, "nothing writes the deal's income[] any more");
  const inc = (await db.list("income")).filter((i) => i.showId === r.id);
  assert.deepEqual(inc.map((i) => [i.category, i.amount, i.receivedAt]), [["guarantee", 30000, undefined]], "expected, not received");
  assert.equal(deal.totals.income, 30000);
  assert.deepEqual(show.dayOfContact, { name: "Sam", phone: "(303) 555-0117" });
  assert.deepEqual(show.statusHistory.map((h: any) => [h.status, h.by]), [["confirmed", ctx.uid]]);
  assert.equal(show.billedAs, "trio");
  assert.deepEqual(show.personnel, [ids.ingrid, ids.jeff, ids.david]);
  assert.deepEqual(show.sound, { provider: "venueProvided", notes: "House engineer" });
  assert.equal(show.venue.address, "7 S Broadway, Denver");
  assert.deepEqual(show.checklists, [], "lists are picked by hand now: none are built from the show's sound or needs");
  assert.equal(show.checklist, undefined); assert.equal(show.gear, undefined);
  const pitch = (await db.get("pitches", pitchId))!;
  assert.deepEqual(pitch.showIds, [r.id]);
  assert.equal(pitch.status, "booked");
  const act = await db.list(`pitches/${pitchId}/activity`);
  assert.ok(act.some((a) => a.toStatus === "booked"));

  // Calendar is never touched by saving a show
  assert.equal(show.calendarEventId, undefined);
  assert.equal((await calendarClient().list()).length, 0);
});

test("Booked it validates and rolls back whole when the venue is missing", async () => {
  await assert.rejects(cmd("shows.create", { pitchId, date: "2027-01-16", venueId: "nope" }));
  assert.equal((await db.list("shows")).length, 0);
  assert.equal((await db.list("showDeals")).length, 0);
  assert.equal((await db.get("pitches", pitchId))!.status, "toPitch");
});

test("billed as fills personnel and leaves the checklists alone", async () => {
  const r = await create({ billedAs: "duo", sound: { provider: "bandProvided" } });
  let show = (await db.get("shows", r.id))!;
  assert.deepEqual(show.personnel, [ids.ingrid, ids.jeff]);
  await cmd("shows.setChecklists", { id: r.id, checklists: [...show.checklists, { name: "Gear", items: [{ label: "Keys rig", ownerId: ids.jeff }] }] });
  await cmd("shows.update", { id: r.id, patch: { billedAs: "trio" } });
  show = (await db.get("shows", r.id))!;
  assert.deepEqual(show.personnel, [ids.ingrid, ids.jeff, ids.david]);
  assert.deepEqual(show.checklists.find((l: any) => l.name === "Gear").items.map((g: any) => g.label), ["Keys rig"], "changing billed as never touches the lists");
  await cmd("shows.update", { id: r.id, patch: { personnel: [ids.ingrid] } });
  assert.deepEqual((await db.get("shows", r.id))!.personnel, [ids.ingrid]);
  await assert.rejects(cmd("shows.update", { id: r.id, patch: { rebuildGear: true } }), /Unrecognized key/);
  await assert.rejects(cmd("shows.update", { id: r.id, patch: { billedAs: "nope" } }), /No configuration/);
});

test("a show not yet migrated: its old checklist and gear read as lists, and the first change writes the new shape", async () => {
  const r = await create();
  await db.update(ctx, "shows", r.id, {
    checklists: null, checklist: [{ id: "c1", label: "Old item", done: false }], gear: [{ id: "g1", label: "Bass rig", musicianId: ids.david, packed: false }],
  });
  await cmd("shows.checkItem", { id: r.id, listId: "gear", itemId: "g1", done: true }, mctx);
  const show = (await db.get("shows", r.id))!;
  assert.equal(show.checklist, undefined); assert.equal(show.gear, undefined);
  assert.deepEqual(show.checklists.map((l: any) => [l.name, l.items.map((i: any) => [i.label, i.done, i.ownerId ?? null])]),
    [["Gig prep", [["Old item", false, null]]], ["Gear", [["Bass rig", true, ids.david]]]]);
  assert.deepEqual(show.checklists.map((l: any) => l.templateId), [null, null]);
  assert.equal(show.checklists[1].items[0].doneBy, "m-david");
});

test("status changes: setStatus keeps who, when and why; a blank reason clears it", async () => {
  const r = await create({ status: "hold" });
  await cmd("shows.setStatus", { id: r.id, status: "canceled", reason: "  Venue double-booked  " });
  let show = (await db.get("shows", r.id))!;
  assert.equal(show.status, "canceled"); assert.equal(show.reason, "Venue double-booked");
  await cmd("shows.setStatus", { id: r.id, status: "confirmed", reason: " " });
  show = (await db.get("shows", r.id))!;
  assert.equal(show.reason, undefined);
  await cmd("shows.update", { id: r.id, patch: { status: "hold" } });
  show = (await db.get("shows", r.id))!;
  assert.deepEqual(show.statusHistory.map((h: any) => [h.status, h.reason ?? null, h.by]),
    [["hold", null, ctx.uid], ["canceled", "Venue double-booked", ctx.uid], ["confirmed", null, ctx.uid], ["hold", null, ctx.uid]]);
  assert.ok(show.statusHistory.every((h: any) => !isNaN(Date.parse(h.at))));
  await assert.rejects(cmd("shows.setStatus", { id: r.id, status: "played" }), /Invalid/);
  assert.ok(!registry["shows.setStatus"].roles.includes("member"));
});

test("comments: the whole band posts; only the author edits or deletes", async () => {
  const r = await create();
  const c = await cmd("shows.comment", { id: r.id, body: "Parking is behind the building" }, mctx);
  const doc = (await db.get(`shows/${r.id}/comments`, c.id))!;
  assert.equal(doc.audience, "band"); assert.equal(doc.authorId, "m-david");
  await cmd("shows.editComment", { id: r.id, commentId: c.id, body: "Parking is behind the building, not on Terry" }, mctx);
  assert.match((await db.get(`shows/${r.id}/comments`, c.id))!.body, /not on Terry/);
  await assert.rejects(cmd("shows.editComment", { id: r.id, commentId: c.id, body: "x" }), /your own comments/);
  await assert.rejects(cmd("shows.removeComment", { id: r.id, commentId: c.id }), /your own comments/);
  await cmd("shows.removeComment", { id: r.id, commentId: c.id }, mctx);
  assert.ok((await db.get(`shows/${r.id}/comments`, c.id))!.deletedAt);
});

test("Bandsintown: public + confirmed lists it; holds and private stay off; changes update; cancel removes", async () => {
  const hold = await create({ status: "hold", publishToBandsintown: true });
  assert.equal((await db.get("shows", hold.id))!.listings.bandsintown, undefined);
  const priv = await create({ date: "2027-02-06", publishToBandsintown: false });
  assert.equal((await db.get("shows", priv.id))!.listings.bandsintown, undefined);
  assert.equal((await bandsintownClient().list()).length, 0);

  const r = await create({ date: "2027-02-13", publishToBandsintown: true, ticketUrl: "https://tix.example/1", times: { set: "21:15", setLengthSec: 2700 } });
  let show = (await db.get("shows", r.id))!;
  const bit = show.listings.bandsintown;
  assert.equal(bit.state, "listed");
  assert.ok(bit.syncedAt && bit.eventId);
  assert.equal((await bandsintownClient().list())[0].timeZone, "America/Denver");
  let events = await bandsintownClient().list();
  assert.equal(events.length, 1);
  assert.equal(events[0].datetime, "2027-02-13T21:15:00");
  assert.equal(events[0].venueName, "Hi-Dive");
  assert.equal(events[0].city, "Denver");
  assert.equal(events[0].region, "CO");
  assert.equal(events[0].ticketUrl, "https://tix.example/1");

  // promoting the hold to confirmed lists it
  await cmd("shows.update", { id: hold.id, patch: { status: "confirmed" } });
  assert.equal((await db.get("shows", hold.id))!.listings.bandsintown.state, "listed");
  assert.equal((await bandsintownClient().list()).length, 2);

  // date and time change updates the same event, not a new one
  await cmd("shows.update", { id: r.id, patch: { date: "2027-02-14", times: { set: "20:30", setLengthSec: 2700 } } });
  events = (await bandsintownClient().list()).filter((e) => e.id === bit.eventId);
  assert.equal(events[0].datetime, "2027-02-14T20:30:00");
  assert.equal((await bandsintownClient().list()).length, 2);

  // going private removes it
  await cmd("shows.update", { id: hold.id, patch: { publishToBandsintown: false } });
  assert.equal((await db.get("shows", hold.id))!.listings.bandsintown, undefined);
  assert.equal((await bandsintownClient().list()).length, 1);

  // cancel removes it
  await cmd("shows.cancel", { id: r.id });
  show = (await db.get("shows", r.id))!;
  assert.equal(show.status, "canceled");
  assert.equal(show.listings.bandsintown, undefined);
  assert.equal((await bandsintownClient().list()).length, 0);
});

test("Bandsintown failure is recorded on the show, not thrown; retry works", async () => {
  const good = process.env.BANDSINTOWN_BASE_URL;
  process.env.BANDSINTOWN_BASE_URL = "http://127.0.0.1:1";
  const r = await create({ publishToBandsintown: true });
  assert.ok(r.warnings.some((w: string) => w.startsWith("Bandsintown")));
  const bad = (await db.get("shows", r.id))!.listings.bandsintown;
  assert.equal(bad.state, "error");
  assert.ok(bad.error);
  process.env.BANDSINTOWN_BASE_URL = good;
  await cmd("shows.sync", { id: r.id });
  assert.equal((await db.get("shows", r.id))!.listings.bandsintown.state, "listed");
});

const useBandCalendar = (id = BAND_CALENDAR_ID) => db.update(ctx, "artists", artistId, { calendar: { id, name: "Ingrid Avison Band" } });

test("Calendar: only the button sends; preview shows what goes out; update and remove on the band calendar", async () => {
  const r = await create({});
  await assert.rejects(cmd("shows.calendarPreview", { id: r.id }), /No band calendar yet/);
  await assert.rejects(cmd("shows.calendar", { id: r.id, on: true }), /No band calendar yet/);
  await useBandCalendar();

  const p = await cmd("shows.calendarPreview", { id: r.id });
  assert.deepEqual([p.calendar.name, p.action, p.unchanged], ["Ingrid Avison Band", "create", false]);
  assert.match(p.event.title, /Ingrid Avison Trio at Hi-Dive/);
  assert.deepEqual([p.event.start, p.event.end, p.event.allDay, p.event.timeZone], ["2027-01-16T18:00:00", "2027-01-16T20:40:00", false, "America/Denver"]);
  assert.equal(p.event.location, "Hi-Dive, 7 S Broadway, Denver");
  assert.match(p.event.description, /Load in 6:00 pm\nSet 8:00 pm \(40m\)/);
  assert.deepEqual(p.invitees.map((x: any) => x.name), ["Ingrid", "Jeff", "David"]);
  assert.deepEqual(p.noEmail, []);
  assert.equal((await calendarClient().list()).length, 0, "a preview sends nothing");

  assert.equal((await cmd("shows.calendar", { id: r.id, on: true })).calendar, "created");
  const evId = (await db.get("shows", r.id))!.calendarEventId;
  let ev = await calendarClient().get(evId);
  assert.equal(ev.calendarId, BAND_CALENDAR_ID);
  assert.deepEqual(ev.attendees.map((a) => a.email).sort(), ["david@example.com", "ingrid@example.com", "jeff@example.com"]);
  assert.equal((await cmd("shows.calendarPreview", { id: r.id })).unchanged, true);

  // Saving the show leaves the event alone until the button is pressed again
  await cmd("shows.update", { id: r.id, patch: { times: { loadIn: "17:00", set: "19:30", setLengthSec: 3600 }, personnel: [ids.ingrid, ids.sam] } });
  assert.equal((await calendarClient().get(evId)).start, "2027-01-16T18:00:00");
  const p2 = await cmd("shows.calendarPreview", { id: r.id });
  assert.deepEqual([p2.action, p2.unchanged, p2.noEmail], ["update", false, ["Sam"]]);
  assert.equal((await cmd("shows.calendar", { id: r.id, on: true })).calendar, "updated");
  ev = await calendarClient().get(evId);
  assert.deepEqual([ev.start, ev.end], ["2027-01-16T17:00:00", "2027-01-16T20:30:00"]);
  assert.deepEqual(ev.attendees.map((a) => a.email), ["ingrid@example.com"]);

  // Canceling leaves the event; only Remove takes it off. A canceled show can't be sent.
  await cmd("shows.cancel", { id: r.id });
  assert.ok(await calendarClient().get(evId));
  await assert.rejects(cmd("shows.calendar", { id: r.id, on: true }), /canceled show/);
  assert.equal((await cmd("shows.calendar", { id: r.id, on: false })).calendar, "removed");
  assert.equal((await calendarClient().list()).length, 0);
  assert.equal((await db.get("shows", r.id))!.calendarEventId, undefined);
});

test("Calendar: an event already on the band calendar that day is offered, linked without sending, then updated", async () => {
  await useBandCalendar();
  const r = await create({});
  const cal = calendarClient({ calendarId: BAND_CALENDAR_ID });
  const mine = await cal.create({ title: "Gig at Hi-Dive", start: "2027-01-16T19:00:00", end: "2027-01-16T22:00:00", location: "Hi-Dive" });
  await cal.create({ title: "Next day", start: "2027-01-17T19:00:00", end: "2027-01-17T20:00:00" });
  const show = await cal.create({ title: "IAB show!", start: "2027-01-16T20:00:00", end: "2027-01-16T21:00:00" });
  await cal.create({ title: "Dinner at the place", start: "2027-01-16T17:00:00", end: "2027-01-16T18:00:00" });
  await calendarClient().create({ calendarId: "primary", title: "Someone's own calendar", start: "2027-01-16T12:00:00", end: "2027-01-16T13:00:00" });

  const p = await cmd("shows.calendarPreview", { id: r.id });
  // A venue word (Hi-Dive -> "dive") or "show" in the title; not just any event that day
  assert.deepEqual(p.existing.map((e: any) => [e.id, e.title, e.location, e.allDay]), [[mine.id, "Gig at Hi-Dive", "Hi-Dive", false], [show.id, "IAB show!", "", false]]);

  assert.equal((await cmd("shows.calendarLink", { id: r.id, eventId: mine.id })).calendar, "linked");
  assert.equal((await db.get("shows", r.id))!.calendarEventId, mine.id);
  assert.equal((await cal.get(mine.id)).title, "Gig at Hi-Dive", "linking sends nothing");
  const p2 = await cmd("shows.calendarPreview", { id: r.id });
  assert.deepEqual([p2.action, p2.unchanged, p2.existing], ["update", false, []]);
  await assert.rejects(cmd("shows.calendarLink", { id: r.id, eventId: mine.id }), /Already on the band calendar/);

  // Another show that day no longer sees it: it's taken
  const other = await create({});
  assert.deepEqual((await cmd("shows.calendarPreview", { id: other.id })).existing.map((e: any) => e.id), [show.id]);
  await assert.rejects(cmd("shows.calendarLink", { id: other.id, eventId: "nope" }), /isn't on the band calendar/);

  assert.equal((await cmd("shows.calendar", { id: r.id, on: true })).calendar, "updated");
  assert.match((await cal.get(mine.id)).title, /Ingrid Avison Trio at Hi-Dive/);
});

test("Calendar: an event deleted in Google stays deleted until restore puts it back; no write access fails with Google's reason", async () => {
  await useBandCalendar();
  const r = await create({});
  await cmd("shows.calendar", { id: r.id, on: true });
  const evId = (await db.get("shows", r.id))!.calendarEventId;
  await calendarClient().delete(evId);
  const p = await cmd("shows.calendarPreview", { id: r.id });
  assert.deepEqual([p.action, p.deleted, p.unchanged], ["update", true, false]);
  await assert.rejects(cmd("shows.calendar", { id: r.id, on: true }), /Someone deleted this show's event/);
  assert.equal((await calendarClient().get(evId)).cancelled, true, "a plain send doesn't bring it back");
  assert.equal((await cmd("shows.calendar", { id: r.id, on: true, restore: true })).calendar, "restored");
  assert.equal((await calendarClient().get(evId)).cancelled, undefined);
  assert.equal((await calendarClient().list()).length, 1);
  assert.equal((await cmd("shows.calendarPreview", { id: r.id })).deleted, false);

  await useBandCalendar(READONLY_CALENDAR_ID);
  const other = await create({ date: "2027-02-01" });
  await assert.rejects(cmd("shows.calendar", { id: other.id, on: true }), /Google Calendar: .*writer access/);
  assert.equal((await db.get("shows", other.id))!.calendarEventId, undefined);
});

test("Calendar: removing a show or rehearsal takes its event off the band calendar, and Undo puts it back", async () => {
  const { undoRun } = await import("@/server/undo");
  await useBandCalendar();
  const show = await create({});
  const reh = await cmd("rehearsals.create", { date: "2027-01-10", personnel: [ids.ingrid], songs: [] });
  await cmd("shows.calendar", { id: show.id, on: true });
  await cmd("rehearsals.calendar", { id: reh.id, on: true });
  assert.equal((await calendarClient().list()).length, 2);

  const rm = { ...ctx, runId: newRunId() };
  await cmd("shows.remove", { id: show.id }, rm);
  await cmd("rehearsals.remove", { id: reh.id }, rm);
  assert.equal((await calendarClient().list()).length, 0, "both events came off");

  const rep = await undoRun(ctx, rm.runId);
  assert.deepEqual(rep.calendar.map((x) => x.kind).sort(), ["rehearsals", "shows"]);
  assert.deepEqual(rep.failed, []);
  assert.deepEqual((await calendarClient().list()).map((e) => e.id).sort(),
    [(await db.get("shows", show.id))!.calendarEventId, (await db.get("rehearsals", reh.id))!.calendarEventId].sort(), "the same events are back");

  // The calendar can't be reached (here: no band calendar chosen any more): nothing is removed.
  await db.update(ctx, "artists", artistId, { calendar: null });
  await assert.rejects(cmd("shows.remove", { id: show.id }), /No band calendar yet/);
  assert.ok(!(await db.get("shows", show.id))!.deletedAt);
});

test("Rehearsals: preview and send to the band calendar; all day without a start time; saving never sends", async () => {
  await useBandCalendar();
  const r = await cmd("rehearsals.create", {
    date: "2027-01-10", location: { name: "Doghouse", address: "12 Main St, Boulder" }, personnel: [ids.ingrid, ids.sam], notes: "Bring the new charts", songs: [],
  });
  assert.equal((await calendarClient().list()).length, 0);
  let p = await cmd("rehearsals.calendarPreview", { id: r.id });
  assert.deepEqual([p.event.title, p.event.start, p.event.end, p.event.allDay], ["Ingrid Avison Band rehearsal at Doghouse", "2027-01-10", "2027-01-11", true]);
  assert.equal(p.event.location, "Doghouse, 12 Main St, Boulder");
  assert.equal(p.event.description, "Bring the new charts");
  assert.deepEqual([p.invitees.map((x: any) => x.email), p.noEmail], [["ingrid@example.com"], ["Sam"]]);

  await cmd("rehearsals.calendar", { id: r.id, on: true });
  const evId = (await db.get("rehearsals", r.id))!.calendarEventId;
  assert.equal((await calendarClient().get(evId)).calendarId, BAND_CALENDAR_ID);
  await cmd("rehearsals.update", { id: r.id, patch: { startTime: "19:00", endTime: "21:30" } });
  assert.equal((await calendarClient().get(evId)).start, "2027-01-10", "saving leaves the event alone");
  p = await cmd("rehearsals.calendarPreview", { id: r.id });
  assert.deepEqual([p.action, p.event.start, p.event.end, p.event.allDay], ["update", "2027-01-10T19:00:00", "2027-01-10T21:30:00", false]);
  await cmd("rehearsals.calendar", { id: r.id, on: true });
  assert.equal((await calendarClient().get(evId)).end, "2027-01-10T21:30:00");
  await cmd("rehearsals.calendar", { id: r.id, on: false });
  assert.equal((await calendarClient().list()).length, 0);
});

test("Settings > Google: choose the band calendar from your own list; check your access", async () => {
  const actx = { ...ctx, artistId };
  const { calendars } = await cmd("google.calendars", {}, actx);
  assert.deepEqual(calendars.map((c: any) => [c.id, c.canWrite]), [["primary", true], [BAND_CALENDAR_ID, true], [READONLY_CALENDAR_ID, false]]);
  await assert.rejects(cmd("google.checkCalendar", {}, actx), /No band calendar yet/);
  await assert.rejects(cmd("google.setCalendar", { calendarId: READONLY_CALENDAR_ID }, actx), /only see/);
  await assert.rejects(cmd("google.setCalendar", { calendarId: "nope" }, actx), /doesn't have that calendar/);
  const st = await cmd("google.setCalendar", { calendarId: BAND_CALENDAR_ID }, actx);
  assert.deepEqual(st.calendar, { id: BAND_CALENDAR_ID, name: "Ingrid Avison Band" });
  assert.equal(st.calendarReady, true);
  assert.deepEqual(await cmd("google.checkCalendar", {}, actx), { calendar: { id: BAND_CALENDAR_ID, name: "Ingrid Avison Band" }, canWrite: true, accessRole: "writer", reason: null });
  await useBandCalendar(READONLY_CALENDAR_ID);
  assert.deepEqual((await cmd("google.checkCalendar", {}, actx)).reason, "read_only");
  await useBandCalendar("gone");
  assert.deepEqual((await cmd("google.checkCalendar", {}, actx)).reason, "no_access");
  assert.ok(!registry["google.setCalendar"].roles.includes("member"));
});

test("After the show: ratings, paid attendance, played; no money entered; future shows refused", async () => {
  const past = await create({ date: "2026-10-10" });
  await cmd("shows.afterShow", { id: past.id, show: 4, venue: 5, crowd: 60, notes: "Great room", paidAttendance: 58 });
  const show = (await db.get("shows", past.id))!;
  const deal = (await db.get("showDeals", past.id))!;
  assert.equal(show.status, "played");
  assert.deepEqual(deal.rating, { show: 4, venue: 5, notes: "Great room" });
  assert.equal(deal.crowd, 60);
  assert.equal(deal.paidAttendance, 58);
  assert.equal(deal.income, undefined);
  assert.equal((await db.list("income")).filter((i) => i.showId === past.id).length, 0);
  const future = await create({ date: "2030-01-01" });
  await assert.rejects(cmd("shows.afterShow", { id: future.id, show: 3, venue: 3 }), /hasn't happened/);
  await assert.rejects(cmd("shows.afterShow", { id: past.id, show: 6, venue: 3 }));

  // Scores left out keep the stored ones; notes and the crowd estimate land on their own.
  await cmd("shows.afterShow", { id: past.id, crowd: 75, notes: "Ingie Award: Burrito Award" });
  const after = (await db.get("showDeals", past.id))!;
  assert.deepEqual(after.rating, { show: 4, venue: 5, notes: "Ingie Award: Burrito Award" });
  assert.equal(after.crowd, 75);

  // A rating with no stars at all is fine (that is what the Accounting Form import writes).
  const bare = await create({ date: "2026-10-11" });
  await cmd("shows.afterShow", { id: bare.id, crowd: 40, notes: "Packed" });
  const bareDeal = (await db.get("showDeals", bare.id))!;
  assert.deepEqual(bareDeal.rating, { notes: "Packed" });
  assert.equal(bareDeal.crowd, 40);
  assert.equal((await db.get("shows", bare.id))!.status, "played");

  // Nothing filled in is refused: blank notes don't count.
  const empty = await create({ date: "2026-10-12" });
  await assert.rejects(cmd("shows.afterShow", { id: empty.id }), /Fill in something/);
  await assert.rejects(cmd("shows.afterShow", { id: empty.id, notes: "   " }), /Fill in something/);
  assert.equal((await db.get("shows", empty.id))!.status, "confirmed");
  assert.equal((await db.get("showDeals", empty.id))!.rating, undefined);

  // A show migrate:crowd hasn't reached: the next save lifts its nested crowd out instead of leaving the two to disagree.
  const legacy = await create({ date: "2026-10-13" });
  await db.update(ctx, "showDeals", legacy.id, { rating: { show: 2, crowd: 30 } });
  await cmd("shows.afterShow", { id: legacy.id, venue: 4 });
  const lifted = (await db.get("showDeals", legacy.id))!;
  assert.deepEqual(lifted.rating, { show: 2, venue: 4 });
  assert.equal(lifted.crowd, 30);
});

test("availability: ask emails a hashed per-musician link; sub answers by token, no login", async () => {
  const r = await cmd("availability.ask", { pitchId, date: "2027-01-16", musicianIds: [ids.ingrid, ids.david, ids.sam] });
  const av = (await db.get("availability", r.id))!;
  assert.equal(av.label, "Hi-Dive · Sat, Jan 16");
  assert.deepEqual(av.askedMusicianIds, [ids.ingrid, ids.david, ids.sam]);
  assert.deepEqual(r.emailed.sort(), ["David", "Ingrid"]);
  assert.equal(r.notEmailed.length, 1);
  assert.equal(r.notEmailed[0].name, "Sam");

  const mail = await gmailClient().listMessages({ account: "jeff@example.com" });
  assert.equal(mail.length, 2);
  const toDavid = mail.find((m) => m.to.includes("david@example.com"))!;
  assert.match(toDavid.body, /show at Hi-Dive on Sat, Jan 16\. Tap here/);
  const link = /Answer here: (\S+)/.exec(toDavid.body)![1];
  assert.equal(link, r.links[ids.david]);
  const token = link.split("/").pop()!;
  assert.ok(!JSON.stringify(av.linkTokens).includes(token), "token is stored hashed only");
  assert.match(av.linkTokens[ids.david], /^[0-9a-f]{64}$/);

  const samToken = r.links[ids.sam].split("/").pop()!;
  const view = await viewByToken(r.id, ids.sam, samToken);
  assert.equal(view.musicianName, "Sam");
  assert.equal(view.askedBy, "Jeff Smith");
  assert.equal(view.answer, undefined);
  await answerByToken(r.id, ids.sam, samToken, "maybe", " after 6 only ");
  let cur = (await db.get("availability", r.id))!;
  assert.equal(cur.responses[ids.sam].answer, "maybe");
  assert.equal(cur.responses[ids.sam].note, "after 6 only");
  assert.equal(cur.responses[ids.sam].by, "self");
  await answerByToken(r.id, ids.sam, samToken, "yes");
  assert.equal((await db.get("availability", r.id))!.responses[ids.sam].answer, "yes");

  // wrong token, someone else's token, unknown ask: all the same refusal
  await assert.rejects(answerByToken(r.id, ids.sam, "nope", "yes"), { code: "invalid_link" });
  await assert.rejects(answerByToken(r.id, ids.sam, token, "yes"), { code: "invalid_link" });
  await assert.rejects(viewByToken("missing", ids.sam, samToken), { code: "invalid_link" });
  await assert.rejects(answerByToken(r.id, ids.jeff, samToken, "yes"), { code: "invalid_link" });

  // closing stops answers
  await cmd("availability.close", { id: r.id });
  await assert.rejects(answerByToken(r.id, ids.sam, samToken, "no"), { code: "closed" });
  assert.equal((await viewByToken(r.id, ids.sam, samToken)).closed, true);
  await cmd("availability.reopen", { id: r.id });
  await answerByToken(r.id, ids.sam, samToken, "no");
  cur = (await db.get("availability", r.id))!;
  assert.equal(cur.responses[ids.sam].answer, "no");
});

test("availability: one ask about several dates is one doc per date, one email and one link per person", async () => {
  const r = await cmd("availability.ask", { pitchId, dates: ["2027-01-17", "2027-01-16"], musicianIds: [ids.david, ids.sam] });
  assert.equal(r.ids.length, 2);
  const [a, b] = await Promise.all(r.ids.map((x: string) => db.get("availability", x)));
  assert.deepEqual([a!.date, b!.date], ["2027-01-16", "2027-01-17"]);
  assert.equal(a!.channel, "email");
  assert.equal(a!.linkTokens[ids.david], b!.linkTokens[ids.david], "the same link answers both dates");
  const mail = await gmailClient().listMessages({ account: "jeff@example.com" });
  assert.equal(mail.length, 1, "David once; Sam has no email");
  assert.match(mail[0].subject, /Hi-Dive · Sat, Jan 16 or Sun, Jan 17/);

  const samToken = r.links[ids.sam].split("/").pop()!;
  const view = await viewByToken(r.id, ids.sam, samToken);
  assert.deepEqual(view.asks.map((x) => x.date), ["2027-01-16", "2027-01-17"]);
  await answerByToken(r.ids[1], ids.sam, samToken, "no", "away");
  assert.equal((await viewByToken(r.id, ids.sam, samToken)).asks[1].answer, "no");

  // Asking again about an open date adds to that ask (fresh links) instead of starting another.
  const again = await cmd("availability.ask", { pitchId, dates: ["2027-01-16"], musicianIds: [ids.ingrid, ids.sam] });
  assert.equal(again.id, r.ids[0]);
  const cur = (await db.get("availability", r.ids[0]))!;
  assert.deepEqual(cur.askedMusicianIds, [ids.david, ids.sam, ids.ingrid]);
  await assert.rejects(answerByToken(r.ids[0], ids.sam, samToken, "yes"), { code: "invalid_link" });
  // The old link still answers the date it alone covers now.
  assert.deepEqual((await viewByToken(r.ids[1], ids.sam, samToken)).asks.map((x) => x.date), ["2027-01-17"]);
  await assert.rejects(cmd("availability.ask", { pitchId, musicianIds: [ids.david] }), /Pick a date/);
});

test("availability: admin marks answers, reminds only those waiting (fresh links), members answer in the app", async () => {
  const r = await cmd("availability.ask", { pitchId, date: "2027-01-16", musicianIds: [ids.ingrid, ids.jeff, ids.david], message: "Option at Hi-Dive. Can you?" });
  await cmd("availability.mark", { id: r.id, musicianId: ids.ingrid, answer: "yes", note: "told me at rehearsal" });
  let av = (await db.get("availability", r.id))!;
  assert.equal(av.responses[ids.ingrid].by, "admin");
  assert.equal(av.responses[ids.ingrid].note, "told me at rehearsal");

  await cmd("availability.answer", { id: r.id, answer: "no", note: "out of town" }, mctx);
  av = (await db.get("availability", r.id))!;
  assert.equal(av.responses[ids.david].by, "self");
  await assert.rejects(cmd("availability.answer", { id: r.id, answer: "yes" }, { ...mctx, musicianId: ids.sam }), /weren't asked/);
  await cmd("availability.mark", { id: r.id, musicianId: ids.david, answer: null });
  assert.equal((await db.get("availability", r.id))!.responses[ids.david], undefined);

  const before = (await gmailClient().listMessages({ account: "jeff@example.com" })).length;
  const oldHash = (await db.get("availability", r.id))!.linkTokens[ids.jeff];
  const rem = await cmd("availability.remind", { id: r.id });
  assert.deepEqual(Object.keys(rem.links).sort(), [ids.jeff, ids.david].sort(), "Ingrid already answered");
  const after = await gmailClient().listMessages({ account: "jeff@example.com" });
  assert.equal(after.length, before + 2);
  assert.ok(after.every((m) => !/Reminder/.test(m.subject) || m.to.some((t) => ["jeff@example.com", "david@example.com"].includes(t))));
  assert.notEqual((await db.get("availability", r.id))!.linkTokens[ids.jeff], oldHash);
  const t = rem.links[ids.jeff].split("/").pop()!;
  await answerByToken(r.id, ids.jeff, t, "yes");

  await cmd("availability.close", { id: r.id });
  await assert.rejects(cmd("availability.answer", { id: r.id, answer: "yes" }, mctx), /closed/);
  await assert.rejects(cmd("availability.remind", { id: r.id }), /closed/);
  assert.ok(registry["availability.answer"].roles.includes("member") && !registry["availability.ask"].roles.includes("member"));
});

test("availability.answerPitchDate: an admin says if they're free for a pitch date, asked or not", async () => {
  await cmd("pitches.update", { id: pitchId, patch: { dates: ["2027-01-16", "2027-01-17"] } });
  const jeff = { ...ctx, musicianId: ids.jeff };
  // no ask on the date yet: one is made with just the admin
  const made = await cmd("availability.answerPitchDate", { pitchId, date: "2027-01-16", answer: "yes", note: " after 6 " }, jeff);
  let av = (await db.get("availability", made.id))!;
  assert.equal(av.pitchId, pitchId);
  assert.equal(av.date, "2027-01-16");
  assert.deepEqual(av.askedMusicianIds, [ids.jeff]);
  assert.equal(av.responses[ids.jeff].answer, "yes");
  assert.equal(av.responses[ids.jeff].note, "after 6");
  assert.equal(av.responses[ids.jeff].by, "self");
  // answering again changes the same ask
  await cmd("availability.answerPitchDate", { pitchId, date: "2027-01-16", answer: "no" }, jeff);
  assert.equal((await db.list("availability", (q) => q.where("pitchId", "==", pitchId))).length, 1);
  assert.equal((await db.get("availability", made.id))!.responses[ids.jeff].answer, "no");

  // an open ask the admin wasn't on: they're added to it
  const asked = await cmd("availability.ask", { pitchId, date: "2027-01-17", musicianIds: [ids.david, ids.sam] });
  await cmd("availability.answerPitchDate", { pitchId, date: "2027-01-17", answer: "maybe" }, jeff);
  av = (await db.get("availability", asked.id))!;
  assert.deepEqual(av.askedMusicianIds, [ids.david, ids.sam, ids.jeff]);
  assert.equal(av.responses[ids.jeff].answer, "maybe");

  // a date that isn't on the pitch (and has no ask) is refused
  await assert.rejects(cmd("availability.answerPitchDate", { pitchId, date: "2027-02-01", answer: "yes" }, jeff), /isn't on this pitch/);
  // closed
  await cmd("availability.close", { id: asked.id });
  await assert.rejects(cmd("availability.answerPitchDate", { pitchId, date: "2027-01-17", answer: "yes" }, jeff), /closed/);
  // admins only, and they need to be someone in the band
  assert.deepEqual(registry["availability.answerPitchDate"].roles, ["admin"]);
  await assert.rejects(cmd("availability.answerPitchDate", { pitchId, date: "2027-01-16", answer: "yes" }), /isn't linked/);
});

test("availability: Signal asks send nothing, keep sign-in people's links on remind, and are app-only", async () => {
  await makeUser("david@example.com", "member", { name: "David", musicianId: ids.david });
  const actx = { ...ctx, artistId: TEST_ARTIST };
  const r = await cmd("availability.ask", { pitchId, date: "2027-01-16", musicianIds: [ids.david, ids.sam], channel: "signal", message: "Can you play? Answer on the pitch page:" }, actx);
  assert.deepEqual(r.viaSignal.sort(), ["David", "Sam"]);
  assert.deepEqual(r.emailed, []);
  assert.equal((await gmailClient().listMessages({ account: "jeff@example.com" })).length, 0, "Signal: no email");
  // David signs in to answer; Sam has no login, so only Sam's link comes back.
  assert.deepEqual(Object.keys(r.links), [ids.sam]);
  assert.deepEqual(r.notEmailed.map((n: { name: string }) => n.name), ["Sam"]);
  assert.equal(((await firestore().collection("userPrefs").doc(ctx.uid).get()).data()?.askChannel ?? {})[TEST_ARTIST], "signal");

  const before = (await db.get("availability", r.id))!.linkTokens;
  const rem = await cmd("availability.remind", { id: r.id, channel: "signal" }, actx);
  assert.deepEqual(rem.viaSignal.sort(), ["David", "Sam"]);
  assert.deepEqual(Object.keys(rem.links), [ids.sam]);
  const afterTokens = (await db.get("availability", r.id))!.linkTokens;
  assert.equal(afterTokens[ids.david], before[ids.david], "a sign-in person's link is not rotated");
  assert.notEqual(afterTokens[ids.sam], before[ids.sam]);
  assert.equal((await gmailClient().listMessages({ account: "jeff@example.com" })).length, 0);

  await cmd("availability.answer", { id: r.id, answer: "yes" }, mctx);
  const rem2 = await cmd("availability.remind", { id: r.id, channel: "signal" }, actx);
  assert.deepEqual(rem2.viaSignal, ["Sam"]);

  // Roadie can't press Send in Signal.
  const ai = { ...ctx, role: "mcp" as const, via: "mcp" as const };
  await assert.rejects(cmd("availability.ask", { pitchId, date: "2027-01-16", musicianIds: [ids.david], channel: "signal" }, ai), /Only a person can post to Signal/);
  await assert.rejects(cmd("availability.remind", { id: r.id, channel: "signal" }, ai), /Only a person can post to Signal/);
});

test("artist: the Signal group link is its own setting and must be a signal.group link", async () => {
  await assert.rejects(cmd("artists.update", { id: artistId, patch: { signalGroupUrl: "https://example.com/chat" } }), /Signal group link/);
  await cmd("artists.update", { id: artistId, patch: { signalGroupUrl: "https://signal.group/#abc123" } });
  const a = (await db.get("artists", artistId))!;
  assert.equal(a.signalGroupUrl, "https://signal.group/#abc123");
  assert.deepEqual(a.links, {}, "not one of the public links");
  // however it's pasted, it's stored one way
  await cmd("artists.update", { id: artistId, patch: { signalGroupUrl: " sgnl://signal.group/#abc123 " } });
  assert.equal((await db.get("artists", artistId))!.signalGroupUrl, "https://signal.group/#abc123");
  await assert.rejects(cmd("artists.update", { id: artistId, patch: { signalGroupUrl: "https://signal.group/#" } }), /nothing after the #/);
  await cmd("artists.update", { id: artistId, patch: { signalGroupUrl: null } });
  assert.equal((await db.get("artists", artistId))!.signalGroupUrl, undefined);
});

test("booking a pitch with an open ask links the ask to the show", async () => {
  const a = await cmd("availability.ask", { pitchId, date: "2027-01-16", musicianIds: [ids.ingrid] });
  const s = await create();
  assert.equal((await db.get("availability", a.id))!.showId, s.id);
});

test("shows.remove archives the show and its deal and clears the listings", async () => {
  const r = await create({ publishToBandsintown: true });
  assert.equal((await bandsintownClient().list()).length, 1);
  await cmd("shows.remove", { id: r.id });
  assert.equal(await db.list("shows").then((l) => l.length), 0);
  assert.equal((await bandsintownClient().list()).length, 0);
  assert.equal((await calendarClient().list()).length, 0);
});

test("showFilter: every show is upcoming, played, canceled or dropped", () => {
  const today = "2026-10-23";
  const f = (status: "hold" | "confirmed" | "played" | "canceled" | "dropped", date: string) => showFilter({ id: "x", status, date }, today);
  assert.equal(f("confirmed", "2026-11-01"), "upcoming");
  assert.equal(f("hold", "2026-10-23"), "upcoming");
  assert.equal(f("played", "2026-10-01"), "played");
  assert.equal(f("confirmed", "2026-10-01"), "played");
  assert.equal(f("canceled", "2026-11-01"), "canceled");
  assert.equal(f("hold", "2026-10-22"), "dropped");
  assert.equal(f("dropped", "2026-11-01"), "dropped");
  assert.equal(f("dropped", "2026-10-01"), "dropped");
});

test("showTabFor: a member sees only the past shows they played, and no canceled or dropped", () => {
  const today = "2026-10-23";
  const show = (status: "hold" | "confirmed" | "played" | "canceled" | "dropped", date: string, personnel: string[]) => ({ id: "x", status, date, personnel });
  const david = { musicianId: "m-david" };
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-david"]), today, david), "played");
  assert.equal(showTabFor(show("confirmed", "2026-10-01", ["m-david"]), today, david), "played");
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-eric"]), today, david), null);
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-eric"]), today, {}), null, "no musician: no past shows");
  assert.equal(showTabFor(show("confirmed", "2026-11-01", ["m-eric"]), today, david), "upcoming", "upcoming shows are all listed");
  assert.equal(showTabFor(show("canceled", "2026-11-01", ["m-david"]), today, david), null);
  assert.equal(showTabFor(show("dropped", "2026-11-01", ["m-david"]), today, david), null);
  assert.equal(showTabFor(show("hold", "2026-10-01", ["m-david"]), today, david), null);
  assert.equal(showTabFor(show("played", "2026-10-01", ["m-eric"]), today, null), "played", "admins see every show");
  assert.equal(showTabFor(show("canceled", "2026-11-01", []), today, null), "canceled");
});

test("cancel and drop: status and reason in one write (blank = no reason); update clears it; listings come off", async () => {
  const a = await create({ publishToBandsintown: true, status: "confirmed" });
  await cmd("shows.cancel", { id: a.id, reason: "  They double-booked the patio.  " });
  let s = (await db.get("shows", a.id))!;
  assert.equal(s.status, "canceled"); assert.equal(s.reason, "They double-booked the patio.");
  const h = await db.history("shows", a.id, 5);
  const write = h.find((e) => e.diff.status)!;
  assert.ok(write.diff.reason, "status and reason are one history entry");
  assert.deepEqual(s.listings, {});
  const b = await create({ date: "2027-02-01" });
  await cmd("shows.drop", { id: b.id, reason: "   " });
  s = (await db.get("shows", b.id))!;
  assert.equal(s.status, "dropped"); assert.equal(s.reason, undefined);
  await cmd("shows.drop", { id: b.id, reason: "The money's not there." });
  assert.equal((await db.get("shows", b.id))!.reason, "The money's not there.");
  await cmd("shows.update", { id: b.id, patch: { status: "hold" } }); // bring back as a hold keeps the reason
  assert.equal((await db.get("shows", b.id))!.reason, "The money's not there.");
  await cmd("shows.update", { id: b.id, patch: { reason: null } });
  assert.equal((await db.get("shows", b.id))!.reason, undefined);
  assert.deepEqual(registry["shows.drop"].roles, ["admin", "mcp"]);
});

test("shows.list rows carry the reason; afterShow refuses a dropped show", async () => {
  const a = await create({ date: "2026-10-10" });
  await cmd("shows.drop", { id: a.id, reason: "Van broke down" });
  const r = await cmd("shows.list", { filter: "dropped" });
  assert.equal(r.shows.find((x: { id: string }) => x.id === a.id).reason, "Van broke down");
  await assert.rejects(cmd("shows.afterShow", { id: a.id, show: 3, venue: 3 }), /dropped/);
});

test("house concert: no venue, hosts + place; name, kind and band-PA default; validation", async () => {
  const host = (await cmd("contacts.create", { name: "Jennifer Okafor", emails: ["jen@example.com"], phones: [] })).id;
  const co = (await cmd("contacts.create", { name: "Tom Okafor", emails: [], phones: [] })).id;
  const r = await cmd("shows.create", { date: "2027-03-06", hostContactIds: [host, co], place: { city: "Longmont", address: "12 Pine St" }, billedAs: "duo" });
  const s = (await db.get("shows", r.id))!;
  assert.equal(s.kind, "house");
  assert.equal(s.venue, undefined);
  assert.deepEqual(s.place, { city: "Longmont", address: "12 Pine St" });
  assert.deepEqual(s.hostContactIds, [host, co]);
  assert.equal(s.hostName, "Jennifer Okafor & Tom Okafor");
  assert.equal(s.sound.provider, "bandProvided", "house concerts default to our PA");
  assert.deepEqual((await db.get("showDeals", r.id))!.contactIds, [host, co], "the deal's contacts are the hosts");
  await useBandCalendar();
  const ev = (await cmd("shows.calendarPreview", { id: r.id })).event;
  assert.match(ev.title, /at House concert · Jennifer Okafor & Tom Okafor$/);
  assert.equal(ev.location, "12 Pine St");

  await assert.rejects(cmd("shows.create", { date: "2027-03-07", hostContactIds: [host] }), /venue TBD\), or give the city/);
  await assert.rejects(cmd("shows.create", { date: "2027-03-07", hostContactIds: ["nope"], place: { city: "Lyons" } }), /Host contact not found/);
});

test("house concert: renaming a host updates the show; Bandsintown never sees the host or address", async () => {
  const host = (await cmd("contacts.create", { name: "Pat", emails: [], phones: [] })).id;
  const r = await cmd("shows.create", { date: "2027-04-10", hostContactIds: [host], place: { city: "Longmont", address: "1 Elm" }, publishToBandsintown: true });
  await cmd("contacts.update", { id: host, patch: { name: "Pat Example" } });
  assert.equal((await db.get("shows", r.id))!.hostName, "Pat Example");
  const [ev] = await bandsintownClient().list();
  assert.equal(ev.venueName, "House concert");
  assert.equal(ev.city, "Longmont");
  assert.doesNotMatch(JSON.stringify(ev), /Pat|Elm/);
});

test("switching a show between a venue and a house; it always keeps a place", async () => {
  const host = (await cmd("contacts.create", { name: "Polly", emails: [], phones: [] })).id;
  const r = await create({});
  await assert.rejects(cmd("shows.update", { id: r.id, patch: { venueId: null } }), /venue TBD\), or give the city/);
  await cmd("shows.update", { id: r.id, patch: { venueId: null, kind: "house", place: { city: "Gunbarrel" }, hostContactIds: [host] } });
  let s = (await db.get("shows", r.id))!;
  assert.equal(s.venue, undefined);
  assert.equal(s.hostName, "Polly");
  await cmd("shows.update", { id: r.id, patch: { venueId, place: null, hostContactIds: [], kind: "venue" } });
  s = (await db.get("shows", r.id))!;
  assert.equal(s.venue.name, "Hi-Dive");
  assert.equal(s.place, undefined);
  assert.equal(s.hostContactIds, undefined);
  assert.equal(s.hostName, undefined);
});

test("festival link: editionId sets editionName and kind, follows a rename, and can be unlinked", async () => {
  const f = (await db.create(ctx, "festivals", { name: "FoCoMX", type: "festival", region: "north", contactIds: [] })).id;
  const e = (await db.create(ctx, "editions", { festivalId: f, festivalName: "FoCoMX", year: 2027, label: "2027", venueIds: [] })).id;
  const r = await create({ editionId: e });
  let s = (await db.get("shows", r.id))!;
  assert.equal(s.kind, "festival");
  assert.equal(s.editionId, e);
  assert.equal(s.editionName, "FoCoMX 2027");
  assert.equal((await db.get("showDeals", r.id))!.editionId, e);
  await db.update(ctx, "festivals", f, { name: "FoCoMX Fest" });
  assert.equal((await db.get("shows", r.id))!.editionName, "FoCoMX Fest 2027");
  await cmd("shows.update", { id: r.id, patch: { editionId: null } });
  s = (await db.get("shows", r.id))!;
  assert.equal(s.editionId, undefined);
  assert.equal(s.editionName, undefined);
});

test("showName / publicShowName / showCity", () => {
  assert.equal(showName({ venue: { id: "v", name: "Hi-Dive", city: "Denver" } }), "Hi-Dive");
  assert.equal(showName({ kind: "house", hostName: "Mary", place: { city: "Boulder" } }), "House concert · Mary");
  assert.equal(showName({ kind: "house", place: { city: "Boulder" } }), "House concert");
  assert.equal(showName({ kind: "festival", editionName: "Hygiene Festival 2025", place: { city: "Hygiene" } }), "Hygiene Festival 2025");
  assert.equal(publicShowName({ kind: "house", hostName: "Mary", place: { city: "Boulder" } }), "House concert");
  assert.equal(showCity({ kind: "house", place: { city: "Boulder" } }), "Boulder");
});

test("Booked it once per chosen pitch date: each show links to the pitch, the pitch is booked once", async () => {
  await cmd("pitches.update", { id: pitchId, patch: { dates: ["2027-01-16", "2027-01-17"] } });
  const a = await create({ date: "2027-01-16" });
  const b = await create({ date: "2027-01-17" });
  const pitch = (await db.get("pitches", pitchId))!;
  assert.deepEqual(pitch.showIds, [a.id, b.id]);
  assert.equal(pitch.status, "booked");
  assert.equal((await db.list(`pitches/${pitchId}/activity`)).filter((x) => x.toStatus === "booked").length, 1);
  assert.deepEqual([(await db.get("shows", a.id))!.date, (await db.get("shows", b.id))!.date], ["2027-01-16", "2027-01-17"]);
});

test("Booked it can carry the pitch's comments onto the show, keeping each one's author and time; off by default", async () => {
  const other = await makeUser("ingrid@example.com", "admin", { name: "Ingrid" });
  await cmd("pitches.comment", { id: pitchId, body: "first" }, { ...ctx, uid: other.uid });
  await new Promise((r) => setTimeout(r, 20));
  await cmd("pitches.comment", { id: pitchId, body: "second" });
  const before = await db.list(`pitches/${pitchId}/comments`);

  const plain = await create({ date: "2027-01-16" });
  assert.deepEqual(await db.list(`shows/${plain.id}/comments`), [], "not copied unless asked");

  const withC = await create({ date: "2027-01-17", copyPitchComments: true });
  const copied = (await db.list(`shows/${withC.id}/comments`)).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  assert.deepEqual(copied.map((c) => c.body), ["first", "second"]);
  assert.deepEqual(copied.map((c) => c.authorId), [other.uid, ctx.uid]);
  const orig = before.sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  assert.deepEqual(copied.map((c) => c.createdAt.toMillis()), orig.map((c) => c.createdAt.toMillis()));
  assert.deepEqual(copied.map((c) => c.createdBy), orig.map((c) => c.createdBy));
  assert.equal((await db.list(`pitches/${pitchId}/comments`)).length, 2, "the pitch keeps its own");
  const hist = await db.list(`shows/${withC.id}/comments/${copied[0].id}/history`);
  assert.equal(hist.length, 1, "the copy has its own history");
});

test("copyPitchComments needs a pitch", async () => {
  await assert.rejects(cmd("shows.create", { date: "2027-01-16", venueId, copyPitchComments: true }), /pitchId/);
});

test("billedAs null is an explicit 'not sure': no configuration, no personnel; omitted still falls back to the pitch's", async () => {
  const none = await create({ billedAs: null });
  const a = (await db.get("shows", none.id))!;
  assert.equal(a.billedAs, undefined);
  assert.deepEqual(a.personnel, []);
  const fallback = await create({ date: "2027-02-20" });
  assert.equal((await db.get("shows", fallback.id))!.billedAs, "trio");
});

test("sendInvites: only configuration members who are on the team; unticked invites nobody, and later syncs keep it", async () => {
  // Ingrid and Jeff are on the team (linked by user.musicianId); David has an email but no login; Sam has neither
  await makeUser("ingrid@example.com", "member", { musicianId: ids.ingrid, name: "Ingrid" });
  await db.update(ctx, "musicians", ids.jeff, { userId: ctx.uid });
  await useBandCalendar();
  const emails = async (showId: string) => {
    await cmd("shows.calendar", { id: showId, on: true });
    const ev = await calendarClient().get((await db.get("shows", showId))!.calendarEventId);
    return ev.attendees.map((x) => x.email).sort();
  };
  const on = await create({ sendInvites: true });
  assert.deepEqual(await emails(on.id), ["ingrid@example.com", "jeff@example.com"]);
  assert.deepEqual((await db.get("shows", on.id))!.calendarInviteeIds, [ids.ingrid, ids.jeff]);

  const off = await create({ date: "2027-03-20", sendInvites: false });
  assert.deepEqual(await emails(off.id), []);
  await cmd("shows.update", { id: off.id, patch: { dayOfContact: { name: "Sam" } } });
  assert.deepEqual(await emails(off.id), [], "a later sync still invites nobody");

  const notSure = await create({ date: "2027-04-20", billedAs: null, sendInvites: true });
  assert.deepEqual(await emails(notSure.id), []);
});

test("retargetAskMessage: a typed ask message swaps the dates it was typed with for the new ones; null once they were rewritten", () => {
  assert.equal(retargetAskMessage("Hey all, show on [date]?", [], ["2027-03-06"]), "Hey all, show on Sat, Mar 6?");
  assert.equal(retargetAskMessage("Hey all, show on Sat, Mar 6?", ["2027-03-06"], ["2027-03-06", "2027-03-12"]), "Hey all, show on Sat, Mar 6 or Fri, Mar 12?");
  assert.equal(retargetAskMessage("Show on Sat, Mar 6 or Fri, Mar 12!", ["2027-03-06", "2027-03-12"], ["2027-03-12"]), "Show on Fri, Mar 12!");
  assert.equal(retargetAskMessage("Show on $& [date]", [], ["2027-03-06"]), "Show on $& Sat, Mar 6");
  assert.equal(retargetAskMessage("Show early March?", ["2027-03-06"], ["2027-03-12"]), null);
  assert.equal(retargetAskMessage("Show early March?", ["2027-03-06"], ["2027-03-06"]), "Show early March?");
});

test("day-of contacts: a new show takes the venue's first one; picking someone on a show makes them one at the venue", async () => {
  const sam = (await cmd("contacts.create", { name: "Sam Ruiz", emails: [], phones: ["+13035550117"] })).id;
  const kim = (await cmd("contacts.create", { name: "Kim", emails: [], attachTo: { kind: "venues", id: venueId } })).id;
  await cmd("contacts.setRoles", { contactId: kim, venueId, roles: ["booking"] });
  await cmd("contacts.setRoles", { contactId: sam, venueId, roles: ["dayOf"] });
  const r = await create();
  assert.deepEqual((await db.get("shows", r.id))!.dayOfContact, { name: "Sam Ruiz", phone: "(303) 555-0117", contactId: sam });
  const typed = await create({ date: "2027-02-01", dayOfContact: { name: "Lee" } });
  assert.deepEqual((await db.get("shows", typed.id))!.dayOfContact, { name: "Lee" }, "a given day-of contact wins");
  await cmd("shows.update", { id: r.id, patch: { dayOfContact: { name: "Kim", contactId: kim } } });
  const n = (await db.get("venueNotes", `${TEST_ARTIST}__${venueId}`))!;
  assert.deepEqual([n.bookingContactIds, n.dayOfContactIds], [[kim], [sam, kim]], "Kim keeps Booking and is now Day-of too");
});
