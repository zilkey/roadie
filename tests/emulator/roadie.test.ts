import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleChat, handleStop } from "@/server/assistant/chat";
import { getChatFlow } from "@/server/assistant/flow";
import { execTool } from "@/server/assistant/tools";
import { ensureThread, loadHistory, newMessageId, newThreadId } from "@/server/assistant/threads";
import { newRunId } from "@/server/ctx";
import { OFF_TOPIC, CANT_DO, BAD_FINDER, CALENDAR_OPTIONS, ASK_MISSING } from "@/server/assistant/script";
import { assistantSetPrefs } from "@/server/commands/assistant";
import { dispatch } from "@/server/commands/dispatch";
import { firestore } from "@/server/admin";
import type { AssistantEvent } from "@/schema/assistant";
import { resetEmulators, makeUser, TEST_ARTIST } from "./helpers";

beforeEach(resetEmulators);
const ctx = { route: "calendar" };

let n = 0;
async function session() {
  const admin = await makeUser(`s${++n}@example.com`, "admin", { name: "Rudy" });
  const threadId = newThreadId();
  await ensureThread({ uid: admin.uid, artistId: TEST_ARTIST, threadId, pageContext: ctx, at: new Date() });
  return { uid: admin.uid, artistId: TEST_ARTIST, role: "admin" as const, name: "Rudy", threadId, runId: newRunId(), replyId: newMessageId() };
}
async function run(message: string) {
  const flow = await getChatFlow();
  const { stream, output } = flow.stream({ message, history: [], pageContext: ctx, session: await session() });
  const events: AssistantEvent[] = [];
  for await (const e of stream as AsyncIterable<AssistantEvent>) events.push(e);
  return { events, out: (await output) as { text: string; actions: { kind: string; label: string; route?: string }[] } };
}
const textOf = (events: AssistantEvent[]) => events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("").trim();

async function readSse(res: Response) {
  const body = await res.text();
  return body.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as AssistantEvent);
}
const post = (token: string | null, body: unknown) => handleChat(token ? `Bearer ${token}` : null, body);

test("flow: greeting streams its text (a step is held until it ends, then sent)", async () => {
  const { events, out } = await run("hi");
  assert.ok(events.filter((e) => e.type === "text").length >= 1);
  assert.equal(textOf(events), out.text);
  assert.match(out.text, /^Hey/);
  assert.deepEqual(out.actions, []);
});

test("flow: off-topic and can't-do lines", async () => {
  assert.equal((await run("tell me a joke")).out.text, OFF_TOPIC);
  assert.equal((await run("send the advance")).out.text, CANT_DO);
});

test("flow: 'show me the shows' emits a navigate event and records it", async () => {
  const { events, out } = await run("show me the shows");
  const nav = events.find((e) => e.type === "navigate");
  assert.deepEqual(nav, { type: "navigate", route: "shows", params: {}, label: "Shows" });
  assert.deepEqual(out.actions, [{ kind: "navigate", label: "Shows", route: "shows", params: {} }]);
  assert.match(out.text, /There you go/);
});

