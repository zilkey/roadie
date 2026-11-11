/**
 * An act's Look up (issue #78, the About card on the DetailAct board): fills the shared `acts/{id}` record's About facts from two
 * places, only when someone clicks Look up (or "Look up shortlist"), never on a calendar refresh.
 * - Spotify (src/server/integrations/spotify.ts): artist search by name gives the Spotify link, a photo and genres. When more than
 *   one artist has exactly the act's name, the candidates are stored on the act and the card asks "same band?".
 * - Google search through Gemini's grounding (searchWeb in web.ts), then a structured extraction: website, Instagram, Bandcamp,
 *   YouTube, hometown, genres and a one-or-two-sentence description. A link is kept only when a grounding source is that page (or
 *   under it), so no link is invented.
 * Look up fills blanks only: anything a person already set or fixed stays. Genres are stored lowercase (#79 reads them).
 */
import { z as gz } from "genkit";
import { db, run } from "../db";
import { AppError } from "../errors";
import type { Ctx } from "../ctx";
import { spotifyCatalog, spotifyArtistId, type SpotifyHit } from "../integrations/spotify";
import { actKey } from "@/schema/normalize";
import type { ArtistLinkKey } from "@/schema";
import { getAi, modelMode, withModelRetry } from "./ai";
import { isAggregator, normalizeUrl, resolveSource, searchWeb, socialOf, WEB_NOTICE, type WebSource } from "./web";

export const MAX_GENRES = 6;
const MAX_SOURCES = 6;

/** What the web turned up about an act. Links are already checked against the grounding sources. */
export interface ActFacts {
  links: Partial<Record<"website" | "instagram" | "bandcamp" | "youtube" | "spotify", string>>;
  hometown?: string; genres: string[]; description?: string;
}
export interface WebFound { facts: ActFacts; sources: WebSource[] }

// ---------- which links the grounding sources vouch for ----------

/** Hosts where many people's pages live: a link there must name the same page (instagram.com/abrothersfountain), not just the host. */
const SHARED_HOSTS = /^(instagram\.com|youtube\.com|m\.youtube\.com|facebook\.com|tiktok\.com|open\.spotify\.com|linktr\.ee|x\.com|twitter\.com|soundcloud\.com)$/;
const hostOf = (u: URL) => u.hostname.replace(/^www\./, "").toLowerCase();
const segs = (u: URL) => u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase());

