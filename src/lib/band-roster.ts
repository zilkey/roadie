/**
 * Loads the real roster from `src/lib/band.ts`, which is not committed (real names and Google addresses, public repo
 * -- see .gitignore and src/lib/band.example.ts). The import is dynamic so the app still builds and runs without it.
 */
import type { DevPerson } from "./dev-people";
import type { ArtistLinkKey } from "@/schema/artists";

export interface BandRoster {
  BAND_ARTIST_NAME: string;
  BAND_PEOPLE: DevPerson[];
  BAND_CONFIGURATIONS: { id: string; name: string; billingName: string; keys: string[] }[];
  BAND_LINKS: Partial<Record<ArtistLinkKey, string>>;
}

export const MISSING_ROSTER =
  "src/lib/band.ts is missing (it is gitignored: real names and addresses stay out of the repo). " +
  "Copy src/lib/band.example.ts to src/lib/band.ts and fill in the real band.";

/**
 * The roster, or null when the file is not there.
 *
 * The specifier is built at runtime so `tsc` does not try to resolve `./band`: it is gitignored, so on a clean
 * checkout it does not exist and a static import would fail the typecheck (`tsc` is this project's lint).
 */
export async function loadRoster(): Promise<BandRoster | null> {
  const here = "./band";
  try {
    return (await import(/* webpackIgnore: true */ `${here}`)) as unknown as BandRoster;
  } catch {
    return null;
  }
}

/** The roster, or a thrown error naming what to do. For scripts, where running without it is pointless. */
export async function requireRoster(): Promise<BandRoster> {
  const r = await loadRoster();
  if (!r) throw new Error(MISSING_ROSTER);
  return r;
}
