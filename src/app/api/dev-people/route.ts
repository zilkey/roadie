/**
 * The people the "Sign in as…" buttons offer (emulator only).
 *
 * The buttons used to be hardcoded to DEV_PEOPLE's fake @example.com addresses. scripts/seed-real.ts seeds the REAL
 * roster instead, and pressing a fake button against a real-seeded emulator mints an Auth user with no users doc --
 * which lands on /not-invited and looks like missing data. So the list comes from the database: whichever people are
 * actually seeded are the ones offered.
 *
 * Keys are kept stable (jeff, ingrid, david, emma, eric in both rosters), because devSignIn derives the uid from the
 * key and the e2e specs click `dev-${key}`.
 */
import { db } from "@/server/db";
import { roleIn, type Membership } from "@/schema";
import { loadRoster } from "@/lib/band-roster";
import { DEV_PEOPLE } from "@/lib/dev-people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface DevSignInPerson { key: string; name: string; email: string; role: string; artistName?: string }

/** The key to sign in under for a seeded email: the roster key when we know it, else one made from the address. */
const keyFor = (email: string, known: { key: string; email: string }[]) =>
  known.find((p) => p.email.toLowerCase() === email.toLowerCase())?.key
  ?? email.split("@")[0].replace(/[^a-z0-9]+/gi, "-").toLowerCase();

export async function GET() {
  // Never outside the emulator: these buttons mint credentials without a password.
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) return Response.json({ people: [] });

  // src/lib/band.ts is gitignored, so the real roster may simply not be there; the demo keys still apply.
  const roster = await loadRoster();
  const known = [...DEV_PEOPLE, ...(roster?.BAND_PEOPLE ?? [])];
  const [users, artists] = await Promise.all([db.list("users"), db.list("artists")]);
  const nameOf = (id: string) => artists.find((a) => a.id === id)?.name as string | undefined;
  const people: DevSignInPerson[] = users.flatMap((u) => {
    const ms = (u.artists ?? []) as Membership[];
    const first = ms[0];
    if (!first) return [];
    return [{
      key: keyFor(u.email as string, known),
      name: u.name as string,
      email: u.email as string,
      role: roleIn(u, first.artistId) || "member",
      // Shown as a chip when the emulator holds more than one band, so the buttons say who belongs where.
      ...(artists.length > 1 ? { artistName: nameOf(first.artistId) } : {}),
    }];
  });
  // Admins first, then by name, so the band's own admins are the easy ones to reach.
  people.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));
  return Response.json({ people });
}
