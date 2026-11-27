/**
 * Tenancy smoke check (plan "How a phase ships"): read-only, against the project in GCLOUD_PROJECT.
 *
 *   GCLOUD_PROJECT=roadie-prod-iab GOOGLE_APPLICATION_CREDENTIALS=.secrets/<key>.json \
 *     npx tsx scripts/tenancy-smoke.ts --artist GCriQfutv2qbgjBrTaNb [--baseline <phase-3 dry run .md>]
 *
 * 1. Counts every artist kind's records per artist (sub-collections by collection group). Fails on a record with no artistId:
 *    from phase 4 such a record is invisible to everyone (fail closed).
 * 2. With --baseline, fails if a count for --artist is below the phase-3 dry run's (the band keeps adding records, so counts
 *    only grow).
 * 3. As --artist's admin (an ArtistCtx, through the commands themselves), runs records.list for every readable kind, shows.list,
 *    people.list, tours.list, stagePlots.list, checklistTemplates.list and invites.pending. Fails if any result holds another
 *    artist's record, or if records.list's count for an artist kind differs from the raw count of that artist's live records.
 *
 * 4. With --rules, the browser side (firestore.rules, plan D6): signs in through the client SDK as the dedicated `tenancy-smoke` uid,
 *    with a custom token carrying --artist's claims (once as admin, once as member), and runs the query shapes the hooks send
 *    (src/lib/client-scope.ts): one per artist kind with a rule, `users` by artistIds, the Activity page's two History listeners and
 *    the members' own-records filters. Every one must be allowed; the same ones for a made-up artist id must be denied. Browser
 *    permission errors never reach Cloud Logging, so this is the check. Reads at most a few documents per query; writes nothing
 *    (signing in creates the `tenancy-smoke` Auth user the first time; it has no users doc, so the app never lets it in).
 *
 * Writes nothing to Firestore.
 */
import { layout } from "@/server/layout";
import { inLayout, movesUnderArtist, physicalPath, splitPath } from "@/schema/owners";
import fs from "node:fs";
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import {
  collection, collectionGroup, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, terminate, where,
  type Firestore as ClientDb, type QueryConstraint,
} from "firebase/firestore";
import { adminAuth } from "@/server/admin";
import { firestore } from "@/server/admin";
import { artistCtx, type Ctx } from "@/server/ctx";
import { registry } from "@/server/commands/registry";
import { OWNERS, ownerOf } from "@/schema/owners";
import { roleIn } from "@/schema/users";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const ARTIST_KINDS = Object.keys(OWNERS).filter((k) => ownerOf(k) === "artist");
const SUBS = new Set(["comments", "activity", "entries", "tracks"]);

/** "| kind | N (all) | to stamp | via |" rows of the phase-3 dry run: kind -> count for the artist. */
function baselineFrom(file: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\|\s*(\w+)\s*\|\s*(\d+)\s*\|/.exec(line);
    if (m && ownerOf(m[1]) === "artist") out[m[1]] = Number(m[2]);
  }
  return out;
}

/** Every `id` anywhere in a command's result (rows, nested lists). */
function idsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) idsIn(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "id" || k === "userId" || k === "musicianId") && typeof x === "string") out.add(x);
      else idsIn(x, out);
    }
  }
  return out;
}

