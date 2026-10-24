/**
 * Split every venue into the shared record and the band's private notes (docs/venue-access-proposal.md):
 *   tsx scripts/migrate-venue-notes.ts [--dry-run] [--artist=<slug>] [--yes]
 *
 * 1. For each venue that still carries the private fields (loadInNotes, notes, contactIds, promoterIds): write
 *    `venueNotes/{artistId}__{venueId}` through db.ts with what the venue held, then remove the four fields from the venue.
 *    Today there is one artist per project, so every existing venue's private fields belong to that artist (`--artist=<slug>` is
 *    required when there is more than one). A venue whose fields are already gone is skipped; a notes doc that already exists
 *    (the app created it after the deploy) is left alone, only the venue's old fields are removed. All of it is one History run
 *    (written one venue per transaction), so Admin -> History -> Undo reverses the whole migration.
 * 2. Backfill `artistId` on every history entry that has none, which the tightened rules and the Admin History page's two queries need:
 *    the parent record's artistId, else null. Entries that show a venue's old private content (before the split) are stamped with the
 *    band's artistId, so no other band's admins can read them. This writes history directly (like migrate-history.ts) and is not itself logged.
 * Safe to run again. Against real Firestore (no emulator host) it needs --yes. Run it BEFORE deploying the widened firestore.rules.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx, newRunId } from "@/server/ctx";
import { run } from "@/server/db";
import { venueNoteId } from "@/schema";
import { VENUE_PRIVATE_FIELDS } from "@/schema/venues";
import { diffHasPrivateContent, hasPrivate, privateOf } from "@/lib/venues";

export interface MigrateVenueNotesResult {
  artistId: string; runId: string;
  /** Venues whose private fields moved into a new venueNotes doc. */
  notesCreated: number;
  /** Venues whose old private fields were removed (including ones that had only empty arrays). */
  venuesCleaned: number;
  /** History entries that got an artistId. */
  historyStamped: number;
}

async function pickArtist(fs: Firestore, slug?: string): Promise<string> {
  const artists = (await fs.collection("artists").get()).docs.filter((d) => !d.data().deletedAt);
  if (slug) {
    const a = artists.find((d) => d.data().slug === slug);
    if (!a) throw new Error(`No artist with the slug "${slug}"`);
    return a.id;
  }
  if (artists.length === 1) return artists[0].id;
  if (!artists.length) throw new Error("There is no artist yet: the venues' private notes need one to belong to.");
  throw new Error(`There is more than one artist (${artists.map((d) => d.data().slug).join(", ")}): say whose venue notes these are with --artist=<slug>.`);
}

/** The artist a history entry belongs to, by the record it hangs under: the same rules as Writer.artistIdFor in db.ts. */
async function parentArtist(fs: Firestore, parentPath: string, cache: Map<string, string | null>): Promise<string | null> {
  if (cache.has(parentPath)) return cache.get(parentPath)!;
  const seg = parentPath.split("/");
  const snap = await fs.doc(parentPath).get();
  let out: string | null = null;
  if (snap.exists) {
    const d = snap.data()!;
    if (typeof d.artistId === "string") out = d.artistId;
    else if (seg.length === 2 && seg[0] === "artists") out = seg[1];
    else if (seg.length === 2 && seg[0] === "showDeals") out = ((await fs.doc(`shows/${seg[1]}`).get()).data()?.artistId as string | undefined) ?? null;
    else if (seg.length >= 4) out = await parentArtist(fs, seg.slice(0, -2).join("/"), cache); // comments, activity: their parent record's
  }
  cache.set(parentPath, out);
  return out;
}

export async function migrateVenueNotes(fs: Firestore, opts: { dryRun?: boolean; artistSlug?: string } = {}): Promise<MigrateVenueNotesResult> {
  const artistId = await pickArtist(fs, opts.artistSlug);
  const runId = newRunId();
  const ctx = importCtx("migrate-venue-notes", runId, artistId);
  const out: MigrateVenueNotesResult = { artistId, runId, notesCreated: 0, venuesCleaned: 0, historyStamped: 0 };

  // ---- 1. venue -> venue + venueNotes ----
  const venues = (await fs.collection("venues").get()).docs.filter((d) => VENUE_PRIVATE_FIELDS.some((k) => k in d.data()));
  for (const d of venues) {
    const data = d.data();
    const fields = privateOf(data);
    const noteId = venueNoteId(artistId, d.id);
    const archived = !!data.deletedAt;
    const needsNote = hasPrivate(fields) && !(await fs.doc(`venueNotes/${noteId}`).get()).exists;
    out.venuesCleaned++;
    if (needsNote) out.notesCreated++;
    if (opts.dryRun) continue;
    await run(ctx, async (w) => {
      if (needsNote) {
        await w.create("venueNotes", { artistId, venueId: d.id, ...fields }, { id: noteId });
        if (archived) await w.softDelete("venueNotes", noteId); // an archived venue stays out of the band's lists
      }
      if (archived) {
        // Writer.update refuses archived docs: take the old fields off directly (nothing else about it changes).
        await fs.doc(`venues/${d.id}`).update(Object.fromEntries(VENUE_PRIVATE_FIELDS.map((k) => [k, FieldValue.delete()])));
      } else {
        await w.update("venues", d.id, Object.fromEntries(VENUE_PRIVATE_FIELDS.map((k) => [k, null])));
      }
    });
  }

  // ---- 2. artistId on every history entry that has none ----
  const cache = new Map<string, string | null>();
  const pending: { ref: FirebaseFirestore.DocumentReference; artistId: string | null }[] = [];
  for (const h of (await fs.collectionGroup("history").get()).docs) {
    if ("artistId" in h.data()) continue;
    const parent = h.ref.parent.parent!;
    let a = await parentArtist(fs, parent.path, cache);
    if (parent.parent.id === "venues" && diffHasPrivateContent((h.data().diff ?? {}) as Record<string, unknown>)) a = artistId;
    pending.push({ ref: h.ref, artistId: a });
  }
  out.historyStamped = pending.length;
  if (!opts.dryRun) {
    for (let i = 0; i < pending.length; i += 400) {
      const batch = fs.batch();
      for (const p of pending.slice(i, i + 400)) batch.update(p.ref, { artistId: p.artistId });
      await batch.commit();
    }
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  const artistSlug = process.argv.find((a) => a.startsWith("--artist="))?.slice("--artist=".length);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const dry = flag("dry-run");
  const r = await migrateVenueNotes(firestore(), { dryRun: dry, artistSlug });
  console.log(`${dry ? "Would write" : "Wrote"} ${r.notesCreated} venueNotes doc(s) for artist ${r.artistId}, and ${dry ? "would clean" : "cleaned"} the private fields off ${r.venuesCleaned} venue(s).`);
  console.log(`${dry ? "Would stamp" : "Stamped"} artistId on ${r.historyStamped} history entr${r.historyStamped === 1 ? "y" : "ies"}.`);
  if (!dry && (r.notesCreated || r.venuesCleaned)) console.log(`History run ${r.runId}: Admin -> History -> filter by this run id -> Undo reverses the venue part (not the history stamps).`);
  if (dry) console.log("(dry run, nothing written)");
}

if (process.argv[1]?.endsWith("migrate-venue-notes.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