test("flow: a bad route name fails safely (no navigate event)", async () => {
  const { events, out } = await run("go to narnia");
  assert.equal(events.some((e) => e.type === "navigate"), false);
  assert.match(out.text, /can't do that/);
  const s = { ...(await session()), model: "roadie/fake" };
  const none = () => {};
  assert.deepEqual((await execTool(s, "ui.navigate", { route: "http://evil.example" }, none)).output, { error: 'No page called "http://evil.example"' });
  assert.ok((await execTool(s, "ui.navigate", { route: "show" }, none)).output); // missing :id
  assert.equal((await execTool(s, "ui.navigate", { route: "show" }, none)).action?.kind, "action");
});

test("flow: ui.ask puts the question in the reply, the options as reply buttons, and changes nothing", async () => {
  const { events, out } = await run("put a deadline on the calendar for Dec 5");
  assert.match(textOf(events), /^I could just be a bad finder/);
  assert.equal(out.text, `${BAD_FINDER} Did you want:`);
  assert.deepEqual(events.filter((e) => e.type === "reply").map((e) => (e as { label: string }).label), CALENDAR_OPTIONS);
  assert.deepEqual(out.actions, CALENDAR_OPTIONS.map((label) => ({ kind: "reply", label })));
  assert.equal(events.some((e) => e.type === "readback" || e.type === "confirm"), false);
});

test("ui.ask: needs a question and 2-4 options", async () => {
  const s = { ...(await session()), model: "roadie/fake" };
  const none = () => {};
  const one = await execTool(s, "ui.ask", { question: "Which?", options: ["Only one"] }, none);
  assert.equal((one.output as { error: { code: string } }).error.code, "invalid_input");
  assert.equal(one.choices, undefined);
  const two = await execTool(s, "ui.ask", { question: "Which?", options: ["A", "A", "B"] }, none);
  assert.deepEqual(two.choices, [{ kind: "reply", label: "A" }, { kind: "reply", label: "B" }]);
  assert.equal(two.say, "Which?");
  assert.equal(two.stop, true);
});

test("api: refuses unauthenticated, garbage and member callers; bad bodies are 400", async () => {
  const member = await makeUser("m@example.com", "member");
  const admin = await makeUser("a@example.com", "admin");
  const body = { message: "hi", pageContext: ctx };
  assert.equal((await post(null, body)).status, 401);
  assert.equal((await post("garbage", body)).status, 401);
  assert.equal((await post(member.token, body)).status, 403);
  assert.equal((await post(admin.token, { message: "", pageContext: ctx })).status, 400);
  assert.equal((await post(admin.token, { message: "hi" })).status, 400);
});

test("api: streams events and persists the thread; second message reuses it", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const res = await post(admin.token, { message: "hi", pageContext: { route: "shows" } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/event-stream/);
  const events = await readSse(res);
  const done = events.at(-1) as Extract<AssistantEvent, { type: "done" }>;
  assert.equal(done.type, "done");
  assert.ok(events.some((e) => e.type === "text"));

  const thread = firestore().collection("assistantThreads").doc(done.threadId);
  const t = (await thread.get()).data()!;
  assert.equal(t.ownerUid, admin.uid);
  assert.equal(t.startedOnRoute, "shows");
  const msgs = (await thread.collection("messages").orderBy("at").get()).docs.map((d) => d.data());
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant"]);
  assert.equal(msgs[0].text, "hi");
  assert.match(msgs[1].text, /^Hey/);
  assert.deepEqual(msgs[1].pageContext, { route: "shows" });

  const again = await readSse(await post(admin.token, { threadId: done.threadId, message: "show me the shows", pageContext: ctx }));
  assert.equal((again.at(-1) as { threadId: string }).threadId, done.threadId);
  assert.ok(again.some((e) => e.type === "navigate"));
  const all = await thread.collection("messages").get();
  assert.equal(all.size, 4);
  const saved = all.docs.map((d) => d.data()).find((m) => m.actions.length);
  assert.equal(saved?.actions[0].label, "Shows");
});

test("api: someone else's thread id starts a fresh thread; transcripts stay out of history", async () => {
  const a = await makeUser("a@example.com", "admin");
  const b = await makeUser("b@example.com", "admin");
  const first = (await readSse(await post(a.token, { message: "hi", pageContext: ctx }))).at(-1) as { threadId: string };
  const second = (await readSse(await post(b.token, { threadId: first.threadId, message: "hi", pageContext: ctx }))).at(-1) as { threadId: string };
  assert.notEqual(second.threadId, first.threadId);
  const hist = await firestore().collection("history").get();
  assert.equal(hist.docs.some((d) => String(d.data().path ?? d.data().collection ?? "").includes("assistant")), false);
});

test("api: a new thread under the id the browser picked; taken, malformed or foreign ids get a fresh one; a Stop before the first event still lands there", async () => {
  const a = await makeUser("a@example.com", "admin");
  const b = await makeUser("b@example.com", "admin");
  const picked = firestore().collection("assistantThreads").doc().id;
  const first = (await readSse(await post(a.token, { threadId: picked, message: "hi", pageContext: ctx }))).at(-1) as { threadId: string };
  assert.equal(first.threadId, picked);
  assert.equal((await firestore().collection("assistantThreads").doc(picked).get()).data()?.ownerUid, a.uid);
  // Someone else asking for the same id (now taken) gets their own thread, not a's.
  const theirs = (await readSse(await post(b.token, { threadId: picked, message: "hi", pageContext: ctx }))).at(-1) as { threadId: string };
  assert.notEqual(theirs.threadId, picked);
  // Only a Firestore auto-id is taken as given.
  const odd = (await readSse(await post(a.token, { threadId: "not-an-auto-id", message: "hi", pageContext: ctx }))).at(-1) as { threadId: string };
  assert.notEqual(odd.threadId, "not-an-auto-id");

  // Stop before the browser read a single event: the turn is saved, stopped, in the thread it named.
  const early = firestore().collection("assistantThreads").doc().id;
  const stop = new AbortController();
  stop.abort();
  const res = await handleChat(`Bearer ${a.token}`, { threadId: early, message: "find me a venue in Boise [fake: slow]", pageContext: ctx }, null, stop.signal);
  await res.body!.cancel().catch(() => {});
  const msgs = firestore().collection("assistantThreads").doc(early).collection("messages");
  const until = Date.now() + 8000;
  let saved: FirebaseFirestore.DocumentData[] = [];
  while (saved.length < 2 && Date.now() < until) { saved = (await msgs.orderBy("at").get()).docs.map((d) => d.data()); if (saved.length < 2) await new Promise((r) => setTimeout(r, 100)); }
  assert.deepEqual(saved.map((m) => m.role), ["user", "assistant"]);
  assert.equal(saved[1].stopped, true);
});

test("api: Stop as its own request ends the turn with no dropped stream, even sent before the turn arrives; only the person's own stop counts", async () => {
  const admin = await makeUser("stop2@example.com", "admin", { name: "Rudy" });
  const other = await makeUser("other@example.com", "admin", { name: "Felix" });
  const member = await makeUser("member@example.com", "member", { name: "Hugo" });
  const message = "find me a venue in Boise [fake: slow]";
  const auto = () => firestore().collection("assistantThreads").doc().id;
  const msgs = (t: string) => firestore().collection("assistantThreads").doc(t).collection("messages");
  const until = async (t: string, n: number) => {
    const end = Date.now() + 8000;
    let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    while (Date.now() < end && (docs = (await msgs(t).orderBy("at").get()).docs).length < n) await new Promise((r) => setTimeout(r, 100));
    return docs;
  };

  // Mid-turn, and the stream is never dropped (a server that doesn't hear the disconnect): the stop request ends it.
  const thread1 = auto(), reply1 = auto();
  const res = await handleChat(`Bearer ${admin.token}`, { threadId: thread1, replyId: reply1, message, pageContext: ctx });
  const reader = res.body!.getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, "")) as Extract<AssistantEvent, { type: "start" }>;
  assert.deepEqual([first.threadId, first.messageId], [thread1, reply1], "the browser's ids");
  // someone else's stop doesn't count: once the thread exists, a stop from anyone but its owner is refused (not_found)
  assert.equal((await handleStop(`Bearer ${other.token}`, { threadId: thread1, replyId: reply1 })).status, 404);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await msgs(thread1).get()).size, 0, "still running");
  const started = Date.now();
  assert.equal((await handleStop(`Bearer ${admin.token}`, { threadId: thread1, replyId: reply1 })).status, 200);
  const saved = await until(thread1, 2);
  assert.ok(Date.now() - started < 5000, `stopped promptly (${Date.now() - started}ms)`);
  assert.equal(saved[1].id, reply1);
  assert.equal(saved[1].data().stopped, true);
  await reader.cancel().catch(() => {});

  // Before the turn arrives (Stop tapped while the request was still on its way): saved at once, stopped, message kept.
  const thread2 = auto(), reply2 = auto();
  await handleStop(`Bearer ${admin.token}`, { threadId: thread2, replyId: reply2 });
  const t0 = Date.now();
  const res2 = await handleChat(`Bearer ${admin.token}`, { threadId: thread2, replyId: reply2, message, pageContext: ctx });
  await res2.text();
  assert.ok(Date.now() - t0 < 5000, "no waiting on the model");
  const saved2 = await until(thread2, 2);
  assert.deepEqual(saved2.map((d) => d.data().role), ["user", "assistant"]);
  assert.equal(saved2[0].data().text, message);
  assert.equal(saved2[1].data().stopped, true);
  assert.equal((await firestore().collection("assistantStops").doc(reply2).get()).exists, false, "the stop is cleared once used");

  // Members have no Roadie; ids must be auto-ids.
  assert.equal((await handleStop(`Bearer ${member.token}`, { threadId: thread2, replyId: reply2 })).status, 403);
  assert.equal((await handleStop(`Bearer ${admin.token}`, { threadId: thread2, replyId: "../x" })).status, 400);
  assert.equal((await handleStop(null, { threadId: thread2, replyId: reply2 })).status, 401);
});

