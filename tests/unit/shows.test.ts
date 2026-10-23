import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { calendarClient, bandsintownClient, gmailClient } from "@/server/integrations";
import { answerByToken, viewByToken } from "@/server/availability";
import { buildChecklist, buildGear, planHome, DEFAULT_CHECKLIST_TEMPLATES, addDays, fmtTime } from "@/lib/shows";
import { resetEmulators, makeUser, venue } from "./helpers";

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
    name: "Ingrid Avison Band", driveFolderId: "", links: {},
    soundGear: { bandProvided: [{ label: "PA speakers", musicianId: ids.jeff }], venueProvided: [{ label: "In-ear rack", musicianId: ids.jeff }] },
    configurations: [
      { id: "trio", name: "Trio", billingName: "Ingrid Avison Trio", musicianIds: [ids.ingrid, ids.jeff, ids.david], gear: [{ label: "Keys rig", musicianId: ids.jeff }, { label: "Bass rig", musicianId: ids.david }] },
      { id: "duo", name: "Duo", billingName: "Ingrid Avison Duo", musicianIds: [ids.ingrid, ids.jeff], gear: [{ label: "Keys rig", musicianId: ids.jeff }] },
    ],
  })).id;
  venueId = (await cmd("venues.create", venue("Hi-Dive", "Denver", { address: { street: "7 S Broadway", city: "Denver", state: "CO" }, sound: { provider: "venueProvided", notes: "House engineer" } }))).id;
  for (const t of DEFAULT_CHECKLIST_TEMPLATES) await db.create(sys, "checklistTemplates", { ...t });
  pitchId = (await cmd("pitches.flag", { kind: "venue", id: venueId, pitchedAs: "trio" })).id;
  mctx = { uid: "m-david", role: "member", musicianId: ids.david, via: "app", runId: newRunId() };
});

const create = (extra: Record<string, unknown> = {}) =>
  cmd("shows.create", { pitchId, date: "2027-01-16", venueId, times: { loadIn: "18:00", set: "20:00", setLength: 40 }, needs: { poster: true, backline: false, merch: true }, ...extra });

