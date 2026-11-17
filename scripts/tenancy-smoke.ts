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
 * Writes nothing. The browser-side check (`--rules`) comes with the phase-6 rules.
 */
import fs from "node:fs";
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
  const fails: string[] = [];
  const artist = (await db.doc(`artists/${named}`).get()).exists ? named : (await db.collection("artists").where("slug", "==", named).limit(1).get()).docs[0]?.id;
  if (!artist) throw new Error(`no artist ${named}`);

  // 1. Counts per kind per artist, and every record's owner by path.
  const ownerOfId = new Map<string, string>(); // "kind/id" -> artistId
  const live: Record<string, number> = {}, counts: Record<string, Record<string, number>> = {};
  for (const kind of ARTIST_KINDS) {
    const snap = SUBS.has(kind) ? await db.collectionGroup(kind).get() : await db.collection(kind).get();
    const per = (counts[kind] = {} as Record<string, number>);
    for (const d of snap.docs) {
      if (kind === "comments" || kind === "activity") { if (!["shows", "pitches"].includes(d.ref.parent.parent?.parent.id ?? "")) continue; }
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

  if (fails.length) {
    console.error(`\nFAILED (${fails.length}):\n${fails.slice(0, 50).join("\n")}`);
    process.exit(1);
  }
  console.log("\nOK: no record without an artist, no other artist's record in any result, counts match.");
}

main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