test("api: a new conversation becomes the one the panel opens, set by the chat request; an older New chat landing late doesn't undo it", async () => {
  const admin = await makeUser("open@example.com", "admin", { name: "Rudy" });
  const prefs = async () => ((await firestore().collection("users").doc(admin.uid).get()).data()!.prefs?.assistant ?? {}) as { threadId?: string; threadAt?: number };
  const t = firestore().collection("assistantThreads").doc().id;
  await readSse(await post(admin.token, { threadId: t, sentAt: 2000, message: "hi", pageContext: ctx }));
  assert.equal((await prefs()).threadId, t, "opened by the request that started it");
  assert.equal((await prefs()).threadAt, 2000);
  // New chat tapped before that message (at 1000), its save arriving after it: ignored
  await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { threadId: null, at: 1000 });
  assert.equal((await prefs()).threadId, t);
  // New chat tapped after it: wins
  await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { threadId: null, at: 3000 });
  assert.equal((await prefs()).threadId, undefined);
  // A message in a conversation already open doesn't touch it again
  await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { threadId: t, at: 4000 });
  await readSse(await post(admin.token, { threadId: t, sentAt: 3500, message: "hi", pageContext: ctx }));
  assert.equal((await prefs()).threadAt, 4000);
  assert.equal((await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { threadId: null, at: -1 })).status, 400);
});

