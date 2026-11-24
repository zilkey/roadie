import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { OWNERS } from "@/schema/owners";

// Tenancy plan D3: the server scopes every read and write to the caller's artist in one place (src/server/db.ts). These checks keep
// it that way: the system view only where it's allowed, no raw Firestore on artist kinds, no hand-built paths for artist
// sub-collections, no legacy "no artistId means anyone's" guards, `users` lists scoped by artist, and every API route accounted for.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}
const SERVER = [...files("src/server"), ...files("src/app/api"), ...files("mcp")].map((f) => relative(".", f));
const ALL = [...SERVER, ...files("src/app").filter((f) => !f.startsWith("src/app/api")), ...files("src/lib"), ...files("src/components")].map((f) => relative(".", f));
const read = (f: string) => readFileSync(f, "utf8");
const lineOf = (s: string, i: number) => s.slice(0, i).split("\n").length;
/** The function (or const) a match sits in: the nearest declaration before it. */
function enclosing(s: string, i: number): string {
  let name = "";
  for (const m of s.slice(0, i).matchAll(/function\s+(\w+)/g)) name = m[1];
  return name;
}

const ARTIST_KINDS = Object.entries(OWNERS).filter(([, o]) => o === "artist" || o === "artist-self").map(([k]) => k);

/**
 * Where the system view (`systemCtx`, `w.system()`) may be used, by file, and why (plan D3's allow-list). Scripts and tests are
 * whole-database tools and aren't checked.
 */
const SYSTEM_ALLOWED: Record<string, string> = {
  "src/server/commands/booking.ts": "venues.mergeInto rewrites every artist's shows and pitches (platform admins only)",
  "src/server/events/acts.ts": "shared act lookups across artists",
  "src/server/events/refresh.ts": "venue-calendar refresh writes the shared calendars",
  "src/server/assistant/actLookup.ts": "act lookups fill in looked-up facts, not a person's edit",
  "src/server/commands/people.ts": "slugs are global; createArtistFor makes the artist doc",
  "src/server/fans.ts": "the public fan page finds its artist by slug",
  "src/server/commands/invites.ts": "the person has no membership in the inviting artist yet",
  "src/server/session.ts": "sign-in matches by email before any artist is known",
  "src/server/commands/dispatch.ts": "authenticate, and the _meta.runId check",
  "mcp/auth.ts": "MCP key → artist, before a ctx exists",
  "mcp/oauth.ts": "MCP sign-in matches by email before any artist is known",
  "src/server/shortcut.ts": "Shortcut token → artist, before a ctx exists",
  "src/server/tokens.ts": "resolveToken: token → artist, before a ctx exists",
  "src/server/availability.ts": "availability link: the ask is found before its token is checked",
  "src/server/stagePlotShare.ts": "plot link: an older token names no artist; the plot is found before its token is checked",
  "src/server/commands/google.ts": "a Google grant is the person's, across artists",
  "src/server/undo.ts": "historyOfRun and runsOf see (and refuse) entries in other artists",
  "src/server/signedUrl.ts": "resolveSigned: the record is found before its signature is checked",
  "src/app/api/dev-people/route.ts": "emulator only",
  "src/server/newArtistNotice.ts": "the new-artist email to platform admins: reads the new artist and the platform admins, in no artist's ctx",
};
/** `w.forArtist(id)`: only these functions, which reach an artist the ctx isn't in yet through narrow steps. */
const FOR_ARTIST_ALLOWED = new Set(["src/server/commands/people.ts:createArtistFor", "src/server/commands/invites.ts:acceptInvite", "src/server/commands/invites.ts:declineInvite", "src/server/signUp.ts:signUp"]);