/** The link as an https URL, or undefined when it isn't one. "abrothersfountain.com" becomes "https://abrothersfountain.com/". */
export function asHttps(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  if (!t) return undefined;
  const n = normalizeUrl(/^https?:\/\//i.test(t) ? t.replace(/^http:/i, "https:") : `https://${t}`);
  if (!n) return undefined;
  const u = new URL(n);
  return u.protocol === "https:" && u.hostname.includes(".") ? u.href : undefined;
}

/**
 * The link, when one of the grounding sources is that page or a page under it (same host; the link's path a prefix of the source's).
 * On shared hosts the link must name a page (a first path segment), so instagram.com alone is never vouched for. Else undefined.
 */
export function groundedLink(link: string | null | undefined, sources: string[]): string | undefined {
  const href = asHttps(link);
  if (!href) return undefined;
  const u = new URL(href);
  const want = segs(u);
  if (SHARED_HOSTS.test(hostOf(u)) && !want.length) return undefined;
  for (const s of sources) {
    const n = normalizeUrl(s);
    if (!n) continue;
    const src = new URL(n);
    if (hostOf(src) !== hostOf(u)) continue;
    const have = segs(src);
    if (want.every((p, i) => have[i] === p)) return href;
  }
  return undefined;
}

/** Each link kind on its own kind of site: a website that is really an Instagram page or a listings site is dropped. */
const KIND_OK: Record<keyof ActFacts["links"], (u: URL) => boolean> = {
  website: (u) => !socialOf(u.href) && !isAggregator(u.href) && !/(^|\.)(bandcamp|youtube|spotify|soundcloud|apple)\.com$/.test(hostOf(u)),
  instagram: (u) => hostOf(u) === "instagram.com",
  bandcamp: (u) => /(^|\.)bandcamp\.com$/.test(hostOf(u)),
  youtube: (u) => /(^|\.)youtube\.com$|^youtu\.be$/.test(hostOf(u)),
  spotify: (u) => hostOf(u) === "open.spotify.com",
};

/** Lowercase, trimmed, de-duplicated, at most MAX_GENRES. */
export function cleanGenres(...lists: (readonly string[] | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const g of lists.flat()) {
    const t = typeof g === "string" ? g.trim().toLowerCase().replace(/\s+/g, " ") : "";
    if (t && t.length <= 40 && !out.includes(t)) out.push(t);
  }
  return out.slice(0, MAX_GENRES);
}

// ---------- the web ----------

const SEARCH_SYSTEM =
  "Search the web for one music act (a band or artist) and answer in at most six short sentences: where they're from (city and state), " +
  "what genres they play, and the web addresses of their own website, Instagram, Bandcamp, YouTube and Spotify pages. Facts only. " +
  "If several acts share the name, say so and describe the one that matches the hint. Say when you couldn't find something.";

const FactsOut = gz.object({
  website: gz.string().nullable().describe("The act's own website (not a social page, ticket or listings site), as a URL from the sources, or null"),
  instagram: gz.string().nullable().describe("The act's Instagram page URL from the sources, or null"),
  bandcamp: gz.string().nullable().describe("The act's Bandcamp page URL from the sources, or null"),
  youtube: gz.string().nullable().describe("The act's YouTube channel URL from the sources, or null"),
  spotify: gz.string().nullable().describe("The act's Spotify artist page URL (open.spotify.com/artist/...) from the sources, or null"),
  hometown: gz.string().nullable().describe("Where the act is from, as City, ST for the US (\"Fort Collins, CO\") or City, Country, or null"),
  genres: gz.array(gz.string()).describe("One to four genres, lowercase (\"americana\", \"indie folk\"). Empty when unknown"),
  description: gz.string().nullable().describe("One or two plain sentences about the act that name its genre. No hype, no ticket info. Null when nothing was found"),
});
const EXTRACT_SYSTEM =
  "You pull facts about one music act out of a web search answer and its source list. Use only what they say; null for anything they don't. " +
  "Every link must be one of the listed sources (or a page the answer names on one of those sites); never make up a URL or a handle. " +
  WEB_NOTICE;

/** Canned facts for the fake model: "A Brother's Fountain" is findable (with one made-up link the grounding check must drop); anything else turns up nothing. */
export const FAKE_FOUNTAIN = {
  answer: "A Brother's Fountain is a folk and Americana band from Fort Collins, Colorado.",
  sources: [
    { title: "abrothersfountain.example", url: "https://abrothersfountain.example/about" },
    { title: "instagram.com", url: "https://www.instagram.com/abrothersfountain/" },
    { title: "bandcamp.com", url: "https://abrothersfountain.bandcamp.com/album/first-light" },
  ],
  out: {
    website: "https://abrothersfountain.example/", instagram: "https://www.instagram.com/abrothersfountain/", bandcamp: "https://abrothersfountain.bandcamp.com/",
    youtube: "https://www.youtube.com/@abrothersfountain-made-up", spotify: null, hometown: "Fort Collins, CO", genres: ["Folk", "americana"],
    description: "A Fort Collins folk and Americana band with three-part harmonies.",
  },
};

/** Turn the extraction's output into facts, keeping only the links a source vouches for. */
export function factsFrom(o: gz.infer<typeof FactsOut> | null | undefined, sourceUrls: string[]): ActFacts {
  if (!o) return { links: {}, genres: [] };
  const links: ActFacts["links"] = {};
  for (const k of Object.keys(KIND_OK) as (keyof ActFacts["links"])[]) {
    const v = groundedLink(o[k], sourceUrls);
    if (v && KIND_OK[k](new URL(v))) links[k] = v;
  }
  const str = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : undefined);
  const description = str(o.description), hometown = str(o.hometown);
  return { links, genres: cleanGenres(o.genres ?? []), ...(hometown && hometown.length <= 80 ? { hometown } : {}), ...(description ? { description: description.slice(0, 400) } : {}) };
}

