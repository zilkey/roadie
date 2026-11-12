/** Booking campaigns (#82): which pitches a campaign page lists (Ongoing is computed), counts, and listRows scoped before its per-place pick (M9). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeOf, inCampaign, inOngoing, liveCampaigns, ONGOING, sortCampaigns, statusCounts } from "@/lib/campaigns";
import { listRows } from "@/components/booking/listRows";

const camps = liveCampaigns([
  { id: "spring", name: "Spring", status: "active" as const },
  { id: "winter", name: "Winter", status: "closed" as const },
  { id: "gone", name: "Gone", status: "active" as const, deletedAt: { at: 1 } },
]);

test("Ongoing: no campaign, or an active pitch whose campaign is closed or gone", () => {
  assert.ok(inOngoing({ status: "toPitch" }, camps));
  assert.ok(inOngoing({ status: "declined" }, camps), "a closed pitch with no campaign is Ongoing's history");
  assert.ok(!inOngoing({ status: "pitched", campaignId: "spring" }, camps));
  assert.ok(inOngoing({ status: "pitched", campaignId: "winter" }, camps), "closing sends active pitches back to Ongoing");
  assert.ok(!inOngoing({ status: "booked", campaignId: "winter" }, camps), "a closed campaign keeps its history");
  assert.ok(inOngoing({ status: "talking", campaignId: "gone" }, camps));
});

test("a campaign lists every pitch that points at it, closed or not", () => {
  assert.ok(inCampaign({ status: "pitched", campaignId: "winter" }, "winter", camps));
  assert.ok(inCampaign({ status: "booked", campaignId: "winter" }, "winter", camps));
  assert.ok(!inCampaign({ status: "pitched" }, "spring", camps));
  assert.ok(inCampaign({ status: "pitched" }, ONGOING, camps));
});

test("home: each pitch counts once, toward its active campaign or Ongoing", () => {
  assert.equal(homeOf({ status: "pitched", campaignId: "spring" }, camps), "spring");
  assert.equal(homeOf({ status: "pitched", campaignId: "winter" }, camps), ONGOING);
  assert.equal(homeOf({ status: "booked", campaignId: "winter" }, camps), "winter");
  assert.equal(homeOf({ status: "idea" }, camps), ONGOING);
});

test("counts in status order, zeros left out; campaigns active first, by name", () => {
  assert.deepEqual(statusCounts([{ status: "booked" }, { status: "toPitch" }, { status: "booked" }]), [{ status: "toPitch", n: 1 }, { status: "booked", n: 2 }]);
  const s = sortCampaigns([{ id: "b", name: "B", status: "active" }, { id: "z", name: "Z", status: "closed" }, { id: "a", name: "A", status: "active" }]);
  assert.deepEqual(s.active.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(s.closed.map((c) => c.id), ["z"]);
});

test("listRows: a place with pitches in two campaigns shows each campaign's own pitch (filtered before the per-place pick)", () => {
  const at = (ms: number) => ({ toMillis: () => ms });
  const venue = { id: "v1", name: "Velour", address: { street: "", city: "Provo", state: "UT", zip: "" }, promoterIds: [], contactIds: [], type: "club" };
  const pitch = (id: string, status: string, campaignId?: string, created = 1) => ({ id, status, campaignId, target: { kind: "venue", id: "v1", name: "Velour" }, createdAt: at(created) });
  const b = {
    venues: [venue], promoters: [], festivals: [], editions: [], contacts: [],
    pitches: [pitch("old", "declined", "winter", 1), pitch("now", "pitched", "spring", 2), pitch("ong", "toPitch", undefined, 3)],
  } as unknown as Parameters<typeof listRows>[0];
  const rows = (key: string, status?: string) => listRows(b, "pitches", new Set(), null, status, (p) => inCampaign(p, key, camps)).map((r) => r.pitch?.id);
  assert.deepEqual(rows("spring"), ["now"]);
  assert.deepEqual(rows(ONGOING), ["ong"]);
  assert.deepEqual(rows("winter"), [], "a closed campaign has no active pitch: the default view is empty");
  assert.deepEqual(rows("winter", "all"), ["old"], "…so its page opens on every status");
  assert.deepEqual(listRows(b, "pitches", new Set(), null, "all").map((r) => r.pitch?.id), ["ong"], "unscoped, 'all' prefers an active pitch, then the newest");
});

test("groupByPromoter: venues nest under their first promoter; the promoter's own pitch is the group row; lone venues stay put", async () => {
  const { groupByPromoter } = await import("@/lib/promoterGroups");
  const z2 = { id: "z2", name: "Z2" }, ms = { id: "ms", name: "Mountain Sun" };
  const v = (id: string, promoters: { id: string; name: string }[] = []) => ({ kind: "venue", id, promoters });
  const rows = [v("abbott"), v("aggie", [z2]), { kind: "promoter", id: "ms", promoters: [] }, v("avery"), v("fox", [z2, ms]), v("vine", [ms]), v("lone", [{ id: "solo", name: "Solo" }]), { kind: "edition", id: "rmf", promoters: [] }];
  const g = groupByPromoter(rows);
  const shape = g.map((x) => x.type === "row" ? x.row.id : `${x.promoter.id}[${x.own ? "own," : ""}${x.children.map((c) => c.id).join(",")}]`);
  assert.deepEqual(shape, ["abbott", "z2[aggie,fox]", "ms[own,vine]", "avery", "lone", "rmf"],
    "Fox has two promoters and goes under the first (Q3); Mountain Sun's own pitch heads its group; one venue alone is not a group");
  assert.deepEqual(groupByPromoter([{ kind: "promoter", id: "p", promoters: [] }]).map((x) => x.type), ["row"], "a promoter with no venues on the page is a plain row");
});

test("emailCells: initial email, follow-up (same thread or a new one), replied, due, New reply", async () => {
  const { emailCells } = await import("@/lib/emailCells");
  const at = (iso: string) => ({ toMillis: () => Date.parse(iso) });
  const p = { id: "p1", status: "pitched", target: { kind: "venue", id: "v1" }, createdAt: at("2026-10-01T00:00:00Z"), lastContactAt: at("2026-10-20T00:00:00Z") };
  const t = (id: string, o: Record<string, unknown>) => ({ id, subject: `S ${id}`, lastDate: "2026-10-20T10:00:00Z", lastDirection: "sent", messageCount: 1, target: { kind: "venue", id: "v1" }, createdAt: at("2026-10-20T10:00:00Z"), ...o });
  const today = "2026-11-12";
  const toPitch = { ...p, status: "toPitch" };
  assert.deepEqual(emailCells(toPitch, [], "v1", today), { newReply: false, threads: [] }, "no email yet: nothing (the page offers Write it)");
  assert.deepEqual(emailCells(p, [], "v1", today).followUp, { kind: "due", due: false, quiet: true, days: 24 }, "pitched outside Roadie: the follow-up is still owed, with no thread to reply in");
  // One email, no answer, 23 days quiet: the follow-up is due.
  let c = emailCells(p, [t("a", { pitchId: "p1" })], "v1", today);
  assert.deepEqual(c.initial, { threadId: "a", subject: "S a", date: "2026-10-20" });
  assert.equal(c.followUp?.kind, "due");
  // A follow-up we sent in the same thread.
  c = emailCells(p, [t("a", { pitchId: "p1", messageCount: 2, lastDate: "2026-11-03T09:00:00Z" })], "v1", today);
  assert.deepEqual(c.followUp, { kind: "sent", threadId: "a", subject: "S a", date: "2026-11-03", newThread: false, more: 0 });
  // A follow-up in a new thread is marked; they replied in the first: the latest thread decides.
  c = emailCells(p, [t("a", { pitchId: "p1" }), t("b", { pitchId: "p1", createdAt: at("2026-11-05T00:00:00Z"), lastDate: "2026-11-05T00:00:00Z" })], "v1", today);
  assert.deepEqual(c.followUp, { kind: "sent", threadId: "b", subject: "S b", date: "2026-11-05", newThread: true, more: 0 });
  c = emailCells(p, [t("a", { pitchId: "p1", messageCount: 2, lastDirection: "received", lastDate: "2026-10-30T00:00:00Z" })], "v1", today);
  assert.deepEqual([c.followUp?.kind, c.newReply], ["replied", true]);
  c = emailCells(p, [t("a", { pitchId: "p1", messageCount: 2, lastDirection: "received", lastDate: "2026-10-30T00:00:00Z", lastSeenAt: at("2026-10-31T00:00:00Z") })], "v1", today);
  assert.equal(c.newReply, false, "opened since");
  // No thread names the pitch: the place's threads since the pitch began; older mail and another pitch's threads don't count.
  c = emailCells(p, [t("old", { createdAt: at("2026-01-01T00:00:00Z") }), t("other", { pitchId: "p0" }), t("new", {})], "v1", today);
  assert.deepEqual(c.threads, ["new"]);
  // A thread linked long after it was sent (Find sent emails) dates from its first message, not from when Roadie got it.
  c = emailCells(p, [t("late", { pitchId: "p1", firstDate: "2026-10-03T12:00:00Z", createdAt: at("2026-11-12T00:00:00Z") })], "v1", today);
  assert.equal(c.initial?.date, "2026-10-03");
  // S8: a thread covering several pitches counts for each.
  c = emailCells(p, [t("shared", { pitchId: "p0", pitchIds: ["p0", "p1"] })], "v1", today);
  assert.equal(c.initial?.threadId, "shared");
});

test("personalTouches: our last show there, the shows on the pitch and our take on their headliner, our venue note", async () => {
  const { personalTouches } = await import("@/lib/personalTouches");
  const t = personalTouches({
    placeName: "Velour", today: "2026-11-12",
    shows: [{ id: "s1", date: "2025-03-06", status: "played" }, { id: "s2", date: "2024-01-10", status: "played" }, { id: "s3", date: "2026-01-01", status: "canceled" }],
    pitched: [{ id: "e1", date: "2026-12-18", acts: [{ name: "Tin Cup Jane", role: "headliner", actId: "a1" }] }, { id: "old", date: "2026-01-01", acts: [{ name: "Gone", role: "headliner" }] }],
    actNotes: new Map([["a1", { relationship: "openFor", note: "Great harmonies" }]]),
    venueNote: " Ask for Sam ",
  });
  assert.deepEqual(t.map((x) => x.key), ["played:s1", "show:e1", "fan:a1", "actnote:a1", "venueNote"]);
  assert.match(t[0].label, /March 6, 2025 \(and 1 more time\)/);
  assert.match(t[1].text, /open for Tin Cup Jane on Fri, Dec 18/);
  assert.equal(t[4].text, "Ask for Sam");
  assert.deepEqual(personalTouches({ placeName: "X", today: "2026-11-12", shows: [], pitched: [], actNotes: new Map() }), []);
});

test("email queue: round-trips, drops unsafe parts, and walks to the end", async () => {
  const { decodeQueue, encodeQueue, queueHref } = await import("@/lib/emailQueue");
  const items = [{ pitchId: "p1" }, { pitchId: "p2", threadId: "art__t2" }];
  assert.deepEqual(decodeQueue(encodeQueue(items)), items);
  assert.deepEqual(decodeQueue("p1,../x,p3~a b"), [{ pitchId: "p1" }]);
  const h = queueHref(items, 1, "/booking/campaigns/c1")!;
  assert.match(h, /^\/booking\/email\/new\?thread=art__t2&pitch=p2&queue=p1%2Cp2%7Eart__t2&at=1&back=%2Fbooking%2Fcampaigns%2Fc1$/);
  assert.equal(queueHref(items, 2, "/x"), null);
});
