/**
 * `npm run eval:roadie` (or `ROADIE_EVAL="sofar-three atrium" npm run eval:roadie`): run real conversations through Roadie's
 * flow against the REAL model (Vertex through the service-account key in .secrets, billed to roadie-prod-iab; no login)
 * and the real web, with a throwaway band in its own emulator run (nothing of yours needs to be up),
 * and check what it did: which tools it called, whether it made cards, whether it asked instead of acting. The unit tests
 * use the canned model and prove the plumbing; this proves the model behaves. Each run makes a throwaway band, so your
 * emulator data is untouched (the eval band stays; wipe it with `npm run wipe` whenever).
 *
 * A scenario is a list of turns. Each turn's checks: `calls` (tool names that must appear, in order, as regexes),
 * `noCalls`, `cards` (how many confirm cards), `text` / `noText` (regexes on the reply), `noAsk` (no ui.ask buttons).
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

interface Check { calls?: RegExp[]; noCalls?: RegExp[]; cards?: number; text?: RegExp; noText?: RegExp; noAsk?: boolean }
interface Turn extends Check { say: string }
interface Scenario { name: string; route?: string; turns: Turn[] }

const SOFAR =
  "Add SoFar as a venue in Fort Collins and Denver and Colorado Springs\n\n" +
  "use this website for the one in fort collins: https://www.instagram.com/sofarfortcollins/\n\n" +
  "use this website for the one in denver: https://www.instagram.com/sofardenver/\n\n" +
  "and this one for Colorado Springs:\n\nhttps://www.instagram.com/sofarcoloradosprings/";
// A refusal, not the polite note about blanks ("I couldn't find a street address … Yes adds it as is").
const REFUSES = /\b(can't (?:add|do|help)|cannot (?:add|do)|unable to|I need (?:a|an|the|more)|required|without (?:a|the) (?:street )?address)\b/i;

const SCENARIOS: Scenario[] = [
  { name: "sofar-three", turns: [{ say: SOFAR, calls: [/venues\.draft/, /venues\.draft/, /venues\.draft/, /venues\.create/, /venues\.create/, /venues\.create/], cards: 3, noAsk: true, noText: REFUSES }] },
  { name: "sofar-then-type", turns: [
    { say: "Add SoFar as a venue in Fort Collins. Their page is https://www.instagram.com/sofarfortcollins/", calls: [/venues\.draft/, /venues\.create/], cards: 1, noAsk: true },
    { say: "it's a listening room", noText: REFUSES },
  ] },
  { name: "atrium", turns: [{ say: "Add The Atrium in Fort Collins as a venue", calls: [/venues\.draft/, /venues\.create/], cards: 1, noAsk: true, noText: REFUSES }] },
  { name: "deli-type-unclear", turns: [{ say: "add Pelo's Deli in Longmont to our venues", calls: [/venues\.draft/, /venues\.create/], cards: 1, noText: REFUSES }] },
  { name: "instagram-only", turns: [{ say: "Add https://www.instagram.com/sofardenver/ as a venue in Denver", calls: [/venues\.draft/, /venues\.create/], noCalls: [/web\.read/], cards: 1, noText: REFUSES }] },
  { name: "no-city", turns: [{ say: "Add The Lariat as a venue", calls: [/venues\.draft/], noText: /\b(can't|cannot)\b/i }] },
  { name: "new-type", turns: [{ say: 'add a new venue type option called "supper club"', calls: [/venueTypes\.add/], noText: REFUSES }] },
  { name: "expense", turns: [{ say: "log $12 for gas", calls: [/expenses\.add/], noText: REFUSES }] },
  { name: "stage-plot-group", turns: [{ say: "who still needs the new stage plot?", calls: [/tools\.load/, /stagePlots\.staleShows/], noText: REFUSES }] },
  // Money (#39). The eval band has Eric (a bandmate with a sign-in), the Band and Lighthouse video projects, and Friday's show at Lost Lake (see seedMoney).
  { name: "money-we-owe-gas", turns: [{ say: "we owe Eric $42 for gas", calls: [/expenses\.add/], noCalls: [/payouts\./], noText: REFUSES }] },
  { name: "money-we-paid-eric", turns: [{ say: "we paid Eric $100 for Friday's show", calls: [/payouts\.add/], noCalls: [/expenses\.add/], noText: REFUSES }] },
  { name: "money-venue-owes", turns: [{ say: "Lost Lake still owes us the $400 guarantee", calls: [/income\.add/], noCalls: [/setReceived/], cards: 1, noText: REFUSES }] },
  { name: "money-on-project", turns: [{ say: "put the $750 video shoot on the Lighthouse video project", calls: [/expenses\.add/], noAsk: true, noText: REFUSES }] },
  // Tours (#41). The eval band has the Mountain West tour (the 5th to the 11th of next month: one Saturday, one Sunday; money to Band), Velour in Provo (no pitch yet)
  // and a show at Kilby Court on the 7th that isn't on the tour (see seedTour).
  { name: "tour-velour", turns: [{ say: "add Velour for the 9th or 10th", calls: [/tours\.addPitch/], noText: REFUSES }] },
  { name: "tour-drive", turns: [{ say: "add a drive Saturday at 11", calls: [/tours\.entries\.add/], noText: REFUSES }] },
  { name: "tour-camping", turns: [{ say: "we're camping Sunday", calls: [/tours\.entries\.add/], noText: REFUSES }] },
  { name: "tour-how", turns: [{ say: "how's the tour doing?", calls: [/tours\.summary/], noText: REFUSES }] },
  { name: "tour-kilby", turns: [{ say: "put the Kilby show on Mountain West", calls: [/tours\.addShow/], noText: REFUSES }] },
  { name: "fact-check", turns: [{ say: "what's the capacity of the Grey Eagle in Asheville?", calls: [/web\.search|venues\.draft/], noText: /\b(can't|cannot)\b/i }] },
];

/** What the money scenarios talk about: Eric (a bandmate with a sign-in), the Band and Lighthouse video projects, Friday's show at Lost Lake. */
async function seedMoney(artistId: string, slug: string) {
  const sys = importCtx("import", newRunId(), artistId);
  const email = `eric-${slug}@example.com`;
  const e = await adminAuth().createUser({ email, emailVerified: true, displayName: "Eric Garcia" });
  await db.create(sys, "users", { email, name: "Eric Garcia", artists: [{ artistId, role: "member" }], mcpAccess: false }, { id: e.uid });
  await db.create(sys, "musicians", { name: "Eric Garcia", instruments: ["drums"], active: true, userId: e.uid });
  await db.create(sys, "projects", { artistId, kind: "band", name: "Band", status: "open", isDefault: true });
  await db.create(sys, "projects", { artistId, kind: "video", name: "Lighthouse video", status: "open" });
  const v = (await registry["venues.create"].run(sys, registry["venues.create"].input.parse({ name: "Lost Lake", type: "bar", address: { city: "Denver", state: "CO" }, region: "denver" }))) as { id: string };
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

async function band() {
  const slug = `eval-${Date.now().toString(36)}`;
  const sys = importCtx();
  const artist = await db.create(sys, "artists", { slug, name: `Eval band ${slug}`, driveFolderId: "", links: {}, configurations: [] }, { id: slug });
  const email = `${slug}@example.com`;
  const u = await adminAuth().createUser({ email, emailVerified: true, displayName: "Eval admin" });
  await db.create(sys, "users", { email, name: "Eval admin", artists: [{ artistId: artist.id, role: "admin" }], mcpAccess: false }, { id: u.uid });
  await syncClaims(u.uid);
  await seedMoney(artist.id, slug);
  await seedTour(artist.id);
  return { uid: u.uid, artistId: artist.id };
}

async function runScenario(sc: Scenario, who: { uid: string; artistId: string }) {
  const flow = await getChatFlow();
  const threadId = newThreadId();
  const pageContext = { route: sc.route ?? "bookingVenues" };
  await ensureThread({ uid: who.uid, threadId, pageContext, at: new Date() });
  const history: { role: "user" | "assistant"; text: string }[] = [];
  const failures: string[] = [];
  for (const [n, t] of sc.turns.entries()) {
    const session = { uid: who.uid, role: "admin" as const, artistId: who.artistId, name: "Eval admin", threadId, runId: newRunId(), replyId: newMessageId() };
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
    if (t.cards !== undefined && cards !== t.cards) failures.push(`${where}: ${cards} card(s), expected ${t.cards}`);
    if (t.noAsk && asks) failures.push(`${where}: asked with buttons instead of acting`);
    if (t.text && !t.text.test(out.text)) failures.push(`${where}: reply doesn't match ${t.text}`);
    if (t.noText && t.noText.test(out.text)) failures.push(`${where}: reply matches ${t.noText}: "${out.text.slice(0, 160)}"`);
    const bad = trace.filter((x) => !x.ok).map((x) => `${x.name}: ${x.error}`);
    console.log(`  ${where}: "${t.say.slice(0, 60).replace(/\n/g, " ")}"\n    calls: ${names.join(", ") || "none"}${bad.length ? `\n    errors: ${bad.join(" | ")}` : ""}\n    cards: ${cards}, asks: ${asks}\n    reply: ${out.text.replace(/\n/g, " ").slice(0, 300)}`);
    history.push({ role: "user", text: t.say }, { role: "assistant", text: out.text || out.actions.map((a) => a.label).join(". ") });
  }
  return failures;
}

(async () => {
  if (modelMode() === "fake") { console.error("ROADIE_MODEL is fake: set ROADIE_MODEL=vertex (or gemini with GEMINI_API_KEY)."); process.exit(2); }
  const only = process.argv.slice(2);
  const picked = only.length ? SCENARIOS.filter((s) => only.includes(s.name)) : SCENARIOS;
  console.log(`Roadie eval: ${picked.length} scenario(s) on ${modelLabel()} (${modelMode()})`);
  const who = await band();
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