test("pure: checklist from templates, gear from configuration + sound, home plan", () => {
  let n = 0;
  const id = () => `i${n++}`;
  const items = buildChecklist(DEFAULT_CHECKLIST_TEMPLATES, { date: "2027-01-16", sound: { provider: "bandProvided" }, needs: { poster: true, backline: false, merch: false } }, id);
  const labels = items.map((i) => i.label);
  assert.ok(labels.includes("Book sound engineer") && labels.includes("Post the poster"));
  assert.ok(!labels.includes("Pack merch table") && !labels.includes("Send stage plot and input list to the venue"));
  assert.equal(items.find((i) => i.label === "Post the poster")!.due, "2027-01-02");
  assert.deepEqual(items.map((i) => i.due), [...items.map((i) => i.due)].sort());
  assert.equal(addDays("2027-03-01", -1), "2027-02-28");
  assert.equal(fmtTime("19:05"), "7:05 pm");
  const art = { configurations: [{ id: "c", name: "C", billingName: "C", musicianIds: [], gear: [{ label: "Keys", musicianId: "m1" }] }], soundGear: { bandProvided: [{ label: "PA" }], venueProvided: [{ label: "IEM" }] } };
  assert.deepEqual(buildGear(art, "c", "bandProvided", id).map((g) => g.label), ["Keys", "PA"]);
  assert.deepEqual(buildGear(art, "c", "venueProvided", id).map((g) => g.label), ["Keys", "IEM"]);
  assert.deepEqual(buildGear(art, undefined, "venueProvided", id).map((g) => g.label), ["IEM"]);

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

test("Booked it: show + showDeal in one go, pitch linked and booked, checklist, gear, personnel, calendar", async () => {
  const r = await create({ deal: { deal: "guarantee", guarantee: 30000 } });
  const show = (await db.get("shows", r.id))!;
  const deal = (await db.get("showDeals", r.id))!;
  assert.equal(deal.pitchId, pitchId);
  assert.equal(deal.guarantee, 30000);
  assert.equal(deal.settled, false);
  assert.equal(show.billedAs, "trio");
  assert.deepEqual(show.personnel, [ids.ingrid, ids.jeff, ids.david]);
  assert.deepEqual(show.sound, { provider: "venueProvided", notes: "House engineer" });
  assert.equal(show.venue.address, "7 S Broadway, Denver");
  const labels = show.checklist.map((c: any) => c.label);
  assert.ok(labels.includes("Post the poster") && labels.includes("Pack merch table") && labels.includes("Send stage plot and input list to the venue"));
  assert.ok(!labels.includes("Book sound engineer"));
  assert.equal(show.checklist.find((c: any) => c.label === "Pack merch table").due, "2027-01-14");
  assert.deepEqual(show.gear.map((g: any) => g.label).sort(), ["Bass rig", "In-ear rack", "Keys rig"]);
  assert.ok(show.gear.every((g: any) => g.packed === false));
  const pitch = (await db.get("pitches", pitchId))!;
  assert.deepEqual(pitch.showIds, [r.id]);
  assert.equal(pitch.status, "booked");
  const act = await db.list(`pitches/${pitchId}/activity`);
  assert.ok(act.some((a) => a.toStatus === "booked"));

  // calendar event for everyone playing (Ingrid, Jeff, David have emails)
  const ev = await calendarClient().get(show.calendarEventId);
  assert.deepEqual(ev.attendees.map((a) => a.email).sort(), ["david@example.com", "ingrid@example.com", "jeff@example.com"]);
  assert.equal(ev.start, "2027-01-16T18:00:00");
  assert.equal(ev.end, "2027-01-16T20:40:00");
  assert.match(ev.title, /Ingrid Avison Trio at Hi-Dive/);
});

test("Booked it validates and rolls back whole when the venue is missing", async () => {
  await assert.rejects(cmd("shows.create", { pitchId, date: "2027-01-16", venueId: "nope" }));
  assert.equal((await db.list("shows")).length, 0);
  assert.equal((await db.list("showDeals")).length, 0);
  assert.equal((await db.get("pitches", pitchId))!.status, "toPitch");
});

test("billed as fills personnel and gear; sound change rebuilds gear; both stay editable", async () => {
  const r = await create({ billedAs: "duo", sound: { provider: "bandProvided" } });
  let show = (await db.get("shows", r.id))!;
  assert.deepEqual(show.personnel, [ids.ingrid, ids.jeff]);
  assert.deepEqual(show.gear.map((g: any) => g.label).sort(), ["Keys rig", "PA speakers"]);
  await cmd("shows.packGear", { id: r.id, itemId: show.gear[0].id, packed: true });
  await cmd("shows.update", { id: r.id, patch: { billedAs: "trio" } });
  show = (await db.get("shows", r.id))!;
  assert.deepEqual(show.personnel, [ids.ingrid, ids.jeff, ids.david]);
  assert.deepEqual(show.gear.map((g: any) => g.label).sort(), ["Bass rig", "Keys rig", "PA speakers"]);
  assert.equal(show.gear.find((g: any) => g.label === show.gear[0].label).packed, show.gear[0].packed);
  // editable: personnel override, then sound change rebuilds gear and adds sound-engineer checklist item
  await cmd("shows.update", { id: r.id, patch: { personnel: [ids.ingrid], sound: { provider: "venueProvided" }, rebuildGear: true } });
  show = (await db.get("shows", r.id))!;
  assert.deepEqual(show.personnel, [ids.ingrid]);
  assert.ok(show.gear.some((g: any) => g.label === "In-ear rack") && !show.gear.some((g: any) => g.label === "PA speakers"));
  await cmd("shows.setGear", { id: r.id, gear: [...show.gear, { label: "Tuner" }] });
  assert.ok((await db.get("shows", r.id))!.gear.some((g: any) => g.label === "Tuner" && g.id));
  await assert.rejects(cmd("shows.update", { id: r.id, patch: { billedAs: "nope" } }), /No configuration/);
});

test("checklist: check off, edit, owner; template merge adds only missing items; date change shifts open dues", async () => {
  const r = await create();
  let show = (await db.get("shows", r.id))!;
  const list = show.checklist.map((c: any, i: number) => (i === 0 ? { ...c, done: true, ownerId: ids.jeff, label: "Confirm times (done)" } : c));
  await cmd("shows.setChecklist", { id: r.id, checklist: list });
  show = (await db.get("shows", r.id))!;
  assert.equal(show.checklist[0].done, true);
  assert.equal(show.checklist[0].ownerId, ids.jeff);
  const openItem = show.checklist.find((c: any) => c.label === "Post the poster");
  await cmd("shows.update", { id: r.id, patch: { needs: { poster: true, backline: true, merch: true } } });
  show = (await db.get("shows", r.id))!;
  assert.ok(show.checklist.some((c: any) => c.label === "Confirm backline with the venue"));
  assert.equal(show.checklist.filter((c: any) => c.label === "Post the poster").length, 1);
  await cmd("shows.update", { id: r.id, patch: { date: "2027-01-23" } });
  show = (await db.get("shows", r.id))!;
  assert.equal(show.checklist.find((c: any) => c.label === "Post the poster").due, addDays(openItem.due, 7));
  assert.equal(show.checklist[0].due, list[0].due, "done items keep their date");
});

test("members can pack only their own gear", async () => {
  const r = await create();
  const show = (await db.get("shows", r.id))!;
  const mine = show.gear.find((g: any) => g.musicianId === ids.david);
  const notMine = show.gear.find((g: any) => g.musicianId === ids.jeff);
  await cmd("shows.packGear", { id: r.id, itemId: mine.id, packed: true }, mctx);
  assert.equal((await db.get("shows", r.id))!.gear.find((g: any) => g.id === mine.id).packed, true);
  await assert.rejects(cmd("shows.packGear", { id: r.id, itemId: notMine.id, packed: true }, mctx), /your own gear/);
  assert.ok(!registry["shows.update"].roles.includes("member"));
  assert.ok(!registry["shows.setChecklist"].roles.includes("member"));
  assert.ok(!registry["shows.afterShow"].roles.includes("member"));
});

test("Bandsintown: public + confirmed lists it; holds and private stay off; changes update; cancel removes", async () => {
  const hold = await create({ status: "hold", public: true, addToCalendar: false });
  assert.equal((await db.get("shows", hold.id))!.listings.bandsintown, undefined);
  const priv = await create({ date: "2027-02-06", public: false });
  assert.equal((await db.get("shows", priv.id))!.listings.bandsintown, undefined);
  assert.equal((await bandsintownClient().list()).length, 0);

  const r = await create({ date: "2027-02-13", public: true, ticketUrl: "https://tix.example/1", times: { set: "21:15", setLength: 45 } });
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
  await cmd("shows.update", { id: r.id, patch: { date: "2027-02-14", times: { set: "20:30", setLength: 45 } } });
  events = (await bandsintownClient().list()).filter((e) => e.id === bit.eventId);
  assert.equal(events[0].datetime, "2027-02-14T20:30:00");
  assert.equal((await bandsintownClient().list()).length, 2);

  // going private removes it
  await cmd("shows.update", { id: hold.id, patch: { public: false } });
  assert.equal((await db.get("shows", hold.id))!.listings.bandsintown, undefined);
  assert.equal((await bandsintownClient().list()).length, 1);

  // cancel removes it and the calendar event
  show = (await db.get("shows", r.id))!;
  const calId = show.calendarEventId;
  assert.ok(calId);
  await cmd("shows.cancel", { id: r.id });
  show = (await db.get("shows", r.id))!;
  assert.equal(show.status, "canceled");
  assert.equal(show.listings.bandsintown, undefined);
  assert.equal(show.calendarEventId, undefined);
  assert.equal((await bandsintownClient().list()).length, 0);
  assert.equal((await calendarClient().list()).find((e) => e.id === calId), undefined);
});

test("Bandsintown failure is recorded on the show, not thrown; retry works", async () => {
  const good = process.env.BANDSINTOWN_BASE_URL;
  process.env.BANDSINTOWN_BASE_URL = "http://127.0.0.1:1";
  const r = await create({ public: true });
  assert.ok(r.warnings.some((w: string) => w.startsWith("Bandsintown")));
  const bad = (await db.get("shows", r.id))!.listings.bandsintown;
  assert.equal(bad.state, "error");
  assert.ok(bad.error);
  process.env.BANDSINTOWN_BASE_URL = good;
  await cmd("shows.sync", { id: r.id });
  assert.equal((await db.get("shows", r.id))!.listings.bandsintown.state, "listed");
});

test("Calendar: update on change, delete on cancel, optional on create, toggle from the show", async () => {
  const none = await create({ addToCalendar: false });
  assert.equal((await db.get("shows", none.id))!.calendarEventId, undefined);
  await cmd("shows.update", { id: none.id, patch: { date: "2027-03-01" } });
  assert.equal((await db.get("shows", none.id))!.calendarEventId, undefined, "no event is created behind your back");
  await cmd("shows.calendar", { id: none.id, on: true });
  const evId = (await db.get("shows", none.id))!.calendarEventId;
  assert.ok(evId);
  await cmd("shows.update", { id: none.id, patch: { times: { loadIn: "17:00", set: "19:30", setLength: 60 }, personnel: [ids.ingrid] } });
  const ev = await calendarClient().get(evId);
  assert.equal(ev.start, "2027-03-01T17:00:00");
  assert.equal(ev.end, "2027-03-01T20:30:00");
  assert.equal(ev.timeZone, "America/Denver");
  assert.deepEqual(ev.attendees.map((a) => a.email), ["ingrid@example.com"]);
  await cmd("shows.calendar", { id: none.id, on: false });
  assert.equal((await calendarClient().list()).length, 0);
  assert.equal((await db.get("shows", none.id))!.calendarEventId, undefined);
});

test("After the show: ratings, paid attendance, played; money stays unsettled; future shows refused", async () => {
  const past = await create({ date: "2026-10-10" });
  await cmd("shows.afterShow", { id: past.id, show: 4, venue: 5, crowd: 60, notes: "Great room", paidAttendance: 58 });
  const show = (await db.get("shows", past.id))!;
  const deal = (await db.get("showDeals", past.id))!;
  assert.equal(show.status, "played");
  assert.deepEqual(deal.rating, { show: 4, venue: 5, crowd: 60, notes: "Great room" });
  assert.equal(deal.paidAttendance, 58);
  assert.equal(deal.settled, false);
  const future = await create({ date: "2030-01-01" });
  await assert.rejects(cmd("shows.afterShow", { id: future.id, show: 3, venue: 3 }), /hasn't happened/);
  await assert.rejects(cmd("shows.afterShow", { id: past.id, show: 6, venue: 3 }));
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

test("booking a pitch with an open ask links the ask to the show", async () => {
  const a = await cmd("availability.ask", { pitchId, date: "2027-01-16", musicianIds: [ids.ingrid] });
  const s = await create();
  assert.equal((await db.get("availability", a.id))!.showId, s.id);
});

test("shows.remove archives the show and its deal and clears the listings", async () => {
  const r = await create({ public: true });
  assert.equal((await bandsintownClient().list()).length, 1);
  await cmd("shows.remove", { id: r.id });
  assert.equal(await db.list("shows").then((l) => l.length), 0);
  assert.equal((await bandsintownClient().list()).length, 0);
  assert.equal((await calendarClient().list()).length, 0);
});
