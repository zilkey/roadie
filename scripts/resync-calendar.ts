/**
 * Tenancy phase 8: calendar events for future shows at venues whose own time zone differs from the artist's were sent with the
 * artist's (Denver) zone before phase 8, so Google showed them at the wrong hour. This sends each one again (the same Update an
 * admin presses on the show), now in the venue's zone.
 *   npm run resync:calendar -- --artist <id>                 (dry run: lists the shows it would send again, sends nothing)
 *   npm run resync:calendar -- --artist <id> --apply         (sends them, as the band's Google account: artist.google.uid)
 *   ... --uid <admin uid>                                     (send as another admin with write access to the band calendar)
 * Only shows dated today or later (the artist's zone), with an event on the band calendar, not canceled/dropped, at a venue
 * whose `timeZone` is set and isn't the artist's, whose event would change if sent now (so a second run finds 0). An event
 * someone deleted on the calendar is reported, not put back.
 * Against the emulator, set FIRESTORE_EMULATOR_HOST; against prod, GCLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS.
 */
import { db } from "@/server/db";
import { artistCtx, type Ctx } from "@/server/ctx";
import { calendarHashNow, calendarSend } from "@/server/calendarSync";
import { zoneOf } from "@/server/zone";
import { AppError } from "@/server/errors";
import { dateInZone } from "@/lib/timezone";
import { isOff } from "@/lib/shows";

export interface ResyncRow { id: string; date: string; venue: string; venueZone: string; result?: string }
export interface ResyncReport { artist: string; artistZone: string; apply: boolean; shows: ResyncRow[] }

export async function resyncCalendar({ artist, uid, apply, now = new Date() }: { artist: string; uid?: string; apply: boolean; now?: Date }): Promise<ResyncReport> {
  const probe: Ctx = artistCtx({ uid: "resync-calendar", role: "admin", via: "import", artistId: artist, now });
  const a = await db.get(probe, "artists", artist);
  if (!a || a.deletedAt) throw new Error(`No artist ${artist}`);
  const sender = uid ?? (a.google as { uid?: string } | null | undefined)?.uid;
  if (apply && !sender) throw new Error("No band Google account on this artist: pass --uid <admin uid> (an admin who can write to the band calendar)");
  const artistZone = await zoneOf(probe);
  const today = dateInZone(artistZone, now);
  const shows = (await db.list(probe, "shows")).filter((s) => s.calendarEventId && (s.date as string) >= today && !isOff(s as never));
  const venues = new Map<string, Record<string, unknown> | null>();
  const rows: ResyncRow[] = [];
  for (const s of shows.sort((x, y) => String(x.date).localeCompare(String(y.date)))) {
    const vid = (s.venue as { id?: string } | undefined)?.id;
    if (!vid) continue;
    if (!venues.has(vid)) venues.set(vid, await db.get(probe, "venues", vid));
    const vz = venues.get(vid)?.timeZone;
    if (typeof vz !== "string" || !vz || vz === artistZone) continue;
    if (s.calendarHash === (await calendarHashNow(probe, "shows", s.id))) continue; // already sent as it is now
    rows.push({ id: s.id, date: s.date as string, venue: String((s.venue as { name?: string }).name ?? vid), venueZone: vz });
  }
  if (apply) {
    const ctx: Ctx = artistCtx({ uid: sender!, role: "admin", via: "import", artistId: artist, now });
    for (const r of rows) {
      try { r.result = (await calendarSend(ctx, "shows", r.id)).calendar; }
      catch (e) { r.result = e instanceof AppError ? `${e.code}: ${e.message}` : String(e); }
    }
  }
  return { artist, artistZone, apply, shows: rows };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const apply = argv.includes("--apply");
  const artist = arg("artist");
  if (!artist) throw new Error("--artist <id> is required");
  const project = process.env.GCLOUD_PROJECT, emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})${apply ? "" : ", dry run"}`);
  const r = await resyncCalendar({ artist, uid: arg("uid"), apply });
  console.log(`Artist ${r.artist} (${r.artistZone}): ${r.shows.length} future show event(s) at a venue in another zone.`);
  for (const s of r.shows) console.log(`  ${s.date} ${s.venue} (${s.venueZone}) ${s.id}${s.result ? ` → ${s.result}` : ""}`);
  if (!apply && r.shows.length) console.log("(dry run, nothing sent; re-run with --apply)");
  if (r.shows.some((s) => s.result && !["updated", "created", "restored"].includes(s.result))) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("resync-calendar.ts")) main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
