/**
 * An act's Look up (issue #78, the About card on the DetailAct board): fills the shared `acts/{id}` record's About facts from two
 * places, only when someone clicks Look up (or "Look up watched acts"), never on a calendar refresh.
 * - Spotify (src/server/integrations/spotify.ts): artist search by name gives the Spotify link, a photo and genres. When more than
 *   one artist has exactly the act's name, the candidates are stored on the act and the card asks "same band?".
 * - Google search through Gemini's grounding (searchWeb in web.ts), then a structured extraction: website, Instagram, Bandcamp,
 *   YouTube, hometown, genres and a one-or-two-sentence description. A link is kept only when a grounding source is that page (or
 *   under it), so no link is invented.
 * - The act's own pages (website, Bandcamp, link-in-bio), read every time: the Instagram and Facebook they link to fill those blanks,
 *   and the Spotify artist they link to is the act's (it settles "same band?" and outranks the search). Then the Instagram profile
 *   photo, kept on the act as a small data URL, since Instagram's image links expire.
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
import { fetchBytes, isAggregator, normalizeUrl, resolveSource, searchWeb, socialOf, WEB_NOTICE, type WebSource } from "./web";

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
// A function, not a constant: web.ts → ai.ts → … → the command registry → acts.ts → here is an import cycle, so WEB_NOTICE may not
// be initialized yet while this module loads.
const extractSystem = () =>
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
  // Retried like every model call: Vertex answers 429 RESOURCE_EXHAUSTED in bursts (2026-11-11: prod's first Look up got Spotify only).
  const q = `"${name}" band${hint ? ` (${hint})` : ""}: hometown, genre, official website, Instagram, Bandcamp, YouTube, Spotify`;
  const found = await withModelRetry(() => searchWeb(q, { system: SEARCH_SYSTEM, max: 10 }));
  const resolved = await Promise.all(found.sources.map(async (s) => ({ title: s.title, url: await resolveSource(s.url) })));
  const sources = resolved.filter((s): s is WebSource => !!s.url);
  if (!found.answer && !sources.length) return { facts: { links: {}, genres: [] }, sources: [] };
  const { ai, model } = await getAi();
  const prompt = [
    `Act: ${name}${hint ? ` (${hint})` : ""}.`, `<search_answer>${found.answer}</search_answer>`,
    `<sources>\n${sources.map((s) => `${s.url} (${s.title})`).join("\n")}\n</sources>`,
  ].join("\n\n");
  const res = await withModelRetry(() => ai.generate({ model: model as never, system: extractSystem(), prompt, output: { schema: FactsOut } }));
  return { facts: factsFrom(res.output, sources.map((s) => s.url)), sources };
}

// ---------- the act's own pages: an Instagram photo, and which Spotify artist they link to ----------

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/** Instagram gives a profile's preview tags (og:image is the profile photo) to link-preview crawlers; a plain fetch gets a login wall. */
const PREVIEW_UA = "facebookexternalhit/1.1";
const MAX_HTML_BYTES = 2_000_000;
/** Instagram's preview photo is 150px, about 10 KB. */
const MAX_PHOTO_BYTES = 200_000;
/** Link-in-bio pages, where a band's Spotify link usually is. */
const LINK_PAGES = /(^|\.)(linktr\.ee|linkin\.bio|beacons\.ai|lnk\.bio|hoo\.be|bio\.site|solo\.to|carrd\.co)$/i;

const attr = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/gi, "'").replace(/&#x2F;/gi, "/");

/** The page's og:image, whichever order the meta tag's attributes come in. */
export function ogImage(html: string): string | undefined {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/(?:property|name)\s*=\s*["']og:image["']/i.test(tag)) continue;
    const c = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (c) return attr(c);
  }
  return undefined;
}

/** Spotify artist ids linked on a page (open.spotify.com/artist/{id}, with or without a locale). */
export const spotifyIdsIn = (html: string) => [...new Set([...html.matchAll(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})/g)].map((m) => m[1]))];