test("the system view is used only where the allow-list says", () => {
  const bad: string[] = [];
  for (const f of SERVER) {
    if (f === "src/server/ctx.ts" || f === "src/server/db.ts") continue;
    const s = read(f);
    for (const m of s.matchAll(/\bsystemCtx\(|\bw\.system\(|\.system\(\s*(?:async\s*)?\(/g)) if (!SYSTEM_ALLOWED[f]) bad.push(`${f}:${lineOf(s, m.index!)}`);
  }
  assert.deepEqual(bad, []);
});

test("forArtist is used only by the functions that create an artist or answer an invite", () => {
  const bad: string[] = [];
  for (const f of SERVER) {
    if (f === "src/server/db.ts") continue;
    const s = read(f);
    for (const m of s.matchAll(/\.forArtist\(/g)) {
      const at = `${f}:${enclosing(s, m.index!)}`;
      if (!FOR_ARTIST_ALLOWED.has(at)) bad.push(`${at} (line ${lineOf(s, m.index!)})`);
    }
  }
  assert.deepEqual(bad, []);
});

/** Raw Firestore on an artist kind, outside db.ts: allowed only here, and why. */
const RAW_ALLOWED: Record<string, string> = {
  "src/server/assistant/threads.ts": "assistantThreads bookkeeping (lastActiveAt, runs, messages); every thread carries artistId and confirm/stop/undo check it",
  "src/server/commands/posts.ts": "a no-history modifiedTime refresh on a post already loaded through the scoped Writer",
  "src/server/google/band.ts": "artistDoc(id): the artist's own doc by the id from the caller's ctx",
  "src/server/backup.ts": "whole-database backup and restore",
  "src/server/fans.ts": "deleteFan's hard delete (recursiveDelete), after the scoped get found the fan in this artist",
  "src/server/sites/store.ts": "SiteStore: the site doc, sources, images and versions, written raw (never undone) under the ctx's own artist via pathOf; listAllSiteArtists for the refresh job",
  "src/server/commands/platform.ts": "Admin › Platform's list of every artist and Suspend: platform admins only (requirePlatformAdmin)",
};

test("no raw Firestore on an artist kind outside db.ts and the allow-list", () => {
  const kinds = ARTIST_KINDS.join("|");
  const re = new RegExp(`(?:collection(?:Group)?\\(\\s*["'\`](?:${kinds})["'\`]|\\.doc\\(\\s*\`(?:${kinds})/)`, "g");
  const bad: string[] = [];
  for (const f of SERVER) {
    if (f === "src/server/db.ts" || RAW_ALLOWED[f]) continue;
    const s = read(f);
    for (const m of s.matchAll(re)) bad.push(`${f}:${lineOf(s, m.index!)} ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("artist sub-collection paths are built with pathOf, never by hand", () => {
  const re = /["'`](?:shows|pitches|tours|releases)\/\$\{[^}]+\}\/(?:comments|activity|entries|tracks)["'`]/g;
  const bad: string[] = [];
  for (const f of SERVER) {
    const s = read(f);
    for (const m of s.matchAll(re)) bad.push(`${f}:${lineOf(s, m.index!)} ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("the legacy guards and the one-artist fallbacks are gone", () => {
  const patterns = [
    /!\s*\w+(?:\?)?\.artistId\s*\|\|/g, // (!d.artistId || d.artistId === ctx.artistId)
    /\bctx\.artistId\s*&&\s*\w+\.artistId/g, // ctx.artistId && d.artistId !== ctx.artistId
    /\bw\.ctx\.artistId\s*&&/g,
    /\bctx\.artistId\s*\?\?/g, // ctx.artistId ?? (the first artist)
    /\binArtist\(/g,
    /query\(\s*"artists"\s*,\s*\(q\)\s*=>\s*q\.limit\(1\)/g,
  ];
  const bad: string[] = [];
  for (const f of SERVER) {
    if (f === "src/server/db.ts" || f === "src/server/ctx.ts") continue;
    const s = read(f);
    // Bandsintown's own artist number (artists.bandsintown.artistId) is not the tenant.
    for (const re of patterns) for (const m of s.matchAll(re)) if (!/\bbit\??\.artistId/.test(m[0])) bad.push(`${f}:${lineOf(s, m.index!)} ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test("server lists of users are scoped to the artist (or look one person up by email)", () => {
  const bad: string[] = [];
  for (const f of SERVER) {
    const s = read(f);
    for (const m of s.matchAll(/\b(?:query|list)\(\s*(?:[^,()]+(?:\([^()]*\))?\s*,\s*)?"users"\s*(\)|,\s*\(q\)\s*=>[^\n]*)/g)) {
      if (f === "src/app/api/dev-people/route.ts") continue;
      if (!/artistIds|"email"/.test(m[0])) bad.push(`${f}:${lineOf(s, m.index!)} ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});

/** Plan D3's routes table: where each API route gets its artist. A new route must say. */
const ROUTES: Record<string, string> = {
  "commands/[name]": "authenticate (token + x-artist-id)",
  "assistant/chat": "authenticate", "assistant/confirm": "authenticate; the thread's artist must match", "assistant/stop": "authenticate; the thread's artist must match",
  "assistant/undo": "authenticate; the thread's artist must match", "assistant/transcribe": "authenticate", "assistant/read-image": "authenticate",
  "files/[id]/audio": "authenticate", "stage-plots/[id]/pdf": "authenticate", "releases/[id]/files": "authenticate",
  "shows/[id]/posters": "authenticate", "songs/[id]/upload": "authenticate", "posts/upload": "authenticate",
  "rehearsals/[id]/recording": "authenticate or a shortcut token (resolveToken)",
  "shortcut/now": "shortcut token", "shortcut/rehearsals": "shortcut token", "shortcut/rehearsals/[id]/songs": "shortcut token",
  "availability/[id]/[musicianId]/[token]": "the ask's artistId, after the token hash check",
  "plot/[id]/[token]": "the plot's artistId, after the token check",
  "public/[slug]/signup": "the slug's artist", "public/[slug]/list": "the slug's artist",
  "posts/thumb/[artistId]/[fileId]": "the HMAC's artistId", "posts/media/[postId]/[index]": "the HMAC's artistId (resolveSigned)",
  "google/callback": "the signed state's artistId", "meta/callback": "the signed state's artistId",
  "session": "no artist (system view)", "sign-up": "no artist (PersonCtx; closed until phase 9)",
  "invites/[id]/[action]": "no artist: authenticatePerson builds a PersonCtx; the invite names the artist",
  "dev-people": "emulator only", "version": "none: the build id",
  "sites/img/[artistId]/[sha]": "the HMAC's artistId (siteImg scope)",
  "cron/site-refresh": "none: every site, by its own artistId (importCtx per site); only the site-refresh GitHub workflow (OIDC)",
  "cron/venue-calendars": "none: the shared venue directory, as the system job; only the venue-calendars GitHub workflow (OIDC)",
};

test("every API route is in the routes table", () => {
  const routes = files("src/app/api").filter((f) => f.endsWith("/route.ts")).map((f) => relative("src/app/api", f).replace(/\/route\.ts$/, ""));
  assert.deepEqual(routes.filter((r) => !ROUTES[r]).sort(), [], "add the route to ROUTES with where it gets its artist");
  assert.deepEqual(Object.keys(ROUTES).filter((r) => !routes.includes(r)).sort(), [], "ROUTES names a route that no longer exists");
});

test("nothing in the app writes users.musicianId any more (it is read-only from phase 4)", () => {
  const bad: string[] = [];
  for (const f of ALL) {
    const s = read(f);
    for (const m of s.matchAll(/"users"\s*,\s*[\w.]+\s*,\s*\{\s*musicianId/g)) bad.push(`${f}:${lineOf(s, m.index!)}`);
  }
  assert.deepEqual(bad, []);
});

test("phase 7: nothing reads the old single musician link (users.musicianId, the musicianId claim, Profile.musicianId)", () => {
  // A users doc or profile followed by `.musicianId`; a musician's own `musicianId` fields (lineups, plots, payouts) are fine.
  const re = /\b(?:u|user|users\[\w+\]|profile|state\.profile|useProfile\(\)|before|live|existing|decoded|token|claims)\??\.musicianId\b/g;
  const bad: string[] = [];
  for (const f of ALL) {
    const s = read(f);
    for (const m of s.matchAll(re)) bad.push(`${f}:${lineOf(s, m.index!)} ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});