test("command: assistant.setPrefs stores width (rail or pixels) and thread, members refused", async () => {
  const admin = await makeUser("a@example.com", "admin");
  const member = await makeUser("m@example.com", "member");
  assert.equal(assistantSetPrefs.name, "assistant.setPrefs");
  assert.equal((await dispatch("assistant.setPrefs", `Bearer ${member.token}`, { width: "narrow" })).status, 403);
  assert.equal((await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { width: "narrow" })).status, 200);
  assert.equal((await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { threadId: "t1" })).status, 200);
  const u = (await firestore().collection("users").doc(admin.uid).get()).data()!;
  assert.deepEqual(u.prefs, { assistant: { width: "narrow", threadId: "t1" } });
  await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { threadId: null });
  assert.deepEqual((await firestore().collection("users").doc(admin.uid).get()).data()!.prefs, { assistant: { width: "narrow" } });
  assert.equal((await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { width: "huge" })).status, 400);
  // A dragged width in pixels, from 280 up; fractions and tiny widths refused.
  assert.equal((await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { width: 480 })).status, 200);
  assert.deepEqual((await firestore().collection("users").doc(admin.uid).get()).data()!.prefs, { assistant: { width: 480 } });
  for (const bad of [279, 480.5, 5000]) assert.equal((await dispatch("assistant.setPrefs", `Bearer ${admin.token}`, { width: bad })).status, 400, String(bad));
});

