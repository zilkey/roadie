import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleChat } from "@/server/assistant/chat";
import { getChatFlow } from "@/server/assistant/flow";
import { execTool } from "@/server/assistant/tools";
import { ensureThread, newMessageId, newThreadId } from "@/server/assistant/threads";
import { newRunId } from "@/server/ctx";
import { modelMode } from "@/server/assistant/ai";
import { script, OFF_TOPIC, CANT_DO } from "@/server/assistant/script";
import { resolveRoute, routeForPath } from "@/lib/routes";
import { assistantSetPrefs } from "@/server/commands/assistant";
import { dispatch } from "@/server/commands/dispatch";
import { firestore } from "@/server/admin";
import type { AssistantEvent } from "@/schema/assistant";
import { resetEmulators, makeUser } from "./helpers";

beforeEach(resetEmulators);
const ctx = { route: "home" };

let n = 0;
async function session() {
  const admin = await makeUser(`s${++n}@example.com`, "admin", { name: "Jeff" });
  const threadId = newThreadId();
  await ensureThread({ uid: admin.uid, threadId, pageContext: ctx, at: new Date() });
  return { uid: admin.uid, role: "admin" as const, name: "Jeff", threadId, runId: newRunId(), replyId: newMessageId() };
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

test("model defaults to the canned one under emulators", () => {
  assert.equal(modelMode({ FIRESTORE_EMULATOR_HOST: "x" } as never), "fake");
  assert.equal(modelMode({} as never), "vertex");
  assert.equal(modelMode({ GEMINI_API_KEY: "k" } as never), "gemini");
  assert.equal(modelMode({ ROADIE_MODEL: "vertex", GEMINI_API_KEY: "k" } as never), "vertex");
  assert.equal(modelMode({ ROADIE_MODEL: "fake" } as never), "fake");
});

test("script: greeting, off-topic, can't-do, navigation", () => {
  assert.match(script({ text: "hi" }).text!, /Roadie/);
  assert.equal(script({ text: "what's the weather" }).text, OFF_TOPIC);
  assert.equal(script({ text: "delete the Top Hat show" }).text, CANT_DO);
  assert.deepEqual(script({ text: "show me the shows" }).calls, [{ name: "ui.navigate", input: { route: "shows" } }]);
  assert.deepEqual(script({ text: "go to money" }).calls, [{ name: "ui.navigate", input: { route: "money" } }]);
});

test("script: show questions use shows.list with the filter, and answer from its rows", () => {
  assert.deepEqual(script({ text: "how many shows were canceled?" }).calls, [{ name: "shows.list", input: { filter: "canceled" } }]);
  assert.deepEqual(script({ text: "Which gigs got dropped" }).calls, [{ name: "shows.list", input: { filter: "dropped" } }]);
  assert.deepEqual(script({ text: "what shows are coming up" }).calls, [{ name: "shows.list", input: { filter: "upcoming" } }]);
  assert.deepEqual(script({ text: "cancel the Hi-Dive show" }).calls, [{ name: "search", input: { q: "hi-dive", kinds: ["show"] } }]);
  const out = (shows: { name: string; date: string }[]) => ({ untrustedContent: { filter: "canceled", count: shows.length, shows } });
  const steps = (o: unknown) => [{ name: "shows.list", input: { filter: "canceled" }, output: o }];
  assert.equal(script({ text: "how many shows were canceled?", steps: steps(out([{ name: "Hi-Dive", date: "2026-09-01" }])) }).text, "1 show canceled: Hi-Dive · 2026-09-01.");
  assert.equal(script({ text: "how many shows were canceled?", steps: steps(out([])) }).text, "No shows canceled.");
});

test("flow: greeting streams text word by word", async () => {
  const { events, out } = await run("hi");
  assert.ok(events.filter((e) => e.type === "text").length > 2);
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

test("routes: registry resolves names, never raw URLs", () => {
  assert.equal(resolveRoute("show", { id: "abc" })?.href, "/shows/abc");
  assert.equal(resolveRoute("show", { id: "../x" }), null);
  assert.equal(resolveRoute("/shows"), null);
  assert.deepEqual(routeForPath("/shows/abc"), { route: "show", params: { id: "abc" } });
  assert.equal(routeForPath("/nope"), null);
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

test("command: assistant.setPrefs stores width and thread, members refused", async () => {
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
});
