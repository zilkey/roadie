/**
 * Spotify integration, two parts:
 * - `spotifyClient()`: the band's own daily numbers (followers, popularity) for the stats.* commands. Fake-backed only: since
 *   February 2026 Development Mode apps get no followers or popularity from the Web API, and it never had history.
 * - `spotifyCatalog()`: artist search for an act's Look up (#78), the real Web API with the client-credentials flow (no user
 *   scopes): POST accounts /api/token, GET /v1/search?type=artist (limit at most 10 in Development Mode), GET /v1/artists/{id}.
 *   It gives the Spotify link and a photo; genres come from the web search, since Development Mode artists have none.
 *   The same code runs against the fake server (fakes/fake-spotify) whenever SPOTIFY_BASE_URL is set, as in dev and every test.
 */
import { jsonClient, IntegrationError } from "./http";

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

// ---------- the catalog: artist search ----------

/**
 * One Spotify artist, as Look up uses it. Development Mode artists carry only id, name, images and external_urls (checked
 * 2026-11-11: no genres, followers or popularity), so `genres` is empty from the real API; it is kept for when Spotify sends it.
 */
export interface SpotifyHit { id: string; name: string; url: string; genres: string[]; imageUrl?: string }

export interface SpotifyCatalog {
  /** Artists by name, best match first. At most 10 (the Development Mode limit). */
  searchArtists(name: string): Promise<SpotifyHit[]>;
  /** One artist by id, or null when Spotify has no such artist. */
  artist(id: string): Promise<SpotifyHit | null>;
}

/** The Web API's artist object. Development Mode returns no `genres`; the field is read only if it ever comes back. */
interface RawArtist { id: string; name: string; genres?: string[]; images?: { url: string; width?: number | null; height?: number | null }[]; external_urls?: { spotify?: string } }

export const SEARCH_LIMIT = 10;

/** A picture about 300px wide when there is one (Spotify lists 640, 320, 160), else the biggest. */
export function pickImage(images: RawArtist["images"]): string | undefined {
  const list = [...(images ?? [])].filter((i) => i.url).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return (list.find((i) => (i.width ?? 0) <= 400 && (i.width ?? 0) >= 200) ?? list[0])?.url;
}
export const toHit = (a: RawArtist): SpotifyHit => {
  const imageUrl = pickImage(a.images);
  return {
    id: a.id, name: a.name, url: a.external_urls?.spotify ?? `https://open.spotify.com/artist/${a.id}`,
    genres: (a.genres ?? []).map((g) => g.trim().toLowerCase()).filter(Boolean), ...(imageUrl ? { imageUrl } : {}),
  };
};

/** The artist id in an open.spotify.com/artist/{id} link, if it is one. */
export function spotifyArtistId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (!/(^|\.)spotify\.com$/.test(u.hostname)) return undefined;
    const parts = u.pathname.split("/").filter(Boolean);
    const at = parts.indexOf("artist");
    return at >= 0 && /^[A-Za-z0-9]{10,40}$/.test(parts[at + 1] ?? "") ? parts[at + 1] : undefined;
  } catch { return undefined; }
}

interface CatalogEnv { SPOTIFY_BASE_URL?: string; SPOTIFY_CLIENT_ID?: string; SPOTIFY_CLIENT_SECRET?: string }

/**
 * Where the catalog talks to: the fake (SPOTIFY_BASE_URL, or the default fake port when there are no credentials, as in a bare
 * test run), else the real accounts and API hosts with SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (App Hosting secrets).
 */
export function catalogHosts(env: CatalogEnv = process.env as CatalogEnv) {
  const fake = env.SPOTIFY_BASE_URL ?? (env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET ? undefined : "http://127.0.0.1:3205");
  return fake
    ? { accounts: fake, api: fake, id: env.SPOTIFY_CLIENT_ID ?? "fake-client", secret: env.SPOTIFY_CLIENT_SECRET ?? "fake-secret" }
    : { accounts: "https://accounts.spotify.com", api: "https://api.spotify.com", id: env.SPOTIFY_CLIENT_ID!, secret: env.SPOTIFY_CLIENT_SECRET! };
}

const tokens = new Map<string, { token: string; until: number }>();

export function spotifyCatalog(env: CatalogEnv = process.env as CatalogEnv): SpotifyCatalog {
  const h = catalogHosts(env);
  const token = async () => {
    const key = `${h.accounts}|${h.id}`;
    const have = tokens.get(key);
    if (have && have.until > Date.now()) return have.token;
    const res = await fetch(`${h.accounts.replace(/\/$/, "")}/api/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${h.id}:${h.secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !data.access_token) throw new IntegrationError("spotify", res.status, data.error_description ?? data.error ?? "no token");
    // A minute early, so a call never goes out with a token about to lapse.
    tokens.set(key, { token: data.access_token, until: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000 });
    return data.access_token;
  };
  const api = async <T>(path: string, query?: Record<string, string>) => jsonClient("spotify", h.api, { authorization: `Bearer ${await token()}` })<T>("GET", path, { query });
  return {
    async searchArtists(name) {
      const q = name.replace(/"/g, "").trim();
      if (!q) return [];
      // The plain name: a quoted artist:"…" filter finds nothing once the name has an apostrophe ("A Brother's Fountain", checked 2026-11-11).
      const r = await api<{ artists?: { items?: RawArtist[] } }>("/v1/search", { q, type: "artist", limit: String(SEARCH_LIMIT) });
      return (r.artists?.items ?? []).filter((a) => a?.id && a.name).map(toHit);
    },
    async artist(id) {
      try { return toHit(await api<RawArtist>(`/v1/artists/${encodeURIComponent(id)}`)); } catch (e) {
        if (e instanceof IntegrationError && (e.status === 404 || e.status === 400)) return null;
        throw e;
      }
    },
  };
}
