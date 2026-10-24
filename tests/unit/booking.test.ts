import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { dispatch } from "@/server/commands/dispatch";
import { db } from "@/server/db";
import { newRunId, type Ctx } from "@/server/ctx";
import { gmailClient } from "@/server/integrations";
import { fillTemplate, unfilledFields, buildTemplateContext, buildSearchItems, searchItems, appsOpenThisMonth, upcomingDeadlines } from "@/lib/booking";
import { firestore } from "@/server/admin";
import { migratePitchedAs } from "../../scripts/migrate-pitched-as";
import { resetEmulators, makeUser, venue, TEST_ARTIST } from "./helpers";

let stop: () => Promise<void>;
let dir: string;
let ctx: Ctx;
let uid: string;
let token: string;
let mids: string[];
let artistId: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  process.env.GMAIL_BASE_URL = s.running["fake-gmail"].url;
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

beforeEach(async () => {
  await resetEmulators();
  const u = await makeUser("jeff@example.com", "admin", { name: "Jeff Smith" });
  uid = u.uid; token = u.token;
  ctx = { uid, role: "admin", via: "app", runId: newRunId() };
  mids = [];
  for (const n of ["Ingrid", "Jeff", "David"]) mids.push((await db.create(ctx, "musicians", { name: n, instruments: [], active: true })).id);
  artistId = (await db.create(ctx, "artists", {
    slug: "ingrid-avison-band", name: "Ingrid Avison Band", driveFolderId: "", links: { website: "https://band.example" },
    configurations: [
      { id: "trio", name: "Trio", billingName: "Trio", musicianIds: mids },
      { id: "duo", name: "Duo", billingName: "Duo", musicianIds: mids.slice(0, 2) },
    ],
  }, { id: TEST_ARTIST })).id;
});

const cmd = async (name: string, input: unknown, c: Ctx = ctx) => {
  const x = registry[name];
  return (await x.run(c, x.input.parse(input))) as Record<string, any>;
};

test("pure helpers: fill, unfilled, context, search, application dates", () => {
  assert.equal(fillTemplate("Hi {{contact.firstName}} at {{ venue.name }} {{nope}}", { "contact.firstName": "Haylee", "venue.name": "Lost Lake" }), "Hi Haylee at Lost Lake {{nope}}");
  assert.deepEqual(unfilledFields("{{a}} {{b.c}} {{a}}"), ["a", "b.c"]);
  const c = buildTemplateContext({ target: { kind: "venue", name: "Lost Lake" }, contact: { name: "Haylee Jackson" }, user: { name: "Jeff Smith" } });
  assert.equal(c["venue.name"], "Lost Lake");
  assert.equal(c["contact.firstName"], "Haylee");
  assert.equal(c["user.firstName"], "Jeff");
  const items = buildSearchItems({
    venues: [{ id: "v1", name: "Lost Lake", address: { city: "Denver" }, contactIds: ["c1"] }, { id: "v2", name: "Fox", address: { city: "Boulder" }, contactIds: [] }],
    promoters: [], festivals: [], contacts: [{ id: "c1", name: "Haylee Jackson", emails: ["h@x.com"] }],
  });
  assert.deepEqual(searchItems(items, "denver").map((i) => i.id), ["v1"]);
  assert.deepEqual(searchItems(items, "haylee").map((i) => i.id).sort(), ["c1", "v1"]);
  assert.equal(searchItems(items, "boulder fox").length, 1);
  const eds = [
    { id: "a", appOpens: { date: "2026-10-30" }, appDeadline: { date: "2027-01-15" } },
    { id: "b", appOpens: { date: "2026-12-01" } }, { id: "c", appOpens: { date: "2026-09-01" }, appDeadline: { date: "2026-10-01" } },
    { id: "d", appOpens: { date: "2026-09-01" }, appDeadline: { date: "2026-11-01" } },
  ];
  assert.deepEqual(appsOpenThisMonth(eds, "2026-10-23").map((e) => e.id), ["a", "d"]);
  assert.deepEqual(upcomingDeadlines(eds, "2026-10-23", 30).map((e) => e.id), ["d"]);
});