/** Search, resolve the grounding sources to real pages, extract. `hint` says where the act has played, to pick the right one of several. */
export async function webFacts(name: string, hint: string): Promise<WebFound> {
  if (modelMode() === "fake") {
    if (!/fountain/i.test(name)) return { facts: { links: {}, genres: [] }, sources: [] };
    return { facts: factsFrom(FAKE_FOUNTAIN.out, FAKE_FOUNTAIN.sources.map((s) => s.url)), sources: FAKE_FOUNTAIN.sources };
  }
  const found = await searchWeb(`"${name}" band${hint ? ` (${hint})` : ""}: hometown, genre, official website, Instagram, Bandcamp, YouTube, Spotify`, { system: SEARCH_SYSTEM, max: 10 });
  const resolved = await Promise.all(found.sources.map(async (s) => ({ title: s.title, url: await resolveSource(s.url) })));
  const sources = resolved.filter((s): s is WebSource => !!s.url);
  if (!found.answer && !sources.length) return { facts: { links: {}, genres: [] }, sources: [] };
  const { ai, model } = await getAi();
  const prompt = [
    `Act: ${name}${hint ? ` (${hint})` : ""}.`, `<search_answer>${found.answer}</search_answer>`,
    `<sources>\n${sources.map((s) => `${s.url} (${s.title})`).join("\n")}\n</sources>`,
  ].join("\n\n");
  const res = await withModelRetry(() => ai.generate({ model: model as never, system: EXTRACT_SYSTEM, prompt, output: { schema: FactsOut } }));
  return { facts: factsFrom(res.output, sources.map((s) => s.url)), sources };
}

// ---------- the act ----------

type ActRow = Record<string, unknown> & { id: string; name: string; links?: Partial<Record<ArtistLinkKey, string>>; genres?: string[]; lookupCandidates?: SpotifyHit[] };

/** Spotify artists with exactly the act's name (by matchKey, so "The Band" and "band" are the same). */
export const sameName = (hits: SpotifyHit[], name: string) => { const k = actKey(name); return hits.filter((h) => actKey(h.name) === k); };

/** Where the act has played, for the search: "played Aggie Theatre in Fort Collins, Bluebird Theater in Denver". */
async function playedHint(id: string): Promise<string> {
  const events = await db.list("venueEvents", (q) => q.where("actIds", "array-contains", id));
  const venueIds = [...new Set(events.map((e) => e.venueId as string))].slice(0, 3);
  const venues = (await Promise.all(venueIds.map((v) => db.get("venues", v)))).filter(Boolean);
  const rooms = venues.map((v) => `${v!.name}${v!.address?.city ? ` in ${v!.address.city}${v!.address.state ? `, ${v!.address.state}` : ""}` : ""}`);
  return rooms.length ? `played ${rooms.join("; ")}` : "";
}

/** The Spotify part of the patch: link, photo and genres, each only where the act has none. */
function spotifyPatch(act: ActRow, hit: SpotifyHit, genresSoFar: string[]) {
  return {
    links: { ...(act.links ?? {}), ...(act.links?.spotify ? {} : { spotify: hit.url }) },
    ...(act.imageUrl || !hit.imageUrl ? {} : { imageUrl: hit.imageUrl }),
    genres: act.genres?.length ? act.genres : cleanGenres(genresSoFar, hit.genres),
  };
}

export interface LookupResult {
  id: string; name: string;
  /** "picked": Spotify had several acts with this name and the card is asking which one. */
  state: "found" | "nothing" | "pick";
  found: string[]; candidates?: number; sources: number;
}

const what = (patch: Record<string, unknown>, act: ActRow) => {
  const out: string[] = [];
  const links = (patch.links ?? {}) as Record<string, string>;
  for (const k of Object.keys(links)) if (!act.links?.[k as ArtistLinkKey]) out.push(k);
  for (const k of ["hometown", "description", "imageUrl"]) if (patch[k] && !act[k]) out.push(k);
  if ((patch.genres as string[] | undefined)?.length && !act.genres?.length) out.push("genres");
  return out;
};

/**
 * Look the act up and write what was found. `spotifyId` answers the "same band?" question instead: an id picks that candidate,
 * null means none of them (the candidates are cleared, the web facts stay).
 */
