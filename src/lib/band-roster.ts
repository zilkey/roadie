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
  /** The band's Signal group invite link (Artist.signalGroupUrl). Private: kept out of BAND_LINKS, which are public. */
  BAND_SIGNAL_GROUP_URL?: string;
}

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
