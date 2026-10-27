import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startAll } from "../../fakes/run-all";
import { gmailClient, driveClient, calendarClient, bandsintownClient, spotifyClient, IntegrationError } from "@/server/integrations";

let stop: () => Promise<void>;
let urls: Record<string, string>;
let dir: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakes-"));
  const s = await startAll({ dataDir: dir, ephemeral: true });
  stop = s.close;
  urls = Object.fromEntries(Object.entries(s.running).map(([k, v]) => [k, v.url]));
});
after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test("every fake serves an HTML state page, persists state, and resets", async () => {
  for (const url of Object.values(urls)) {
    const html = await (await fetch(url + "/")).text();
    assert.match(html, /<h1>fake-/);
  }
  const gmail = gmailClient(urls["fake-gmail"]);
  await gmail.send({ account: "jeff@example.com", to: ["a@x.com"], subject: "Persist", body: "b" });
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "fake-gmail.json"), "utf8")).messages.length === 1);
  assert.match(await (await fetch(urls["fake-gmail"] + "/")).text(), /Persist/);
  await fetch(urls["fake-gmail"] + "/__reset", { method: "POST" });
  assert.equal((await gmail.listMessages()).length, 0);
});

test("gmail: send, draft, list, reply in thread", async () => {
  const g = gmailClient(urls["fake-gmail"]);
  const sent = await g.send({ account: "jeff@example.com", to: ["booker@venue.com"], cc: ["ingrid@example.com"], subject: "Booking inquiry", body: "Hello" });
  assert.equal(sent.direction, "sent");
  assert.deepEqual(sent.cc, ["ingrid@example.com"]);
  const draft = await g.createDraft({ account: "jeff@example.com", to: ["x@y.com"], subject: "Later", body: "draft body" });
  assert.equal((await g.listDrafts("jeff@example.com"))[0].id, draft.id);
  assert.equal((await g.listDrafts("other@example.com")).length, 0);
  const reply = await g.simulateReply!(sent.threadId, { body: "Sure!" });
  assert.equal(reply.direction, "received");
  assert.equal(reply.from, "booker@venue.com");
  assert.equal(reply.subject, "Re: Booking inquiry");
  const thread = await g.getThread(sent.threadId);
  assert.deepEqual(thread.messages.map((m) => m.direction), ["sent", "received"]);
  assert.equal((await g.listThreads("jeff@example.com")).length, 1);
  assert.equal((await g.listMessages({ q: "sure" })).length, 1);
  await assert.rejects(g.getThread("nope"), IntegrationError);
  // the page button posts a form and redirects back
  const res = await fetch(`${urls["fake-gmail"]}/threads/${sent.threadId}/reply`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "" });
  assert.equal(res.status, 303);
  assert.equal((await g.getThread(sent.threadId)).messages.length, 3);
});

test("gmail: html is kept on sent messages and drafts; the signature routes answer like sendAs.list", async () => {
  const g = gmailClient(urls["fake-gmail"]);
  const sent = await g.send({ account: "sig@example.com", to: ["a@x.com"], subject: "Rich", body: "plain", html: "<p><b>rich</b></p>" });
  await g.createDraft({ account: "sig@example.com", to: ["a@x.com"], subject: "Rich draft", body: "plain", html: "<p>draft</p>" });
  const stored = (await g.listMessages({ q: "rich" })).find((m) => m.id === sent.id) as unknown as { html?: string; body: string };
  assert.equal(stored.html, "<p><b>rich</b></p>");
  assert.equal(stored.body, "plain");
  assert.equal(((await g.listDrafts("sig@example.com")) as unknown as { html?: string }[])[0].html, "<p>draft</p>");
  const plain = await g.send({ account: "sig@example.com", to: ["a@x.com"], subject: "Plain only", body: "p" });
  assert.equal("html" in plain, false);

  assert.equal(await g.getSignature("sig@example.com"), "", "none set yet");
  const raw = await (await fetch(`${urls["fake-gmail"]}/settings/sendAs?account=sig@example.com`)).json();
  assert.deepEqual(raw, { sendAs: [{ sendAsEmail: "sig@example.com", isPrimary: true, signature: "" }] });
  const put = await fetch(`${urls["fake-gmail"]}/settings/signature`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: "sig@example.com", signature: "<div>Jeff Smith</div>" }) });
  assert.equal(put.status, 200);
  assert.equal(await g.getSignature("sig@example.com"), "<div>Jeff Smith</div>");
  assert.equal(await g.getSignature("other@example.com"), "", "signatures are per account");
});