/** Only a photo on Instagram's own image hosts: a missing profile's preview is Instagram's logo from elsewhere. */
export const isInstagramPhoto = (u: string) => { try { return /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(new URL(u).hostname); } catch { return false; } };

/** The Instagram profile's photo as a data URL, or undefined when Instagram won't say. */
export async function instagramPhoto(url: string): Promise<string | undefined> {
  try {
    const page = await fetchBytes(url, { ua: PREVIEW_UA, accept: "text/html", type: /html/i, max: MAX_HTML_BYTES });
    const img = ogImage(page.body.toString("utf8"));
    if (!img || !isInstagramPhoto(img)) return undefined;
    const pic = await fetchBytes(new URL(img, page.url).href, { ua: BROWSER_UA, accept: "image/*", type: /^image\/(jpeg|png|webp)/i, max: MAX_PHOTO_BYTES });
    return `data:${pic.type.split(";")[0].trim().toLowerCase()};base64,${pic.body.toString("base64")}`;
  } catch (e) {
    console.warn("acts.lookup instagram photo", url, e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** Instagram paths that aren't a profile. */
const IG_NOT_PROFILE = /^(p|reel|reels|explore|accounts|stories|tv|direct|about|legal|developer|web)$/i;
/** Facebook paths that aren't a page: share buttons, the pixel, plugins, events, groups, login. */
const FB_NOT_PAGE = /^(sharer|sharer\.php|share|share\.php|dialog|plugins|tr|events|groups|login|login\.php|policies|privacy|help|watch|photo|photo\.php|hashtag|l\.php|pages|people|business|ads|gaming|marketplace|home\.php)$/i;

const squash = (s: string) => s.toLowerCase().replace(/^the/, "").replace(/[^a-z0-9]/g, "");

/** Profile links on a page, as https://www.instagram.com/{handle}/ (or facebook.com/{page}/, profile.php?id= kept), each once. */
export function socialLinksIn(html: string): { instagram: string[]; facebook: string[] } {
  const ig = new Set<string>(), fb = new Set<string>();
  for (const [, host, path] of html.matchAll(/https?:\/\/(?:www\.|m\.)?(instagram\.com|facebook\.com|fb\.com)\/([^\s"'<>)]*)/gi)) {
    const clean = attr(path);
    const first = decodeURIComponent(clean.split(/[/?#]/)[0] ?? "").replace(/^@/, "");
    if (/instagram/i.test(host)) {
      if (/^[A-Za-z0-9._]{1,30}$/.test(first) && !IG_NOT_PROFILE.test(first)) ig.add(`https://www.instagram.com/${first.toLowerCase()}/`);
    } else if (/^profile\.php$/i.test(first)) {
      const pid = /[?&]id=(\d+)/.exec(clean)?.[1];
      if (pid) fb.add(`https://www.facebook.com/profile.php?id=${pid}`);
    } else if (/^[A-Za-z0-9.\-]{2,80}$/.test(first) && !FB_NOT_PAGE.test(first)) fb.add(`https://www.facebook.com/${first}/`);
  }
  return { instagram: [...ig], facebook: [...fb] };
}

/**
 * Which of a page's profile links is the act's own: the only one, else the one whose handle reads like the act's name
 * (a site may also link its label, venue or producer). Undefined when it can't tell.
 */
export function ownProfile(urls: string[], name: string): string | undefined {
  if (urls.length === 1) return urls[0];
  const k = squash(name);
  const named = urls.filter((u) => { const h = squash(new URL(u).pathname.split("/").filter(Boolean)[0] ?? ""); return !!k && !!h && (h.includes(k) || k.includes(h)); });
  return named.length === 1 ? named[0] : undefined;
}

/** What the act's own pages link to. */
export interface OwnLinks { spotifyIds: string[]; instagram?: string; facebook?: string }

/** Read the act's own pages (website first) for its Spotify artist, Instagram and Facebook. Pages that fail are skipped. */
export async function readOwnPages(urls: string[], name: string): Promise<OwnLinks> {
  const pages = await Promise.allSettled(urls.map((u) => fetchBytes(u, { ua: BROWSER_UA, accept: "text/html", type: /html/i, max: MAX_HTML_BYTES })));
  // Links inside a page's JSON (link-in-bio pages, site builders) come escaped: https:\/\/open.spotify.com\/artist\/…
  const html = pages.map((p) => (p.status === "fulfilled" ? p.value.body.toString("utf8").replace(/\\\//g, "/").replace(/\\u002f/gi, "/") : ""));
  const ids = [...new Set(html.flatMap(spotifyIdsIn))];
  const social = html.map(socialLinksIn);
  const pick = (k: "instagram" | "facebook") => {
    // The first page that says, so the website (read first) outranks Bandcamp or a link page.
    for (const s of social) { const one = ownProfile(s[k], name); if (one) return one; }
    return undefined;
  };
  const instagram = pick("instagram"), facebook = pick("facebook");
  return { spotifyIds: ids, ...(instagram ? { instagram } : {}), ...(facebook ? { facebook } : {}) };
}

/** The act's own pages worth reading: website, Bandcamp, and any link-in-bio page among the sources, in that order. At most four. */
export function ownPages(links: Partial<Record<string, string>>, sources: string[]): string[] {
  const bio = sources.filter((u) => { try { return LINK_PAGES.test(new URL(u).hostname.replace(/^www\./, "")); } catch { return false; } });
  return [...new Set([links.website, links.bandcamp, ...bio].filter((u): u is string => !!u))].slice(0, 4);
}

/** An image Look up put there from Spotify: an Instagram photo may replace it, a person's own may not. */
const fromSpotify = (u: unknown) => typeof u === "string" && /^https:\/\/i\.scdn\.co\//.test(u);

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
  for (const k of ["hometown", "description", "imageUrl"]) if (patch[k] && patch[k] !== act[k]) out.push(k);
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
  let hit = matches.length === 1 ? matches[0] : matches.find((m) => m.id === webPick);
  const links = { ...(act.links ?? {}) } as Record<string, string>;
  for (const [k, v] of Object.entries(facts.links)) if (v && !links[k] && k !== "spotify") links[k] = v;
  // The act's own pages (website, Bandcamp, link-in-bio), never in fake mode (no network in tests): the Instagram and Facebook they
  // link to fill those blanks, and the Spotify artist they link to is the act's, whatever the search said.
  const real = modelMode() !== "fake";
  const own: OwnLinks = real ? await readOwnPages(ownPages(links, webSources.map((s) => s.url)), act.name) : { spotifyIds: [] };
  if (own.instagram && !links.instagram) links.instagram = own.instagram;
  if (own.facebook && !links.facebook) links.facebook = own.facebook;
  const siteId = own.spotifyIds.length === 1 ? own.spotifyIds[0] : undefined;
  // One Spotify artist on the act's own site outranks the search, even a single same-name match.
  const siteHit = siteId ? matches.find((m) => m.id === siteId) : undefined;
  if (siteId) hit = siteHit;
  else hit ??= matches.find((m) => own.spotifyIds.includes(m.id));
  const siteSpotify = siteId && !siteHit ? `https://open.spotify.com/artist/${siteId}` : undefined;
  const candidates = !hit && !siteSpotify && matches.length > 1 ? matches : undefined;
  const spotifyLink = siteSpotify ?? facts.links.spotify;
  if (spotifyLink && !links.spotify && !candidates && !hit) links.spotify = spotifyLink;
  const photo = real && links.instagram && (!act.imageUrl || fromSpotify(act.imageUrl)) ? await instagramPhoto(links.instagram) : undefined;
  const genres = act.genres?.length ? act.genres : cleanGenres(facts.genres);
  let patch: Record<string, unknown> = {
    links, genres,
    ...(!act.hometown && facts.hometown ? { hometown: facts.hometown } : {}),
    ...(!act.description && facts.description ? { description: facts.description } : {}),
  };
  if (hit) patch = { ...patch, ...spotifyPatch({ ...act, links: links as ActRow["links"], genres: act.genres }, hit, genres) };
  // The band's Instagram photo beats Spotify's, which is often an album cover.
  if (photo) patch.imageUrl = photo;
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
