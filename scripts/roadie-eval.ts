/**
 * `npm run eval:roadie` (or `ROADIE_EVAL="sofar-three solarium" npm run eval:roadie`): run real conversations through Roadie's
 * flow against the REAL model (Vertex through the service-account key in .secrets, billed to roadie-prod-iab; no login)
 * and the real web, with a throwaway band in its own emulator run (nothing of yours needs to be up),
 * and check what it did: which tools it called, whether it made cards, whether it asked instead of acting. The unit tests
 * use the canned model and prove the plumbing; this proves the model behaves. Each run makes a throwaway band, so your
 * emulator data is untouched (the eval band stays; wipe it with `npm run wipe` whenever).
 *
 * A scenario is a list of turns. Each turn's checks: `calls` (tool names that must appear, in order, as regexes),
 * `noCalls`, `cards` (how many confirm cards), `text` / `noText` (regexes on the reply), `noAsk` (no ui.ask buttons),
 * `args` (a call to the first regex whose input matches the second: the date it picked), `cardVoice` (every confirm card does / doesn't
 * carry voice: true). A scenario with `voice: true` runs as a spoken message (the session's voice flag, as ChatRequest.voice sets it).
 *
 * The post-show conversations (#69, scripts/roadie-post-show.ts, names start "post-show-") go further: each gets its own
 * band with tonight's show in it, the harness taps Yes on the cards after each turn and saves the turn to the thread the
 * way the app does, and at the end it reads what is on the show (income, payouts, crowd, stars, notes) and compares.
 * `ROADIE_EVAL=post-show` runs only those. `ROADIE_EVAL_DRY=1` runs them on the canned model to prove the seeding and
 * the checks work; it verifies nothing about Roadie.
 */
import { getChatFlow } from "../src/server/assistant/flow";
import { ensureThread, newMessageId, newThreadId } from "../src/server/assistant/threads";
import { modelLabel, modelMode } from "../src/server/assistant/ai";
import { newRunId, importCtx } from "../src/server/ctx";
import { db } from "../src/server/db";
import { registry } from "../src/server/commands/registry";
import { dateInBandZone } from "../src/lib/timezone";
import { addDays } from "../src/lib/shows";
import { adminAuth } from "../src/server/admin";
import { syncClaims } from "../src/server/session";
import type { AssistantAction, AssistantEvent, ToolTrace } from "../src/schema/assistant";
import { answerPending } from "../src/server/assistant/confirm";
import { loadHistory, saveTurn } from "../src/server/assistant/threads";
import { upsertEvents } from "../src/server/events/refresh";
import { checkRecorded, describe, POST_SHOW, recorded, seedWorld, type PostShowScenario, type ShowKey } from "./roadie-post-show";

interface Check { calls?: RegExp[]; noCalls?: RegExp[]; cards?: number; text?: RegExp; noText?: RegExp; noAsk?: boolean; args?: [RegExp, RegExp][]; noArgs?: [RegExp, RegExp][]; cardVoice?: boolean }
interface Turn extends Check { say: string; yes?: boolean }
interface Scenario { name: string; route?: string; voice?: boolean; turns: Turn[]; postShow?: PostShowScenario }

const SOFAR =
  "Add SoFar as a venue in Fort Collins and Denver and Colorado Springs\n\n" +
  "use this website for the one in fort collins: https://www.instagram.com/sofarfortcollins/\n\n" +
  "use this website for the one in denver: https://www.instagram.com/sofardenver/\n\n" +
  "and this one for Colorado Springs:\n\nhttps://www.instagram.com/sofarcoloradosprings/";
