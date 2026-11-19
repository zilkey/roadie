/**
 * Tenancy phase 7: drop the old single musician link (`users.musicianId`) from every users doc. Since phase 4 each membership carries
 * the person's musician in that artist (`artists[].musicianId`), and nothing reads the old field any more.
 *   npx tsx scripts/drop-user-musician-id.ts                (dry run: lists the people it would change, changes nothing)
 *   npx tsx scripts/drop-user-musician-id.ts --apply        (drops the field)
 *   npx tsx scripts/drop-user-musician-id.ts --undo [--apply]   (rollback: writes users.musicianId back from the person's single
 *                                                             membership musician; people with none, or with several, are skipped)
 * Before dropping, a membership that has no musician takes the old one when that musician is in its artist, so no link is lost.
 * A stamp-only change: it writes the users doc directly (no History entry, `updatedAt` untouched), like a schema migration, so
 * nobody's Activity or Undo shows it. Against the emulator set FIRESTORE_EMULATOR_HOST; against prod GCLOUD_PROJECT and
 * GOOGLE_APPLICATION_CREDENTIALS. Safe to run again: a second dry run reports 0.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import type { Membership } from "@/schema/users";

export interface DropChange { uid: string; email: string; from?: string; to?: string; linked?: string; skipped?: string }
export interface DropReport { mode: "drop" | "undo"; apply: boolean; total: number; changes: DropChange[] }

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export async function dropUserMusicianId({ apply, undo = false }: { apply: boolean; undo?: boolean }): Promise<DropReport> {
  const fs = firestore();
  const users = (await fs.collection("users").get()).docs;
  const changes: DropChange[] = [];
  const musicianArtist = async (mid: string) => {
    const flat = await fs.collection("musicians").doc(mid).get();
    if (flat.exists) return str(flat.get("artistId"));
    const nested = await fs.collectionGroup("musicians").where("id", "==", mid).limit(1).get();
    return nested.empty ? undefined : str(nested.docs[0].get("artistId"));
  };
  for (const u of users) {
    const d = u.data();
    const ms = (Array.isArray(d.artists) ? d.artists : []) as Membership[];
    if (undo) {
      if (str(d.musicianId)) continue;
      const mids = [...new Set(ms.map((m) => m.musicianId).filter((x): x is string => !!x))];
      if (mids.length !== 1) { if (mids.length > 1) changes.push({ uid: u.id, email: d.email, skipped: `${mids.length} musicians, one per artist` }); continue; }
      changes.push({ uid: u.id, email: d.email, to: mids[0] });
      if (apply) await u.ref.update({ musicianId: mids[0] });
      continue;
    }
    if (!("musicianId" in d)) continue;
    const mid = str(d.musicianId);
    const home = mid ? await musicianArtist(mid) : undefined;
    const fill = home ? ms.find((m) => m.artistId === home && !m.musicianId) : undefined;
    changes.push({ uid: u.id, email: d.email, from: mid, ...(fill ? { linked: home } : {}) });
    if (!apply) continue;
    const artists = fill ? ms.map((m) => (m === fill ? { ...m, musicianId: mid } : m)) : undefined;
    await u.ref.update({ musicianId: FieldValue.delete(), ...(artists ? { artists } : {}) });
  }
  return { mode: undo ? "undo" : "drop", apply, total: users.length, changes };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply"), undo = argv.includes("--undo");
  const project = process.env.GCLOUD_PROJECT, emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})${apply ? "" : ", dry run"}`);
  const r = await dropUserMusicianId({ apply, undo });
  const did = r.changes.filter((c) => !c.skipped);
  console.log(`${r.total} users doc(s); ${did.length} ${undo ? (apply ? "given back" : "would get back") : apply ? "dropped" : "would drop"} users.musicianId.`);
  for (const c of r.changes) {
    console.log(`  ${c.uid} ${c.email}: ${c.skipped ? `skipped (${c.skipped})` : undo ? `musicianId ${c.to}` : `${c.from ?? "(empty)"}${c.linked ? `, linked on the ${c.linked} membership` : ""}`}`);
  }
  if (!apply && did.length) console.log("(dry run, nothing changed; re-run with --apply)");
}

if (process.argv[1]?.endsWith("drop-user-musician-id.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