test("dedupe: venue, promoter, festival and contact creates merge instead of duplicating", async () => {
  const a = await cmd("venues.create", venue("Lost Lake Lounge"));
  const b = await cmd("venues.create", venue("lost lake lounge", "Denver", { capacity: 300 }));
  assert.equal(b.merged, true);
  assert.equal(b.id, a.id);
  assert.equal((await db.get("venues", a.id))!.capacity, 300);
  assert.equal((await db.list("venues")).length, 1);
  assert.notEqual((await cmd("venues.create", venue("Lost Lake Lounge", "Boulder"))).id, a.id);

  const p1 = await cmd("promoters.create", { name: "Front Range Presents", kind: "promoter" });
  assert.equal((await cmd("promoters.create", { name: "Front-Range Presents", kind: "promoter", website: "https://x.example" })).id, p1.id);
  const f1 = await cmd("festivals.create", { name: "UMS", type: "festival", region: "denver" });
  assert.equal((await cmd("festivals.create", { name: "ums", type: "festival", region: "denver" })).merged, true);
  assert.ok(f1.id);
  const c1 = await cmd("contacts.create", { name: "Haylee", emails: ["Haylee@x.com"] });
  const c2 = await cmd("contacts.create", { name: "Haylee J", emails: ["haylee@x.com"], phones: ["303-555-0101"] });
  assert.equal(c2.id, c1.id);
  assert.deepEqual((await db.get("contacts", c1.id))!.phones, ["+13035550101"]);
  const hist = await db.listGroup("history", (q) => q.where("entity.id", "==", c1.id));
  assert.ok(hist.some((h) => h.op === "merge"));
});

test("contacts attach to places, detach, and archive unlinks", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const c = await cmd("contacts.create", { name: "Haylee", emails: ["h@x.com"], attachTo: { kind: "venues", id: v.id } });
  assert.deepEqual((await db.get("venues", v.id))!.contactIds, [c.id]);
  await cmd("contacts.detach", { contactId: c.id, kind: "venues", id: v.id });
  assert.deepEqual((await db.get("venues", v.id))!.contactIds, []);
  await cmd("contacts.attach", { contactId: c.id, kind: "venues", id: v.id });
  await cmd("contacts.remove", { id: c.id });
  assert.deepEqual((await db.get("venues", v.id))!.contactIds, []);
});

test("venue promoter links stay in sync both ways", async () => {
  const p = await cmd("promoters.create", { name: "Promo", kind: "promoter" });
  const v = await cmd("venues.create", venue("Room", "Denver", { promoterIds: [p.id] }));
  assert.deepEqual((await db.get("promoters", p.id))!.venueIds, [v.id]);
  await cmd("venues.update", { id: v.id, patch: { promoterIds: [] } });
  assert.deepEqual((await db.get("promoters", p.id))!.venueIds, []);
});

test("renames keep denormalized names in sync (venue -> pitch, festival -> edition -> pitch)", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const pv = await cmd("pitches.flag", { kind: "venue", id: v.id });
  const f = await cmd("festivals.create", { name: "UMS", type: "festival", region: "denver" });
  const e = await cmd("editions.create", { festivalId: f.id, year: 2027, label: "2027" });
  assert.equal((await db.get("editions", e.id))!.festivalName, "UMS");
  const pe = await cmd("pitches.flag", { kind: "edition", id: e.id });
  assert.equal((await db.get("pitches", pe.id))!.target.name, "UMS 2027");
  await cmd("venues.update", { id: v.id, patch: { name: "Lost Lake Lounge" } });
  assert.equal((await db.get("pitches", pv.id))!.target.name, "Lost Lake Lounge");
  await cmd("festivals.update", { id: f.id, patch: { name: "Underground Music Showcase" } });
  assert.equal((await db.get("editions", e.id))!.festivalName, "Underground Music Showcase");
  assert.equal((await db.get("pitches", pe.id))!.target.name, "Underground Music Showcase 2027");
  await cmd("editions.update", { id: e.id, patch: { label: "Summer 2027" } });
  assert.equal((await db.get("pitches", pe.id))!.target.name, "Underground Music Showcase Summer 2027");
});

test("flag: adds to the Pitch List once, fills personnel from the configuration", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const a = await cmd("pitches.flag", { kind: "venue", id: v.id });
  assert.equal(a.existing, false);
  const p = (await db.get("pitches", a.id))!;
  assert.equal(p.status, "toPitch");
  assert.equal(p.assigneeId, uid);
  assert.equal(p.artistId, artistId);
  assert.deepEqual(p.personnel, []);
  assert.equal((await cmd("pitches.flag", { kind: "venue", id: v.id })).existing, true);
  assert.equal((await db.list("pitches")).length, 1);
  const b = await cmd("pitches.flag", { kind: "venue", id: (await cmd("venues.create", venue("Fox", "Boulder"))).id, pitchedAs: "duo" });
  assert.deepEqual((await db.get("pitches", b.id))!.personnel, mids.slice(0, 2));
  const acts = await db.list(`pitches/${a.id}/activity`);
  assert.equal(acts[0].text, "Added to Pitch List");
  await assert.rejects(cmd("pitches.flag", { kind: "venue", id: "nope" }), /not found/);
  // after a decline the same place can be flagged again
  await cmd("pitches.move", { id: a.id, status: "declined" });
  assert.equal((await cmd("pitches.flag", { kind: "venue", id: v.id })).existing, false);
});