// A refusal, not the polite note about blanks ("I couldn't find a street address … Yes adds it as is").
const REFUSES = /\b(can't (?:add|do|help)|cannot (?:add|do)|unable to|I need (?:a|an|the|more)|required|without (?:a|the) (?:street )?address)\b/i;

// Dates without a year (#48): asked on 2026-10-26, "Saturday Dec 5" became 2025-12-05. Phrased from today, so they mean the same whenever the eval runs.
const TODAY = dateInBandZone();
let soon = addDays(TODAY, 36);
while (Number(soon.slice(8)) > 27) soon = addDays(soon, 1); // "the next day" stays in the month
const spoken = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
const SOON_SAID = `${spoken(soon, { weekday: "long" })} ${spoken(soon, { month: "short", day: "numeric" })}`; // "Saturday Dec 5"
const nth = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const JAN9 = `${Number(TODAY.slice(0, 4)) + (TODAY > `${TODAY.slice(0, 4)}-01-09` ? 1 : 0)}-01-09`;
const dateIs = (d: string) => new RegExp(`"date":"${d}"`);

const SCENARIOS: Scenario[] = [
  { name: "year-rehearsal", turns: [
    { say: `add a rehearsal on ${SOON_SAID}`, args: [[/rehearsals\.create/, dateIs(soon)]], cards: 0, noText: REFUSES },
    { say: `move it to the ${nth(Number(addDays(soon, 1).slice(8)))}`, args: [[/rehearsals\.update/, dateIs(addDays(soon, 1))]], cards: 0 },
  ] },
  { name: "year-next-january", turns: [{ say: "add a show at Pine Hollow on Jan 9", args: [[/shows\.create/, dateIs(JAN9)]], noText: REFUSES }] },
  { name: "sofar-three", turns: [{ say: SOFAR, calls: [/venues\.draft/, /venues\.draft/, /venues\.draft/, /venues\.create/, /venues\.create/, /venues\.create/], cards: 3, noAsk: true, noText: REFUSES }] },
  { name: "sofar-then-type", turns: [
    { say: "Add SoFar as a venue in Fort Collins. Their page is https://www.instagram.com/sofarfortcollins/", calls: [/venues\.draft/, /venues\.create/], cards: 1, noAsk: true },
    { say: "it's a listening room", noText: REFUSES },
  ] },
  { name: "solarium", turns: [{ say: "Add The Solarium in Fort Collins as a venue", calls: [/venues\.draft/, /venues\.create/], cards: 1, noAsk: true, noText: REFUSES }] },
  { name: "deli-type-unclear", turns: [{ say: "add Pelo's Deli in Longmont to our venues", calls: [/venues\.draft/, /venues\.create/], cards: 1, noText: REFUSES }] },
  { name: "instagram-only", turns: [{ say: "Add https://www.instagram.com/sofardenver/ as a venue in Denver", calls: [/venues\.draft/, /venues\.create/], noCalls: [/web\.read/], cards: 1, noText: REFUSES }] },
  { name: "no-city", turns: [{ say: "Add The Lariat as a venue", calls: [/venues\.draft/], noText: /\b(can't|cannot)\b/i }] },
  { name: "new-type", turns: [{ say: 'add a new venue type option called "supper club"', calls: [/venueTypes\.add/], noText: REFUSES }] },
  { name: "contact-add", turns: [{ say: "add Sam Rivera, sam@rivera.example, as a contact", calls: [/contacts\.create/], noText: REFUSES }] },
  { name: "expense", turns: [{ say: "log $12 for gas", calls: [/expenses\.add/], noText: REFUSES }] },
  { name: "stage-plot-group", turns: [{ say: "who still needs the new stage plot?", calls: [/tools\.load/, /stagePlots\.staleShows/], noText: REFUSES }] },
  // Money (#39). The eval band has Felix (a bandmate with a sign-in), the Band and Lighthouse video projects, and Friday's show at Pine Hollow (see seedMoney).
  { name: "money-we-owe-gas", turns: [{ say: "we owe Felix $42 for gas", calls: [/expenses\.add/], noCalls: [/payouts\./], noText: REFUSES }] },
  { name: "money-we-paid-felix", turns: [{ say: "we paid Felix $100 for Friday's show", calls: [/payouts\.add/], noCalls: [/expenses\.add/], noText: REFUSES }] },
  { name: "money-venue-owes", turns: [{ say: "Pine Hollow still owes us the $400 guarantee", calls: [/income\.add/], noCalls: [/setReceived/], cards: 1, noText: REFUSES }] },
  { name: "money-on-project", turns: [{ say: "put the $750 video shoot on the Lighthouse video project", calls: [/expenses\.add/], noAsk: true, noText: REFUSES }] },
  // Tours (#41). The eval band has the Mountain West tour (the 5th to the 11th of next month: one Saturday, one Sunday; money to Band), Velour in Provo (no pitch yet)
  // and a show at Kilby Court on the 7th that isn't on the tour (see seedTour).
  { name: "tour-velour", turns: [{ say: "add Velour for the 9th or 10th", calls: [/tours\.addPitch/], noText: REFUSES }] },
  { name: "tour-drive", turns: [{ say: "add a drive Saturday at 11", calls: [/tours\.entries\.add/], noText: REFUSES }] },
  { name: "tour-camping", turns: [{ say: "we're camping Sunday", calls: [/tours\.entries\.add/], noText: REFUSES }] },
  { name: "tour-how", turns: [{ say: "how's the tour doing?", calls: [/tours\.summary/], noText: REFUSES }] },
  { name: "tour-kilby", turns: [{ say: "put the Kilby show on Mountain West", calls: [/tours\.addShow/], noText: REFUSES }] },
  // Songs (#50): the card lists what moves, so the first ask is the card; no separate question before it.
  { name: "songs-merge-bliss", turns: [{ say: "merge the two Bliss songs", calls: [/songs\.merge/], cards: 1, noAsk: true, noText: REFUSES }] },
  // Voice (#67): spoken messages. The band has The Trident Bookstore (a venue) and one stage plot (see seedVoice).
  { name: "voice-income-card", voice: true, turns: [{ say: "Add $10 in income from The Trident Bookstore", calls: [/income\.add/], cards: 1, cardVoice: true, text: /^Want me to\b(?=[\s\S]*(?:\$10\b|\bten dollars\b))(?=[\s\S]*Trident)/i, noText: REFUSES }] },
  { name: "voice-short-reply", voice: true, turns: [{ say: "How much did we make last night?", noCalls: [/\.add$/], cards: 0, noText: /[*#`•\n]|^\s*(?:[-\d]+[.)])\s/m }] },
  { name: "voice-tap-only", voice: true, turns: [{ say: "turn on the engineer link for the stage plot", calls: [/stagePlots\.shareLink/], cards: 1, cardVoice: false, text: /\btap\b[\s\S]*\bYes\b|\bYes\b[\s\S]*\btap/i, noText: /^Want me to/i }] },
  ...POST_SHOW.map((p): Scenario => ({ name: p.name, turns: p.turns, postShow: p })),
  // Acts (#77). The Aggie (Fort Collins) and the Bluebird (Denver) have calendars: North Fork Crossing opens at both within two weeks (on tour),
  // Wheelwright headlines the Bluebird, The Brothers Comatose the Aggie (see seedActs).
  { name: "acts-tour", turns: [{ say: "which acts are on tour around here right now?", calls: [/acts\.find/], text: /North Fork Crossing/, noText: REFUSES }] },
  // #78: acts aren't in search, so the first lookup is acts.find; and a relationship or a note writes only that (in #77's run Roadie also shortlisted Wheelwright).
  { name: "acts-shortlist", turns: [{ say: "shortlist North Fork Crossing", calls: [/acts\.find/, /acts\.shortlist/], noCalls: [/^search$/], args: [[/acts\.shortlist/, /"on":true/]], noText: REFUSES }] },
  { name: "acts-watch", turns: [{ say: "watch Wheelwright", calls: [/acts\.find/, /acts\.shortlist/], noCalls: [/^search$/], args: [[/acts\.shortlist/, /"on":true/]], noText: REFUSES }] },
  { name: "acts-note", turns: [{ say: "Wheelwright is bigger than us, we'd love to open for them", calls: [/acts\.find/, /acts\.note/], noCalls: [/acts\.shortlist/, /^search$/], args: [[/acts\.note/, /"relationship":"openFor"/]], noArgs: [[/acts\.note/, /"note":"[^"]/]], noText: REFUSES }] },
  { name: "acts-note-text", turns: [{ say: "add a note on the act Morrow Morrow: great harmonies, super friendly crew", calls: [/acts\.find/, /acts\.note/], noCalls: [/acts\.shortlist/, /^search$/], args: [[/acts\.note/, /"note":"[^"]*harmonies/i]], noArgs: [[/acts\.note/, /"relationship"/]], noText: REFUSES }] },
  // #79: the band's own genres (General Settings) feed the opener guess's genre fit
  { name: "artist-genres", turns: [{ say: "our genres are americana and indie folk", calls: [/artists\.update/], noCalls: [/acts\./], args: [[/artists\.update/, /"genres":\["americana","indie folk"\]/]], noText: REFUSES }] },
  { name: "fact-check", turns: [{ say: "what's the capacity of the Grey Eagle in Asheville?", calls: [/web\.search|venues\.draft/], noText: /\b(can't|cannot)\b/i }] },
];

/** What the money scenarios talk about: Felix (a bandmate with a sign-in), the Band and Lighthouse video projects, Friday's show at Pine Hollow. */
async function seedMoney(artistId: string, slug: string) {
  const sys = importCtx("import", newRunId(), artistId);
  const email = `felix-${slug}@example.com`;
  const e = await adminAuth().createUser({ email, emailVerified: true, displayName: "Felix Brandt" });
  await db.create(sys, "users", { email, name: "Felix Brandt", artists: [{ artistId, role: "member" }] }, { id: e.uid });
  await db.create(sys, "musicians", { name: "Felix Brandt", instruments: ["drums"], active: true, userId: e.uid });
  await db.create(sys, "projects", { artistId, kind: "band", name: "Band", status: "open", isDefault: true });
  await db.create(sys, "projects", { artistId, kind: "video", name: "Lighthouse video", status: "open" });
  const v = (await registry["venues.create"].run(sys, registry["venues.create"].input.parse({ name: "Pine Hollow", type: "bar", address: { city: "Denver", state: "CO" }, region: "denver" }))) as { id: string };
  let friday = dateInBandZone();
  while (new Date(`${friday}T12:00:00Z`).getUTCDay() !== 5) friday = addDays(friday, 1);
  await registry["shows.create"].run(sys, registry["shows.create"].input.parse({ date: friday, venueId: v.id, status: "confirmed", times: { loadIn: "19:00", set: "21:00" } }));
}

/** What the tour scenarios talk about: the Mountain West tour next month, Velour (a venue, no pitch) and a Kilby Court show on the 7th not yet on the tour. */
async function seedTour(artistId: string) {
  const sys = importCtx("import", newRunId(), artistId);
  const call = async (name: string, input: unknown) => (await registry[name].run(sys, registry[name].input.parse(input))) as { id: string };
  const month = addDays(dateInBandZone().slice(0, 8) + "01", 40).slice(0, 8);
  const band = (await db.list("projects", (q) => q.where("artistId", "==", artistId))).find((p) => p.isDefault)!;
  await call("venues.create", { name: "Velour", type: "listening", address: { city: "Provo", state: "UT" }, region: "out" });
  const kilby = await call("venues.create", { name: "Kilby Court", type: "bar", address: { city: "Salt Lake City", state: "UT" }, region: "out" });
  await call("shows.create", { date: `${month}07`, venueId: kilby.id, status: "confirmed", times: { loadIn: "18:00", set: "20:30" } });
  await call("tours.create", { name: "Mountain West", projectId: band.id, startDate: `${month}05`, endDate: `${month}11` });
}

/** Duplicates (#50): The Bliss twice (Playing and Learning, the learning copy with a link and a setlist spot), and a different song. */
async function seedSongs(artistId: string) {
  const sys = importCtx("import", newRunId(), artistId);
  const call = async (name: string, input: unknown) => (await registry[name].run(sys, registry[name].input.parse(input))) as { id: string };
  await call("songs.create", { title: "The Bliss", status: "active", key: "Em", lengthSec: 214 });
  const learning = await call("songs.create", { title: "The Bliss", status: "learning", files: [{ url: "https://open.spotify.com/track/bliss", title: "Bliss demo" }] });
  await call("songs.create", { title: "Glass Coast", status: "active", key: "A", lengthSec: 232 });
  await call("setlistTemplates.create", { name: "Club set", items: [{ type: "song", songId: learning.id }] });
}

/** Voice (#67): The Trident Bookstore as a venue, and one stage plot for the engineer-link ask. */
async function seedVoice(artistId: string) {
  const sys = importCtx("import", newRunId(), artistId);
  const call = async (name: string, input: unknown) => (await registry[name].run(sys, registry[name].input.parse(input))) as { id: string };
  await call("venues.create", { name: "The Trident Bookstore", type: "listening", address: { city: "Boulder", state: "CO" }, region: "denver" });
  await call("stagePlots.create", { name: "Full band" });
}

/** Acts (#77): two Colorado rooms whose calendars list linked acts (upsertEvents links them and makes the acts, as a refresh does). */
async function seedActs(artistId: string) {
  const sys = importCtx("import", newRunId(), artistId);
  const call = async (name: string, input: unknown) => (await registry[name].run(sys, registry[name].input.parse(input))) as { id: string };
  const aggie = await call("venues.create", { name: "Aggie Theatre", type: "bar", address: { city: "Fort Collins", state: "CO" }, region: "north" });
  const bluebird = await call("venues.create", { name: "Bluebird Theater", type: "bar", address: { city: "Denver", state: "CO" }, region: "denver" });
  const ev = (days: number, acts: [string, "headliner" | "support"][]) => ({
    sourceId: `${days}-${acts[0][0]}`, date: addDays(TODAY, days), title: acts.map((a) => a[0]).join(", "), acts: acts.map(([name, role]) => ({ name, role })), bill: "full" as const, status: "onsale" as const,
  });
  const now = new Date();
  await upsertEvents(aggie.id, "ics", [ev(5, [["The Brothers Comatose", "headliner"], ["North Fork Crossing", "support"]])], now, "America/Denver");
  await upsertEvents(bluebird.id, "ics", [ev(12, [["Wheelwright", "headliner"], ["North Fork Crossing", "support"]]), ev(30, [["Morrow Morrow", "headliner"]])], now, "America/Denver");
}

async function band() {
  const slug = `eval-${Date.now().toString(36)}`;
  const sys = importCtx();
  const artist = await db.create(sys, "artists", { slug, name: `Eval band ${slug}`, driveFolderId: "", links: {}, configurations: [] }, { id: slug });
  const email = `${slug}@example.com`;
  const u = await adminAuth().createUser({ email, emailVerified: true, displayName: "Eval admin" });
  await db.create(sys, "users", { email, name: "Eval admin", artists: [{ artistId: artist.id, role: "admin" }] }, { id: u.uid });
  await syncClaims(u.uid);
  await seedMoney(artist.id, slug);
  await seedTour(artist.id);
  await seedSongs(artist.id);
  await seedVoice(artist.id);
  await seedActs(artist.id);
  return { uid: u.uid, artistId: artist.id };
}

/** A post-show conversation's own band: an admin, a member with a sign-in (Theo, the drummer in the "payouts" world), and the world's shows. */
let worlds = 0;
async function world(p: PostShowScenario) {
  const slug = `eval-${Date.now().toString(36)}-${++worlds}`;
  const sys = importCtx();
  const artist = await db.create(sys, "artists", { slug, name: `Eval band ${slug}`, driveFolderId: "", links: {}, configurations: [] }, { id: slug });
  const user = async (email: string, name: string, role: "admin" | "member") => {
    const u = await adminAuth().createUser({ email, emailVerified: true, displayName: name });
    await db.create(sys, "users", { email, name, artists: [{ artistId: artist.id, role, mcpAccess: false }] }, { id: u.uid });
    return u;
  };
  const admin = await user(`${slug}@example.com`, "Eval admin", "admin");
  await syncClaims(admin.uid);
  const theo = await user(`theo-${slug}@example.com`, "Theo Park", "member");
  return { uid: admin.uid, artistId: artist.id, shows: await seedWorld(p.world, artist.id, theo) };
}

async function runScenario(sc: Scenario, shared: { uid: string; artistId: string } | undefined) {
  const flow = await getChatFlow();
  const threadId = newThreadId();
  const post = sc.postShow;
  const w = post ? await world(post) : undefined;
  const who = w ?? shared!;
  const here: ShowKey = post?.expect.show ?? "tonight";
  // Home is where "Hey Siri, tell Roadie about tonight" lands; the show page names the show; two shows today has no one page.
  const pageContext = !post ? { route: sc.route ?? "bookingVenues" }
    : post.page === "home" ? { route: "calendar" }
    : { route: post.page === "after" ? "showAfter" : "show", recordKind: post.page === "after" ? "showAfter" : "show", recordId: w!.shows[here]! };
  await ensureThread({ uid: who.uid, threadId, pageContext, at: new Date() });
  let history: { role: "user" | "assistant"; text: string }[] = [];
  const failures: string[] = [];
  for (const [n, t] of sc.turns.entries()) {
    const session = { uid: who.uid, role: "admin" as const, artistId: who.artistId, name: "Eval admin", threadId, runId: newRunId(), replyId: newMessageId(), ...(sc.voice ? { voice: true } : {}) };
    const { stream, output } = flow.stream({ message: t.say, history, pageContext, session });
    for await (const _ of stream as AsyncIterable<AssistantEvent>) { /* drain */ }
    const out = (await output) as { text: string; actions: AssistantAction[]; failed?: boolean; trace?: ToolTrace[] };
    const trace = out.trace ?? [];
    const names = trace.map((x) => x.name);
    const cards = out.actions.filter((a) => a.kind === "confirm").length;
    const asks = out.actions.filter((a) => a.kind === "reply").length;
    const where = `turn ${n + 1}`;
    if (out.failed) failures.push(`${where}: the model call failed`);
    let at = 0;
    for (const re of t.calls ?? []) { const i = names.findIndex((x, k) => k >= at && re.test(x)); if (i < 0) failures.push(`${where}: expected a call ${re} (calls: ${names.join(", ") || "none"})`); else at = i + 1; }
    for (const re of t.noCalls ?? []) if (names.some((x) => re.test(x))) failures.push(`${where}: unexpected call ${re}`);
    for (const [re, arg] of t.args ?? []) {
      const tried = trace.filter((x) => re.test(x.name));
      if (!tried.some((x) => arg.test(x.input))) failures.push(`${where}: expected ${re} with ${arg} (got: ${tried.map((x) => x.input).join(" | ") || "no call"})`);
    }
    for (const [re, arg] of t.noArgs ?? []) {
      const hit = trace.find((x) => re.test(x.name) && arg.test(x.input));
      if (hit) failures.push(`${where}: unexpected ${re} with ${arg} (${hit.input.slice(0, 200)})`);
    }
    if (t.cards !== undefined && cards !== t.cards) failures.push(`${where}: ${cards} card(s), expected ${t.cards}`);
    if (t.cardVoice !== undefined && out.actions.some((a) => a.kind === "confirm" && !!a.voice !== t.cardVoice)) failures.push(`${where}: a card ${t.cardVoice ? "lacks" : "has"} voice: true`);
    if (t.noAsk && asks) failures.push(`${where}: asked with buttons instead of acting`);
    if (t.text && !t.text.test(out.text)) failures.push(`${where}: reply doesn't match ${t.text}`);
    if (t.noText && t.noText.test(out.text)) failures.push(`${where}: reply matches ${t.noText}: "${out.text.slice(0, 160)}"`);
    const bad = trace.filter((x) => !x.ok).map((x) => `${x.name}: ${x.error}`);
    console.log(`  ${where}: "${t.say.slice(0, 60).replace(/\n/g, " ")}"\n    calls: ${names.join(", ") || "none"}${bad.length ? `\n    errors: ${bad.join(" | ")}` : ""}\n    cards: ${cards}, asks: ${asks}\n    reply: ${out.text.replace(/\n/g, " ").slice(0, 300)}`);
    if (!post) { history.push({ role: "user", text: t.say }, { role: "assistant", text: out.text || out.actions.map((a) => a.label).join(". ") }); continue; }
    // As the app does: the turn is saved to the thread, she taps Yes on each card, and the next turn's history is read back from the thread.
    for (const x of trace) if (/^(income|payouts|shows\.afterShow)/.test(x.name)) console.log(`    ${x.name} ${x.input}`);
    for (const a of out.actions) if (a.kind === "confirm") console.log(`    card: ${a.label}`);
    for (const a of out.actions) if (a.kind === "readback") console.log(`    wrote: ${a.label}`);
    await saveTurn({ threadId, replyId: session.replyId, pageContext, userText: t.say, replyText: out.text, actions: out.actions, userAt: new Date(), failed: !!out.failed, trace });
    if (t.yes !== false) {
      for (const a of out.actions) {
        if (a.kind !== "confirm" || !a.pendingId) continue;
        try {
          const r = await answerPending({ uid: who.uid, role: "admin", artistId: who.artistId, name: "Eval admin" }, { threadId, pendingId: a.pendingId, decision: "yes" });
          if (r.status !== "done") failures.push(`${where}: Yes on "${a.label}" ${r.status}${r.status === "failed" ? `: ${r.message}` : ""}`);
        } catch (e) { failures.push(`${where}: Yes on "${a.label}" threw: ${(e as Error).message}`); }
      }
    }
    history = ((await loadHistory(who.uid, threadId)) ?? []) as typeof history;
  }
  if (post && w) {
    const rec = await recorded(w.artistId, w.shows);
    console.log(`  recorded:\n    ${describe(rec, w.shows).join("\n    ")}`);
    failures.push(...checkRecorded(post.expect, rec, w.shows).map((f) => `end: ${f}`));
  }
  return failures;
}

(async () => {
  const dry = process.env.ROADIE_EVAL_DRY === "1";
  if (modelMode() === "fake" && !dry) { console.error("ROADIE_MODEL is fake: set ROADIE_MODEL=vertex (or gemini with GEMINI_API_KEY)."); process.exit(2); }
  const only = process.argv.slice(2);
  const picked = only.length === 1 && only[0] === "post-show" ? SCENARIOS.filter((s) => s.postShow) : only.length ? SCENARIOS.filter((s) => only.includes(s.name)) : SCENARIOS;
  console.log(`Roadie eval: ${picked.length} scenario(s) on ${modelLabel()} (${modelMode()})${dry ? " DRY RUN on the canned model: this checks the harness, not Roadie" : ""}`);
  const who = picked.some((s) => !s.postShow) ? await band() : undefined;
  const results: [string, string[]][] = [];
  for (const sc of picked) {
    console.log(`\n${sc.name}`);
    try { results.push([sc.name, await runScenario(sc, who)]); } catch (e) { results.push([sc.name, [`threw: ${(e as Error).message}`]]); }
  }
  console.log("\n==== results");
  let failed = 0;
  for (const [name, f] of results) { if (f.length) failed++; console.log(`${f.length ? "FAIL" : "ok  "} ${name}${f.length ? `\n     ${f.join("\n     ")}` : ""}`); }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