async function main() {
  const named = arg("artist");
  if (!named) throw new Error("--artist <id or slug> is required");
  const project = process.env.GCLOUD_PROJECT;
  if (!project && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Set GCLOUD_PROJECT (and GOOGLE_APPLICATION_CREDENTIALS for prod)");
  console.log(`tenancy smoke: ${process.env.FIRESTORE_EMULATOR_HOST ? `emulator ${process.env.FIRESTORE_EMULATOR_HOST}` : project}, artist ${named}`);
  const db = firestore();
  // Phase 10: artist data top level or under artists/{id}/… (platform/config.nestedPaths); every path below follows it.
  const { nestedPaths: nested } = await layout();
  console.log(`artist data: ${nested ? "nested under artists/{id}" : "top level"}`);
  const fails: string[] = [];
  const artist = (await db.doc(`artists/${named}`).get()).exists ? named : (await db.collection("artists").where("slug", "==", named).limit(1).get()).docs[0]?.id;
  if (!artist) throw new Error(`no artist ${named}`);

  // 1. Counts per kind per artist, and every record's owner by path.
  const ownerOfId = new Map<string, string>(); // "kind/id" -> artistId
  const live: Record<string, number> = {}, counts: Record<string, Record<string, number>> = {};
  for (const kind of ARTIST_KINDS) {
    const group = SUBS.has(kind) || (nested && movesUnderArtist(kind));
    const snap = group ? await db.collectionGroup(kind).get() : await db.collection(kind).get();
    const per = (counts[kind] = {} as Record<string, number>);
    for (const d of snap.docs.filter((x) => inLayout(x.ref.path) && (SUBS.has(kind) || splitPath(x.ref.parent.path).logical === kind))) {
      if (kind === "comments" || kind === "activity") { if (!["shows", "pitches"].includes(d.ref.parent.parent?.parent.id ?? "")) continue; }
      if (nested && splitPath(d.ref.path).artistId && splitPath(d.ref.path).artistId !== d.get("artistId")) fails.push(`${d.ref.path}: artistId ${d.get("artistId")} under another artist`);
      const a = d.get("artistId");
      if (typeof a !== "string" || !a) { fails.push(`${d.ref.path}: no artistId`); continue; }
      per[a] = (per[a] ?? 0) + 1;
      ownerOfId.set(`${kind}/${d.id}`, a);
      if (a === artist && !d.get("deletedAt")) live[kind] = (live[kind] ?? 0) + 1;
    }
  }
  console.log("\nrecords per kind and artist:");
  for (const [k, per] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} ${Object.entries(per).map(([a, n]) => `${a}=${n}`).join("  ") || "-"}`);

  // 2. Never fewer than the phase-3 dry run.
  const base = arg("baseline");
  if (base) {
    for (const [k, n] of Object.entries(baselineFrom(base))) {
      const now = counts[k]?.[artist] ?? 0;
      if (now < n) fails.push(`${k}: ${now} records now, ${n} in the phase-3 dry run`);
    }
    console.log(`\ncompared with the phase-3 dry run (${base})`);
  }

  // 3. The commands, as the artist's admin.
  const users = await db.collection("users").where("artistIds", "array-contains", artist).get();
  const admin = users.docs.find((u) => !u.get("deletedAt") && roleIn(u.data(), artist) === "admin");
  if (!admin) throw new Error(`no live admin in ${artist}`);
  const mine = (kind: string, id: string) => { const a = ownerOfId.get(`${kind}/${id}`); return a === undefined || a === artist; };
  const foreignIds = new Set([...ownerOfId].filter(([, a]) => a !== artist).map(([k]) => k.split("/")[1]));
  const ctx = (): Ctx => artistCtx({ uid: admin.id, role: "admin", artistId: artist, via: "import" });
  const call = async (name: string, input: unknown) => registry[name].run(ctx(), registry[name].input.parse(input));

  const READABLE = (registry["records.list"].input as unknown as { shape: { kind: { options: string[] } } }).shape.kind.options;
  for (const kind of READABLE) {
    const r = (await call("records.list", { kind, limit: 200 })) as { count: number; rows: { id: string }[] };
    const bad = r.rows.filter((x) => !mine(kind, x.id));
    if (bad.length) fails.push(`records.list ${kind}: ${bad.length} rows of another artist (${bad.slice(0, 3).map((x) => x.id).join(", ")})`);
    if (ownerOf(kind) === "artist" && r.count !== (live[kind] ?? 0)) fails.push(`records.list ${kind}: count ${r.count}, but ${artist} has ${live[kind] ?? 0} live records`);
    console.log(`  records.list ${kind.padEnd(18)} ${r.count}`);
  }
  for (const [name, input] of [["shows.list", {}], ["people.list", {}], ["tours.list", {}], ["stagePlots.list", {}], ["checklistTemplates.list", {}], ["invites.pending", {}]] as const) {
    const ids = idsIn(await call(name, input));
    const bad = [...ids].filter((id) => foreignIds.has(id));
    if (bad.length) fails.push(`${name}: ids of another artist (${bad.slice(0, 3).join(", ")})`);
    console.log(`  ${name.padEnd(30)} ${ids.size} ids`);
  }

  if (process.argv.includes("--rules")) await rulesCheck(artist, db, fails);

  if (fails.length) {
    console.error(`\nFAILED (${fails.length}):\n${fails.slice(0, 50).join("\n")}`);
    process.exit(1);
  }
  console.log("\nOK: no record without an artist, no other artist's record in any result, counts match.");
}

/** The web app's public Firebase config: NEXT_PUBLIC_* from the environment, else apphosting.yaml (the prod web app). */
function webConfig() {
  const yaml = fs.existsSync("apphosting.yaml") ? fs.readFileSync("apphosting.yaml", "utf8") : "";
  const val = (name: string) => process.env[name] ?? new RegExp(`variable: ${name}\\s*\\n\\s*value: "?([^"\\n]+)"?`).exec(yaml)?.[1];
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  return {
    apiKey: emulator ? "demo-key" : val("NEXT_PUBLIC_FIREBASE_API_KEY"),
    projectId: emulator ? (process.env.GCLOUD_PROJECT ?? "demo-band-tracker") : val("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    appId: emulator ? "demo-app" : val("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };
}