test("pitch edits: configuration fills personnel but stays editable; next step, assignee, not sure", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  await cmd("pitches.update", { id, patch: { pitchedAs: "trio" } });
  assert.deepEqual((await db.get("pitches", id))!.personnel, mids);
  await cmd("pitches.update", { id, patch: { personnel: [mids[0]] } });
  assert.deepEqual((await db.get("pitches", id))!.personnel, [mids[0]]);
  await cmd("pitches.update", { id, patch: { nextStep: { text: "Follow up", due: "2026-11-03" } } });
  assert.deepEqual((await db.get("pitches", id))!.nextStep, { text: "Follow up", due: "2026-11-03" });
  await cmd("pitches.update", { id, patch: { nextStep: null, pitchedAs: null } });
  const p = (await db.get("pitches", id))!;
  assert.equal(p.nextStep, undefined);
  assert.equal(p.pitchedAs, undefined);
  await assert.rejects(cmd("pitches.update", { id, patch: { pitchedAs: "orchestra" } }), /configuration/);
  await assert.rejects(cmd("pitches.update", { id, patch: { assigneeId: "ghost" } }), /Assignee/);
});

test("move logs status activity; comments and notes go on the timeline", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  assert.equal((await cmd("pitches.move", { id, status: "toPitch" })).changed, false);
  await cmd("pitches.move", { id, status: "waiting" });
  await cmd("pitches.comment", { id, body: "Mention the Roots show" });
  await cmd("pitches.log", { id, type: "call", text: "Left a voicemail" });
  assert.equal((await db.get("pitches", id))!.status, "waiting");
  assert.ok((await db.get("pitches", id))!.lastContactAt);
  const acts = await db.list(`pitches/${id}/activity`);
  assert.ok(acts.some((a) => a.type === "status" && a.fromStatus === "toPitch" && a.toStatus === "waiting"));
  assert.ok(acts.some((a) => a.type === "call"));
  const comments = await db.list(`pitches/${id}/comments`);
  assert.equal(comments[0].authorId, uid);
  await assert.rejects(cmd("pitches.move", { id, status: "bogus" }));
});

test("email: send logs emailSent, sets lastContactAt, shows in Gmail; unfilled fields refused; replies are pulled once", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const { id } = await cmd("pitches.flag", { kind: "venue", id: v.id });
  await assert.rejects(cmd("pitches.sendEmail", { id, to: ["h@lostlake.example"], subject: "Hi {{contact.firstName}}", body: "x" }), /Fill in/);
  assert.equal((await gmailClient().listMessages()).length, 0);
  const sent = await cmd("pitches.sendEmail", { id, to: ["h@lostlake.example"], subject: "Support slot", body: "Hi Haylee", markPitched: true });
  const msgs = await gmailClient().listMessages({ account: "jeff@example.com" });
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].subject, "Support slot");
  assert.deepEqual(msgs[0].to, ["h@lostlake.example"]);
  const p = (await db.get("pitches", id))!;
  assert.ok(p.lastContactAt);
  assert.equal(p.status, "pitched");
  const act = (await db.list(`pitches/${id}/activity`)).find((a) => a.type === "emailSent")!;
  assert.equal(act.gmail.threadId, sent.threadId);
  assert.equal(act.gmail.subject, "Support slot");

  assert.equal((await cmd("pitches.checkReplies", { id })).added, 0);
  await gmailClient().simulateReply!(sent.threadId, { from: "h@lostlake.example", body: "Sounds great, send dates." });
  assert.equal((await cmd("pitches.checkReplies", { id })).added, 1);
  assert.equal((await cmd("pitches.checkReplies", { id })).added, 0);
  const reply = (await db.list(`pitches/${id}/activity`)).find((a) => a.type === "emailReply")!;
  assert.match(reply.text, /Sounds great/);
});

test("email templates CRUD and admin-only access over the command API", async () => {
  const t = await cmd("emailTemplates.create", { name: "First pitch", subject: "{{venue.name}}", body: "Hi {{contact.firstName}}" });
  await cmd("emailTemplates.update", { id: t.id, patch: { subject: "Hello {{venue.name}}" } });
  assert.equal((await db.get("emailTemplates", t.id))!.subject, "Hello {{venue.name}}");
  assert.deepEqual((await db.get("emailTemplates", t.id))!.targetKinds, []);
  await cmd("emailTemplates.remove", { id: t.id });
  assert.equal((await db.list("emailTemplates")).length, 0);
  const member = await makeUser("m@example.com", "member");
  const res = await dispatch("venues.create", `Bearer ${member.token}`, venue("X"));
  assert.equal(res.status, 403);
  assert.equal((await dispatch("pitches.flag", `Bearer ${token}`, { kind: "venue", id: "nope" })).status, 404);
});

