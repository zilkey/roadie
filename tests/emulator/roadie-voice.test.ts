import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { registry } from "@/server/commands/registry";
import { db } from "@/server/db";
import { firestore } from "@/server/admin";
import { newRunId, type Ctx } from "@/server/ctx";
import { answerPending, sessionFor, type Who } from "@/server/assistant/confirm";
import { VOICE_TAP_ONLY, voiceConfirmable } from "@/server/assistant/policy";
import { VOICE_NOTE } from "@/server/assistant/flow";
import { execTool, type Emit } from "@/server/assistant/tools";
import { handleTranscribe } from "@/server/assistant/transcribe";
import { ensureThread, newThreadId } from "@/server/assistant/threads";
import { MAX_AUDIO_BYTES, type AssistantEvent } from "@/schema/assistant";
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
let venueId: string;
const noop: Emit = () => {};

beforeEach(async () => {
  await resetEmulators();
  admin = await makeUser("rudy@example.com", "admin", { name: "Rudy" });
  who = { uid: admin.uid, role: "admin", name: "Rudy" };
  sys = { uid: admin.uid, role: "admin", via: "app", runId: newRunId() };
  const mus = (await db.create(sys, "musicians", { name: "Nora", instruments: [], active: true })).id;
  await db.create(sys, "artists", {
    slug: "nora-quill-band", name: "Nora Quill Band", driveFolderId: "", links: {},
    configurations: [{ id: "trio", name: "Trio", billingName: "Trio", musicianIds: [mus] }],
  }, { id: TEST_ARTIST });
  const v = (await registry["venues.create"].run(sys, registry["venues.create"].input.parse(venue("Deep End")))) as { id: string };
  venueId = v.id;
  // Creating a show makes the Band default project, which income.add lands on.
  await registry["shows.create"].run(sys, registry["shows.create"].input.parse({ date: "2026-11-14", venueId, status: "hold", times: { loadIn: "19:00", set: "21:15" } }));
});

/** A session with a thread; `voice` marks the message as spoken. */
async function sess(voice: boolean) {
  const threadId = newThreadId();
  await ensureThread({ uid: admin.uid, threadId, pageContext: { route: "calendar" }, at: new Date() });
  return { ...sessionFor(who, threadId), artistId: TEST_ARTIST, ...(voice ? { voice: true } : {}) };
}
const INCOME = { amount: 1000, category: "tips", from: "The Trident Bookstore" };
const TAP_ONLY_CALL = () => ({ name: "venues.update", input: { id: venueId, patch: { capacity: 300 } } });
const pendingStatus = async (threadId: string, pendingId: string) => (await firestore().collection("assistantThreads").doc(threadId).collection("pending").doc(pendingId).get()).data()!.status;
async function card(s: Awaited<ReturnType<typeof sess>>, name: string, input: unknown) {
  const events: AssistantEvent[] = [];
  const out = await execTool(s, name, input, (e) => events.push(e));
  const confirm = events.find((e) => e.type === "confirm") as Extract<AssistantEvent, { type: "confirm" }> | undefined;
  const o = out.output as { needsConfirmation?: boolean; pendingId: string; message: string };
  return { out, o, confirm };
}

test("voiceConfirmable: money and cancels yes; sharing, merges, shared venue edits and dropdown cards no", () => {
  assert.equal(voiceConfirmable("income.add", { amount: 1000 }, false), true);
  assert.equal(voiceConfirmable("shows.cancel", { id: "x" }, false), true);
  for (const n of VOICE_TAP_ONLY) assert.equal(voiceConfirmable(n, {}, false), false, n);
  assert.ok(VOICE_TAP_ONLY.includes("stagePlots.shareLink") && VOICE_TAP_ONLY.includes("venues.mergeInto") && VOICE_TAP_ONLY.includes("songs.merge"));
  assert.equal(voiceConfirmable("venues.update", { id: "v", patch: { capacity: 300 } }, false), false);
  assert.equal(voiceConfirmable("venues.update", { id: "v", patch: { notes: "x", capacity: 300 } }, false), false);
  assert.equal(voiceConfirmable("venues.update", { id: "v", patch: { notes: "x", loadInNotes: "y" } }, false), true, "the band's own fields are fine");
  assert.equal(voiceConfirmable("income.add", { amount: 1000 }, true), false, "a card with a dropdown needs a tap");
  assert.equal(voiceConfirmable("shows.cancel", { id: "x" }, true), false);
});

test("the spoken-message note tells the model to keep it short and spoken", () => {
  assert.match(VOICE_NOTE, /read aloud/);
  assert.match(VOICE_NOTE, /no lists, markdown/);
});

test("a voice session's income.add card carries voice: true and tells the model to ask 'Want me to'", async () => {
  const s = await sess(true);
  const { out, o, confirm } = await card(s, "income.add", INCOME);
  assert.equal(o.needsConfirmation, true);
  assert.equal(out.action?.kind, "confirm");
  assert.equal(out.action?.voice, true);
  assert.equal(confirm?.voice, true);
  assert.match(o.message, /Want me to/);
  assert.match(o.message, /The Trident Bookstore owes us \$10\.00/);
  assert.equal(out.stop, false, "the model gets one more step to ask out loud");
  assert.equal((await db.list("income")).length, 0, "nothing runs until the yes");
});