const SMOKE_UID = "tenancy-smoke";
const NOBODY = "tenancy-smoke-no-such-artist";
/**
 * Artist kinds the browser never lists or gets with an artist filter: server-only (invites, Shortcut tokens, the website, read and
 * written through the site.* commands), owner-only, or keyed by the artist id.
 */
const NOT_LISTED = new Set(["invites", "shortcutTokens", "mcpTokens", "assistantThreads", "socialChecklists", "sites", "sitePages", "siteSources", "siteAssets", "siteVersions"]);
/** Kinds every member reads (live). */
const MEMBER_KINDS = ["shows", "tours", "projects", "songs", "files", "setlists", "setlistTemplates", "rehearsals", "stagePlots", "musicians"];

/** A client Firestore signed in as the smoke uid with these claims (a custom token: the claims live only in its ID token). */
async function signedIn(name: string, claims: Record<string, unknown>): Promise<{ app: FirebaseApp; c: ClientDb }> {
  const app = initializeApp(webConfig(), `tenancy-smoke-${name}`);
  const auth = getAuth(app);
  const c = getFirestore(app);
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  if (process.env.FIRESTORE_EMULATOR_HOST) { const [h, p] = process.env.FIRESTORE_EMULATOR_HOST.split(":"); connectFirestoreEmulator(c, h, Number(p)); }
  await signInWithCustomToken(auth, await adminAuth().createCustomToken(SMOKE_UID, claims));
  return { app, c };
}