test("migrate-pitched-as: free text matches a configuration by name, otherwise moves to notes; dry run writes nothing; second run is a no-op", async () => {
  const mk = async (name: string, pitchedAs?: string, notes?: string) => {
    const { id } = await cmd("pitches.flag", { kind: "venue", id: (await cmd("venues.create", venue(name))).id, ...(notes ? { notes } : {}) });
    if (pitchedAs !== undefined) await firestore().doc(`pitches/${id}`).update({ pitchedAs });
    return id;
  };
  const duo = await mk("A", " duo ");           // name match, case-insensitive, trimmed
  const trio = await mk("B", "trio");           // already a configuration id: left alone
  const odd = await mk("C", "Acoustic ish", "Loves folk");
  const bare = await mk("D", "Solo");
  const fine = await mk("E");
  await cmd("pitches.update", { id: fine, patch: { pitchedAs: "duo" } });
  const gone = await mk("F", "Quartet");
  await firestore().doc(`pitches/${gone}`).update({ deletedAt: new Date() });

  const dry = await migratePitchedAs(firestore(), { dryRun: true });
  assert.deepEqual(dry.matched.map((m) => m.id), [duo]);
  assert.deepEqual(dry.cleared.map((c) => c.id).sort(), [odd, bare, gone].sort());
  assert.equal((await db.get("pitches", duo))!.pitchedAs, " duo ", "dry run writes nothing");

  await migratePitchedAs(firestore());
  assert.equal((await db.get("pitches", duo))!.pitchedAs, "duo");
  assert.equal((await db.get("pitches", trio))!.pitchedAs, "trio");
  const o = (await db.get("pitches", odd))!;
  assert.equal(o.pitchedAs, undefined);
  assert.equal(o.notes, "Loves folk\nPitched as: Acoustic ish");
  assert.equal((await db.get("pitches", bare))!.notes, "Pitched as: Solo");
  assert.equal((await db.get("pitches", fine))!.pitchedAs, "duo");
  const g = (await firestore().doc(`pitches/${gone}`).get()).data()!;
  assert.equal("pitchedAs" in g, false);
  assert.equal(g.notes, "Pitched as: Quartet");

  const again = await migratePitchedAs(firestore());
  assert.deepEqual([again.matched, again.cleared], [[], []]);
});

test("pitch dates: flag and update accept a list, stored sorted; ranges and notes; bad ranges rejected; unflagged pitches have none", async () => {
  const v = await cmd("venues.create", venue("Lost Lake"));
  const a = await cmd("pitches.flag", { kind: "venue", id: v.id, dates: [{ date: "2027-02-06", note: "hold" }, { date: "2027-01-16" }] });
  assert.deepEqual((await db.get("pitches", a.id))!.dates, [{ date: "2027-01-16" }, { date: "2027-02-06", note: "hold" }]);
  await cmd("pitches.update", { id: a.id, patch: { dates: [{ date: "2027-07-25", endDate: "2027-07-27", note: "festival" }, { date: "2027-03-01" }] } });
  assert.deepEqual((await db.get("pitches", a.id))!.dates, [{ date: "2027-03-01" }, { date: "2027-07-25", endDate: "2027-07-27", note: "festival" }]);
  await assert.rejects(cmd("pitches.update", { id: a.id, patch: { dates: [{ date: "2027-03-05", endDate: "2027-03-01" }] } }), /endDate/);
  await assert.rejects(cmd("pitches.update", { id: a.id, patch: { dates: [{ date: "March 5" }] } }), /YYYY-MM-DD/);
  assert.equal((await db.get("pitches", a.id))!.dates.length, 2, "a rejected edit changes nothing");
  await cmd("pitches.update", { id: a.id, patch: { notes: "only notes" } });
  assert.equal((await db.get("pitches", a.id))!.dates.length, 2, "other edits leave dates alone");
  await cmd("pitches.update", { id: a.id, patch: { dates: [] } });
  assert.deepEqual((await db.get("pitches", a.id))!.dates, []);
  const b = await cmd("pitches.flag", { kind: "venue", id: (await cmd("venues.create", venue("Fox", "Boulder"))).id });
  assert.deepEqual((await db.get("pitches", b.id))!.dates, []);
});
