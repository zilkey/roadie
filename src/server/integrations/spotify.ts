/**
 * Spotify integration. Real implementation later: Spotify Web API with client-credentials flow (no user scopes):
 * GET /v1/artists/{id} (followers.total, popularity). The Web API has no history,
 * so the real client's `history` is built from our own daily statSnapshots (see docs/FIREBASE-SETUP.md).
 */
import { jsonClient } from "./http";

export interface SpotifyDay { date: string; followers: number; popularity: number }
export interface SpotifyArtist extends SpotifyDay { id: string; name: string }

export interface SpotifyService {
  /** Today's numbers. */
  artist(): Promise<SpotifyArtist>;
  /** Daily followers and popularity, inclusive dates (YYYY-MM-DD). Fake only; real API has no history. */
  history(opts?: { from?: string; to?: string }): Promise<SpotifyDay[]>;
}

export function spotifyClient(baseUrl = process.env.SPOTIFY_BASE_URL ?? "http://127.0.0.1:3205"): SpotifyService {
  const call = jsonClient("spotify", baseUrl);
  return {
    artist: () => call("GET", "/artist"),
    history: (o = {}) => call("GET", "/artist/history", { query: o }),
  };
}
