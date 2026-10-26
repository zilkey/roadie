/**
 * Split festivals, festival years, promoters and contacts into the shared record and the band's private notes (src/schema/bandNotes.ts):
 *   tsx scripts/migrate-band-notes.ts [--dry-run] [--artist=<slug>] [--yes]
 *
 * 1. For each record that still carries a note field (festival notes; edition notes, payNotes; promoter notes, howToPitch, venueIds;
 *    contact notes): write `{coll}/{artistId}__{id}` through db.ts with what the record held, then remove those fields from it.
 *    Today there is one artist per project, so the notes belong to that artist (`--artist=<slug>` when there is more than one).
 *    A record whose fields are already gone is skipped; a notes doc that already exists (the app created it after the deploy, starting
 *    from the record's fields) is left alone, only the record's old fields are removed. All of it is one History run (one record per
 *    transaction), so Admin -> History -> Undo reverses it.
 * 2. Stamp the band's artistId on history entries of those records that show a note (its before or after), so no other band's admins
 *    can read them. This writes history directly (like migrate-venue-notes.ts) and is not itself logged.
 * Safe to run again. Against real Firestore (no emulator host) it needs --yes.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx, newRunId } from "@/server/ctx";
import { run } from "@/server/db";
import { BAND_NOTES, NOTED_KINDS, bandNoteId, isNotedKind } from "@/schema";
import { diffHasNoteContent, hasNotes, noteFieldNames, noteFieldsOf } from "@/lib/bandNotes";
import { pickArtist } from "./migrate-venue-notes";

export interface MigrateBandNotesResult {
  artistId: string; runId: string;
  /** Records whose notes moved into a new notes doc. */
  notesCreated: number;
  /** Records whose old note fields were removed (including ones that held only empty values). */
  recordsCleaned: number;
  /** History entries now stamped with the band. */
  historyStamped: number;
}

export async function migrateBandNotes(fs: Firestore, opts: { dryRun?: boolean; artistSlug?: string } = {}): Promise<MigrateBandNotesResult> {
  const artistId = await pickArtist(fs, opts.artistSlug);
  const runId = newRunId();
  const ctx = importCtx("migrate-band-notes", runId, artistId);
  const out: MigrateBandNotesResult = { artistId, runId, notesCreated: 0, recordsCleaned: 0, historyStamped: 0 };

  // ---- 1. record -> record + {kind}Notes ----
  for (const kind of NOTED_KINDS) {
    const { coll, key } = BAND_NOTES[kind];
    const names = noteFieldNames(kind);
    const docs = (await fs.collection(kind).get()).docs.filter((d) => names.some((k) => k in d.data()));
    for (const d of docs) {
      const data = d.data();
      const fields = noteFieldsOf(kind, data);
      const noteId = bandNoteId(artistId, d.id);
      const needsNote = hasNotes(fields) && !(await fs.doc(`${coll}/${noteId}`).get()).exists;
      out.recordsCleaned++;
      if (needsNote) out.notesCreated++;
      if (opts.dryRun) continue;
      await run(ctx, async (w) => {
        if (needsNote) await w.create(coll, { artistId, [key]: d.id, ...fields }, { id: noteId });
        if (data.deletedAt) {
          // Writer.update refuses archived docs: take the old fields off directly (nothing else about it changes).
          await fs.doc(`${kind}/${d.id}`).update(Object.fromEntries(names.map((k) => [k, FieldValue.delete()])));
        } else {
          await w.update(kind, d.id, Object.fromEntries(names.map((k) => [k, null])));
        }
      });
    }
  }

  // ---- 2. history entries that show a band's note belong to the band ----
  const pending: FirebaseFirestore.DocumentReference[] = [];
  for (const h of (await fs.collectionGroup("history").get()).docs) {
    const kind = h.ref.parent.parent?.parent.id;
    if (!kind || !isNotedKind(kind) || h.data().artistId === artistId) continue;
    if (diffHasNoteContent(kind, (h.data().diff ?? {}) as Record<string, unknown>)) pending.push(h.ref);
  }
  out.historyStamped = pending.length;
  if (!opts.dryRun) {
    for (let i = 0; i < pending.length; i += 400) {
      const batch = fs.batch();
      for (const ref of pending.slice(i, i + 400)) batch.update(ref, { artistId });
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
  const r = await migrateBandNotes(firestore(), { dryRun: dry, artistSlug });
  console.log(`${dry ? "Would write" : "Wrote"} ${r.notesCreated} notes doc(s) for artist ${r.artistId}, and ${dry ? "would clean" : "cleaned"} the note fields off ${r.recordsCleaned} festival(s), year(s), promoter(s) and contact(s).`);
  console.log(`${dry ? "Would stamp" : "Stamped"} the band on ${r.historyStamped} history entr${r.historyStamped === 1 ? "y" : "ies"}.`);
  if (!dry && (r.notesCreated || r.recordsCleaned)) console.log(`History run ${r.runId}: Admin -> History -> filter by this run id -> Undo reverses the record part (not the history stamps).`);
  if (dry) console.log("(dry run, nothing written)");
}

if (process.argv[1]?.endsWith("migrate-band-notes.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