/** Runs the browser's query shapes as --artist's admin and member, and the same shapes for an artist they aren't in. */
async function rulesCheck(artist: string, adminDb: ReturnType<typeof firestore>, fails: string[]) {
  const { nestedPaths: nested } = await layout();
  console.log("\nbrowser reads through firestore.rules (client SDK, uid tenancy-smoke):");
  const musician = `${SMOKE_UID}-musician`;
  const admin = await signedIn("admin", { artists: { [artist]: "admin" }, adminOf: [artist], musicians: {} });
  const member = await signedIn("member", { artists: { [artist]: "member" }, adminOf: [], musicians: { [artist]: musician } });
  let allowed = 0, denied = 0;
  const run = async (label: string, want: "allow" | "deny", read: () => Promise<unknown>) => {
    const ok = await read().then(() => true, (e: { code?: string }) => {
      if (e?.code !== "permission-denied") fails.push(`${label}: ${e?.code ?? e}`);
      return false;
    });
    if (ok !== (want === "allow")) fails.push(`${label}: ${ok ? "allowed" : "denied"}, expected ${want === "allow" ? "allowed" : "denied"}`);
    else if (ok) allowed++; else denied++;
  };
  /** The collection a kind is listed from: its own name, or one of --artist's parents for a sub-collection. */
  const parentOf = async (kind: string): Promise<string | null> => {
    const parentKind = ({ comments: "shows", entries: "tours", activity: "pitches", tracks: "releases" } as Record<string, string>)[kind];
    if (!parentKind) return kind;
    const p = (await adminDb.collection(physicalPath(parentKind, artist)).where("artistId", "==", artist).limit(1).get()).docs[0];
    return p ? `${parentKind}/${p.id}/${kind}` : null;
  };
  /** A list as the hooks send it, for `artistId`: in the nested layout under that artist's own path. */
  const list = (c: ClientDb, path: string, artistId: string, ...w: QueryConstraint[]) =>
    getDocs(query(collection(c, physicalPath(path, artistId)), where("artistId", "==", artistId), ...w, where("deletedAt", "==", null), limit(3)));

  for (const kind of Object.keys(OWNERS).filter((k) => ownerOf(k) === "artist" && !NOT_LISTED.has(k))) {
    const path = await parentOf(kind);
    if (!path) { console.log(`  ${kind.padEnd(18)} skipped: ${artist} has no parent record`); continue; }
    const extra = kind === "entries" ? [where("visibility", "==", "band")] : kind === "comments" ? [where("audience", "==", "band")] : [];
    await run(`admin lists ${path}`, "allow", () => list(admin.c, path, artist));
    await run(`admin lists ${path} of another artist`, "deny", () => list(admin.c, path, NOBODY));
    if (MEMBER_KINDS.includes(kind) || kind === "entries" || kind === "comments") {
      await run(`member lists ${path}`, "allow", () => list(member.c, path, artist, ...extra));
      await run(`member lists ${path} of another artist`, "deny", () => list(member.c, path, NOBODY, ...extra));
    } else if (!["expenses", "availability", "payouts"].includes(kind)) {
      await run(`member lists ${path} (admins only)`, "deny", () => list(member.c, path, artist, ...extra));
    }
  }
  // Tracks across releases (the song page), as a collection group.
  await run("admin lists tracks (group)", "allow", () => getDocs(query(collectionGroup(admin.c, "tracks"), where("artistId", "==", artist), where("deletedAt", "==", null), limit(3))));
  await run("admin lists tracks (group) of another artist", "deny", () => getDocs(query(collectionGroup(admin.c, "tracks"), where("artistId", "==", NOBODY), where("deletedAt", "==", null), limit(3))));
  // Members' own records.
  for (const [label, kind, w] of [
    ["expenses by userId", "expenses", where("userId", "==", SMOKE_UID)],
    ["availability by musician", "availability", where("askedMusicianIds", "array-contains", musician)],
    ["payouts by to.userId", "payouts", where("to.userId", "==", SMOKE_UID)],
    ["payouts by to.musicianId", "payouts", where("to.musicianId", "==", musician)],
  ] as const) {
    await run(`member lists ${label}`, "allow", () => list(member.c, kind, artist, w));
    await run(`member lists ${label} of another artist`, "deny", () => list(member.c, kind, NOBODY, w));
    await run(`member lists all ${kind} (not only their own)`, "deny", () => list(member.c, kind, artist));
  }
  // People.
  const people = (c: ClientDb, a: string) => getDocs(query(collection(c, "users"), where("artistIds", "array-contains", a), where("deletedAt", "==", null), limit(3)));
  await run("admin lists users by artistIds", "allow", () => people(admin.c, artist));
  await run("admin lists users of another artist", "deny", () => people(admin.c, NOBODY));
  await run("member lists users", "deny", () => people(member.c, artist));
  // The Activity page's two listeners (newest first).
  const history = (c: ClientDb, ...w: QueryConstraint[]) => getDocs(query(collectionGroup(c, "history"), ...w, orderBy("createdAt", "desc"), limit(3)));
  await run("admin lists the artist's History", "allow", () => history(admin.c, where("artistId", "==", artist)));
  await run("admin lists the shared History", "allow", () => history(admin.c, where("artistId", "==", null), where("shared", "==", true)));
  await run("admin lists another artist's History", "deny", () => history(admin.c, where("artistId", "==", NOBODY)));
  await run("member lists the artist's History", "deny", () => history(member.c, where("artistId", "==", artist)));
  await run("member lists the shared History", "deny", () => history(member.c, where("artistId", "==", null), where("shared", "==", true)));
  // Gets by id.
  await run("admin gets the artist", "allow", () => getDoc(doc(admin.c, "artists", artist)));
  await run("member gets the artist", "allow", () => getDoc(doc(member.c, "artists", artist)));
  const at = (kind: string) => physicalPath(kind, artist);
  await run("admin gets the social checklists", "allow", () => getDoc(doc(admin.c, at("socialChecklists"), artist)));
  await run("admin gets a missing show", "allow", () => getDoc(doc(admin.c, at("shows"), "tenancy-smoke-none")));
  await run("member gets a missing deal", "allow", () => getDoc(doc(member.c, at("showDeals"), "tenancy-smoke-none")));
  if (nested) await run("admin gets a missing show of another artist", "deny", () => getDoc(doc(admin.c, physicalPath("shows", NOBODY), "tenancy-smoke-none")));
  const show = (await adminDb.collection(at("shows")).where("artistId", "==", artist).limit(1).get()).docs[0];
  if (show) {
    await run("admin gets a show", "allow", () => getDoc(doc(admin.c, show.ref.path)));
    const others = nested ? (await adminDb.collectionGroup("shows").limit(200).get()).docs.filter((d) => inLayout(d.ref.path)) : (await adminDb.collection("shows").limit(50).get()).docs;
    const other = others.find((d) => d.get("artistId") !== artist);
    if (other) await run("admin gets another artist's show", "deny", () => getDoc(doc(admin.c, other.ref.path)));
  }
  for (const x of [admin, member]) { await terminate(x.c); await deleteApp(x.app); }
  console.log(`  ${allowed} allowed and ${denied} denied as expected${fails.length ? `; ${fails.length} problems` : ""}`);
}

main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