test("without voice the same card has no voice flag and the tap message", async () => {
  const s = await sess(false);
  const { out, o, confirm } = await card(s, "income.add", INCOME);
  assert.equal(out.action?.kind, "confirm");
  assert.equal("voice" in out.action!, false);
  assert.equal(confirm && "voice" in confirm, false);
  assert.doesNotMatch(o.message, /Want me to/);
  assert.match(o.message, /tap Yes/);
  assert.equal(out.stop, true, "a typed message's money card still ends it");
});

test("a tap-only card in a voice session has no voice flag and the 'needs a tap' message", async () => {
  const s = await sess(true);
  const { name, input } = TAP_ONLY_CALL();
  const { out, o, confirm } = await card(s, name, input);
  assert.equal(out.action?.kind, "confirm");
  assert.equal("voice" in out.action!, false);
  assert.equal(confirm && "voice" in confirm, false);
  assert.match(o.message, /needs a tap/);
  assert.doesNotMatch(o.message, /Want me to/);
});

test("a spoken yes runs an income.add card", async () => {
  const s = await sess(true);
  const { o } = await card(s, "income.add", INCOME);
  const ans = await answerPending(who, { threadId: s.threadId, pendingId: o.pendingId, decision: "yes", by: "voice" });
  assert.equal(ans.status, "done");
  const rows = (await db.list("income")).filter((r) => !r.deletedAt);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 1000);
  assert.equal(rows[0].from, "The Trident Bookstore");
});

test("a spoken yes on a tap-only card is refused with not_allowed and the card stays open for a tap", async () => {
  const s = await sess(true);
  const { name, input } = TAP_ONLY_CALL();
  const { o } = await card(s, name, input);
  await assert.rejects(answerPending(who, { threadId: s.threadId, pendingId: o.pendingId, decision: "yes", by: "voice" }), (e: { code?: string; status?: number }) => e.code === "not_allowed" && e.status === 403);
  assert.equal(await pendingStatus(s.threadId, o.pendingId), "pending");
  assert.notEqual((await db.get("venues", venueId))!.capacity, 300);
  // the tap still works
  assert.equal((await answerPending(who, { threadId: s.threadId, pendingId: o.pendingId, decision: "yes" })).status, "done");
  assert.equal((await db.get("venues", venueId))!.capacity, 300);
});

test("a spoken cancel works on a tap-only card", async () => {
  const s = await sess(true);
  const { name, input } = TAP_ONLY_CALL();
  const { o } = await card(s, name, input);
  assert.equal((await answerPending(who, { threadId: s.threadId, pendingId: o.pendingId, decision: "cancel", by: "voice" })).status, "canceled");
  assert.equal(await pendingStatus(s.threadId, o.pendingId), "canceled");
  assert.notEqual((await db.get("venues", venueId))!.capacity, 300);
});

// ---------- transcribe (fake model mode: a text/plain clip is its own transcript) ----------

const form = (blob: Blob | null, mode?: string) => {
  const f = new FormData();
  if (blob) f.append("audio", blob, "clip.txt");
  if (mode !== undefined) f.append("mode", mode);
  return f;
};
const speak = (text: string) => new Blob([text], { type: "text/plain" });
const bearer = () => `Bearer ${admin.token}`;
const errCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

test("transcribe: message mode returns the text and no answer", async () => {
  const res = await handleTranscribe(bearer(), form(speak("add ten dollars"), "message"), TEST_ARTIST);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: "add ten dollars" });
});

test("transcribe: answer mode returns the text and the matched answer", async () => {
  const yes = await (await handleTranscribe(bearer(), form(speak("yes"), "answer"), TEST_ARTIST)).json();
  assert.deepEqual(yes, { text: "yes", answer: "yes" });
  const no = await (await handleTranscribe(bearer(), form(speak("Nope."), "answer"), TEST_ARTIST)).json();
  assert.equal(no.answer, "cancel");
  const unclear = await (await handleTranscribe(bearer(), form(speak("yes but make it twenty"), "answer"), TEST_ARTIST)).json();
  assert.equal(unclear.answer, "unclear");
});

test("transcribe: an empty clip, a missing clip and a bad mode are 400; a clip over the limit is 413", async () => {
  const empty = await handleTranscribe(bearer(), form(speak(""), "message"), TEST_ARTIST);
  assert.equal(empty.status, 400);
  assert.equal(await errCode(empty), "invalid_input");
  assert.equal((await handleTranscribe(bearer(), form(null, "message"), TEST_ARTIST)).status, 400);
  assert.equal((await handleTranscribe(bearer(), form(speak("hi"), "shout"), TEST_ARTIST)).status, 400);
  assert.equal((await handleTranscribe(bearer(), form(speak("hi")), TEST_ARTIST)).status, 400);
  const big = await handleTranscribe(bearer(), form(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: "text/plain" }), "message"), TEST_ARTIST);
  assert.equal(big.status, 413);
  // right at the limit is accepted
  assert.equal((await handleTranscribe(bearer(), form(new Blob([new Uint8Array(MAX_AUDIO_BYTES).fill(97)], { type: "text/plain" }), "message"), TEST_ARTIST)).status, 200);
});

test("transcribe: admins only, and a sign-in is needed", async () => {
  const member = await makeUser("hugo@example.com", "member", { name: "Hugo" });
  const m = await handleTranscribe(`Bearer ${member.token}`, form(speak("hi"), "message"), TEST_ARTIST);
  assert.equal(m.status, 403);
  const none = await handleTranscribe(null, form(speak("hi"), "message"), TEST_ARTIST);
  assert.equal(none.status, 401);
});
