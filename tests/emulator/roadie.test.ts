import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleChat } from "@/server/assistant/chat";
import { getChatFlow } from "@/server/assistant/flow";
import { execTool } from "@/server/assistant/tools";
import { ensureThread, loadHistory, newMessageId, newThreadId } from "@/server/assistant/threads";
import { newRunId } from "@/server/ctx";
import { OFF_TOPIC, CANT_DO, BAD_FINDER, CALENDAR_OPTIONS, ASK_MISSING } from "@/server/assistant/script";
import { assistantSetPrefs } from "@/server/commands/assistant";
import { dispatch } from "@/server/commands/dispatch";
import { firestore } from "@/server/admin";
import type { AssistantEvent } from "@/schema/assistant";
import { resetEmulators, makeUser } from "./helpers";

beforeEach(resetEmulators);
const ctx = { route: "calendar" };

let n = 0;
async function session() {
  const admin = await makeUser(`s${++n}@example.com`, "admin", { name: "Rudy" });
  const threadId = newThreadId();
  await ensureThread({ uid: admin.uid, threadId, pageContext: ctx, at: new Date() });
  return { uid: admin.uid, role: "admin" as const, name: "Rudy", threadId, runId: newRunId(), replyId: newMessageId() };
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