test("drive: seeded files, search, copy, share, permissions", async () => {
  const d = driveClient(urls["fake-drive"]);
  const glass = await d.search({ q: "glass coast" });
  assert.ok(glass.length >= 4);
  assert.ok(glass.some((f) => f.mimeType === "audio/mp4"));
  const chart = await d.get("fake-drive-chart-1");
  assert.ok(!chart.parents.includes("fake-band-folder"));
  assert.ok(!chart.permissions.some((p) => p.email === "eric@example.com"));
  assert.deepEqual((await d.permissions("fake-drive-demo-1")).map((p) => p.email).sort(), ["david@example.com", "emma@example.com", "eric@example.com", "ingrid@example.com", "jeff@example.com"]);
  assert.ok((await d.search({ q: "lyrics" })).every((f) => f.mimeType === "application/vnd.google-apps.document"));
  const shared = await d.share("fake-drive-chart-1", ["eric@example.com", "emma@example.com"]);
  assert.ok(shared.permissions.some((p) => p.email === "eric@example.com" && p.role === "reader"));
  const copy = await d.copy("fake-drive-chart-1", { parentId: "fake-band-folder", name: "Glass Coast chart F#m (band)" });
  assert.deepEqual(copy.parents, ["fake-band-folder"]);
  assert.notEqual(copy.id, "fake-drive-chart-1");
  assert.ok((await d.search({ parent: "fake-band-folder", q: "(band)" })).some((f) => f.id === copy.id));
  await assert.rejects(d.get("missing"), /404/);
  // audio has bytes to play (the fake's tone, as a WAV); other files don't
  const wav = await d.download("fake-drive-demo-1");
  assert.equal(wav.headers.get("content-type"), "audio/wav");
  assert.equal(Buffer.from(await wav.arrayBuffer()).subarray(0, 4).toString(), "RIFF");
  assert.equal((await d.download("fake-drive-chart-1")).status, 400);
});

test("calendar: create, update, list, delete", async () => {
  const c = calendarClient(urls["fake-calendar"]);
  const e = await c.create({ title: "Show at Bluebird", start: "2026-12-05T20:00:00-07:00", end: "2026-12-05T23:00:00-07:00", attendees: ["jeff@example.com", "eric@example.com"] });
  assert.equal(e.attendees[0].responseStatus, "needsAction");
  const u = await c.update(e.id, { title: "Bluebird (moved)", attendees: ["jeff@example.com"] });
  assert.equal(u.title, "Bluebird (moved)");
  assert.equal(u.attendees.length, 1);
  assert.equal((await c.list({ from: "2026-12-01T00:00:00Z", to: "2026-12-31T00:00:00Z" })).length, 1);
  assert.equal((await c.list({ from: "2027-01-01T00:00:00Z" })).length, 0);
  await c.delete(e.id);
  assert.equal((await c.list()).length, 0);
  await assert.rejects(c.delete(e.id), IntegrationError);
});

test("bandsintown: create, update, list, delete", async () => {
  const b = bandsintownClient(urls["fake-bandsintown"]);
  const e = await b.create({ datetime: "2026-12-05T20:00:00", venueName: "Bluebird Theater", city: "Denver", region: "CO" });
  assert.equal(e.artist, "Ingrid Avison Band");
  await b.create({ datetime: "2026-11-01T20:00:00", venueName: "Fox", city: "Boulder" });
  assert.equal((await b.list())[0].venueName, "Fox");
  assert.equal((await b.update(e.id, { ticketUrl: "https://tix.example" })).ticketUrl, "https://tix.example");
  await b.delete(e.id);
  assert.equal((await b.list()).length, 1);
  await assert.rejects(b.create({ datetime: "x" } as never), /400/);
});

test("spotify: daily history with drift, today's numbers, top tracks", async () => {
  const s = spotifyClient(urls["fake-spotify"]);
  const today = await s.artist();
  assert.equal(today.date, new Date().toISOString().slice(0, 10));
  const hist = await s.history();
  assert.ok(hist.length >= 60);
  assert.equal(hist[hist.length - 1].followers, today.followers);
  assert.ok(new Set(hist.map((h) => h.followers)).size > 20, "followers drift");
  assert.ok(hist.every((h) => h.popularity >= 0 && h.popularity <= 100));
  assert.equal((await s.history({ from: hist[5].date, to: hist[7].date })).length, 3);
  const top = await s.topTracks();
  assert.equal(top[0].name, "Glass Coast");
});