test("flow: a reply that promises a change with nothing written gets one nudge, then asks instead", async () => {
  const { events, out } = await run("update the load-in");
  assert.equal(out.text, ASK_MISSING);
  assert.equal(textOf(events), ASK_MISSING);
  assert.ok(!/let me update/i.test(textOf(events)));
  assert.ok(!/let me update/i.test(out.text));
  assert.ok(!out.actions.some((a) => a.kind === "readback" || a.kind === "confirm"), JSON.stringify(out.actions));
});

test("api: a failed model call still saves the person's message, the error event names the thread, history says it failed", async () => {
  const admin = await makeUser("fail@example.com", "admin", { name: "Rudy" });
  const message = "move load-in at Deep End to 4:30 [fake: 400]";
  const events = await readSse(await post(admin.token, { message, pageContext: ctx }));
  const err = events.at(-1) as Extract<AssistantEvent, { type: "error" }>;
  assert.equal(err.type, "error");
  assert.equal(err.message, "Roadie dropped a cable. Try again.");
  assert.ok(err.threadId);
  assert.ok(err.messageId);

  const thread = firestore().collection("assistantThreads").doc(err.threadId!);
  const msgs = (await thread.collection("messages").orderBy("at").get()).docs.map((d) => d.data());
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant"]);
  assert.equal(msgs[0].text, message);
  assert.equal(msgs[1].failed, true);
  assert.match(msgs[1].text, /Roadie dropped a cable\. Try again\.$/);

  const history = await loadHistory(admin.uid, err.threadId!);
  assert.equal(history?.length, 2);
  assert.match(history![1].text, /This reply failed partway/);
  assert.match(history![1].text, /Nothing was changed/);

  const again = await readSse(await post(admin.token, { threadId: err.threadId, message: "hi", pageContext: ctx }));
  const done = again.at(-1) as Extract<AssistantEvent, { type: "done" }>;
  assert.equal(done.type, "done");
  assert.equal(done.threadId, err.threadId);
  assert.equal((await thread.collection("messages").get()).size, 4);
});

test("api: Stop mid-reply ends the turn at once, saves it as stopped with the thread named up front, history says it was dropped", async () => {
  const admin = await makeUser("stop@example.com", "admin", { name: "Rudy" });
  const message = "find me a venue in Boise [fake: slow]";
  const stop = new AbortController();
  const res = await handleChat(`Bearer ${admin.token}`, { message, pageContext: ctx }, null, stop.signal);
  const reader = res.body!.getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value).replace(/^data: /, "")) as AssistantEvent;
  assert.equal(first.type, "start");
  const { threadId, messageId } = first as Extract<AssistantEvent, { type: "start" }>;
  await new Promise((r) => setTimeout(r, 300)); // the fake model is now "thinking" (20s unless stopped)
  const started = Date.now();
  stop.abort();
  await reader.cancel().catch(() => {});

  const reply = firestore().collection("assistantThreads").doc(threadId).collection("messages").doc(messageId);
  let saved: FirebaseFirestore.DocumentData | undefined;
  while (!(saved = (await reply.get()).data()) && Date.now() - started < 8000) await new Promise((r) => setTimeout(r, 100));
  assert.ok(saved, "the stopped reply is saved");
  assert.ok(Date.now() - started < 5000, `stopped promptly (${Date.now() - started}ms)`);
  assert.equal(saved.stopped, true);
  assert.equal(saved.failed, undefined);
  assert.equal(saved.text, "", "the model's unfinished words are not kept");

  const history = await loadHistory(admin.uid, threadId);
  assert.equal(history?.[0].text, message);
  assert.match(history![1].text, /They stopped this reply\. Nothing was changed\./);

  // The conversation goes on normally after a Stop.
  const again = await readSse(await post(admin.token, { threadId, message: "hi", pageContext: ctx }));
  assert.equal(again[0].type, "start");
  const done = again.at(-1) as Extract<AssistantEvent, { type: "done" }>;
  assert.equal(done.type, "done");
  assert.equal(done.threadId, threadId);
});