export async function lookUpAct(ctx: Ctx, id: string, opts: { spotifyId?: string | null; now?: Date } = {}): Promise<LookupResult> {
  const act = (await db.get("acts", id)) as ActRow | null;
  if (!act || act.deletedAt) throw new AppError("not_found", "No act with that id", 404);
  const now = (opts.now ?? new Date()).toISOString();

  if (opts.spotifyId !== undefined) {
    const hit = opts.spotifyId === null ? undefined
      : (act.lookupCandidates ?? []).find((c) => c.id === opts.spotifyId) ?? (await spotifyCatalog().artist(opts.spotifyId)) ?? undefined;
    if (opts.spotifyId !== null && !hit) throw new AppError("not_found", "Spotify has no artist with that id", 404);
    const patch: Record<string, unknown> = { lookupCandidates: null, ...(hit ? spotifyPatch(act, hit, act.genres ?? []) : {}) };
    if (hit && !(act.sources as { url: string }[] | undefined)?.some((s) => s.url === hit.url)) {
      patch.sources = [...((act.sources as unknown[] | undefined) ?? []), { url: hit.url, checkedAt: now }];
    }
    const found = what(patch, act);
    await run(ctx, (w) => w.update("acts", id, patch));
    return { id, name: act.name, state: found.length ? "found" : "nothing", found, sources: ((patch.sources ?? act.sources) as unknown[] | undefined)?.length ?? 0 };
  }

  const hint = await playedHint(id);
  const [web, spotify] = await Promise.allSettled([webFacts(act.name, hint), spotifyCatalog().searchArtists(act.name)]);
  if (web.status === "rejected" && spotify.status === "rejected") {
    console.error("acts.lookup", web.reason, spotify.reason);
    throw new AppError("lookup_failed", "Look up couldn't reach the web or Spotify. Try again in a minute.", 502);
  }
  if (web.status === "rejected") console.error("acts.lookup web", web.reason);
  if (spotify.status === "rejected") console.error("acts.lookup spotify", spotify.reason);
  const facts = web.status === "fulfilled" ? web.value.facts : { links: {}, genres: [] } as ActFacts;
  const webSources = web.status === "fulfilled" ? web.value.sources : [];
  const matches = spotify.status === "fulfilled" ? sameName(spotify.value, act.name) : [];
  // Several Spotify artists by this name: the web's Spotify link settles it when it names one of them; else the person picks.
  const webPick = spotifyArtistId(facts.links.spotify);
  const hit = matches.length === 1 ? matches[0] : matches.find((m) => m.id === webPick);
  const candidates = !hit && matches.length > 1 ? matches : undefined;

  const links = { ...(act.links ?? {}) } as Record<string, string>;
  for (const [k, v] of Object.entries(facts.links)) if (v && !links[k] && !(k === "spotify" && candidates)) links[k] = v;
  const genres = act.genres?.length ? act.genres : cleanGenres(facts.genres);
  let patch: Record<string, unknown> = {
    links, genres,
    ...(!act.hometown && facts.hometown ? { hometown: facts.hometown } : {}),
    ...(!act.description && facts.description ? { description: facts.description } : {}),
  };
  if (hit) patch = { ...patch, ...spotifyPatch({ ...act, links: links as ActRow["links"], genres: act.genres }, hit, genres) };
  const sources = [...webSources.slice(0, MAX_SOURCES).map((s) => s.url), ...(hit ? [hit.url] : [])];
  patch = {
    ...patch,
    ...(Object.keys(patch.links as object).length ? {} : { links: null }),
    ...((patch.genres as string[]).length ? {} : { genres: null }),
    lookedUpAt: now,
    sources: sources.length ? [...new Set(sources)].map((url) => ({ url, checkedAt: now })) : null,
    lookupCandidates: candidates ?? null,
  };
  const found = what(patch, act);
  await run(ctx, (w) => w.update("acts", id, patch));
  return { id, name: act.name, state: candidates ? "pick" : found.length ? "found" : "nothing", found, ...(candidates ? { candidates: candidates.length } : {}), sources: sources.length };
}
