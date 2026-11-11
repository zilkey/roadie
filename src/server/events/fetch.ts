/**
 * The venue calendars' raw fetch. Same guards as web.read (src/server/assistant/web.ts): https only, public addresses checked
 * at connect time (no rebinding), every redirect checked like the first. Unlike fetchPage it returns the whole body, untouched
 * (AEG's JSON is ~880 KB), and accepts JSON, XML and iCal as well as HTML.
 */
import https from "node:https";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors";
import type { LookupFunction } from "node:net";

export const MAX_RAW_BYTES = 6_000_000;
const TIMEOUT_MS = 25_000; // some small sites answer slowly from Google Cloud
const MAX_REDIRECTS = 5;
/** Some sites (Swallow Hill) refuse anything that doesn't look like a browser. */
export const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
// (2026-11-10: one site's firewall reset connections for the exact string "Chrome/131.0 Safari/537.36"; a real Chrome string passes.)

export interface RawPage { url: string; status: number; type: string; body: string }
export interface FetchOpts { accept?: string; headers?: Record<string, string> }

function getOnce(url: URL, o: FetchOpts, publicLookup: LookupFunction): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      lookup: publicLookup, timeout: TIMEOUT_MS,
      headers: { "user-agent": BROWSER_UA, accept: o.accept ?? "text/html,application/json,application/xml,text/calendar,*/*;q=0.8", "accept-encoding": "gzip, deflate, br", "accept-language": "en-US,en;q=0.9", ...o.headers },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const type = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ status, location: res.headers.location, type, body: "" }); }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream = enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      let size = 0;
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_RAW_BYTES) { res.destroy(); reject(new AppError("too_large", "That calendar is too big to read", 413)); return; }
        chunks.push(c);
      });
      stream.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
      stream.on("error", reject);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new AppError("timeout", "The calendar took too long", 504)));
    req.on("error", (e: Error & { code?: string }) => reject(e instanceof AppError ? e : new AppError(e.code === "EBLOCKED" ? "not_allowed" : "fetch_failed", e.code === "EBLOCKED" ? "That address isn't on the public web" : `Couldn't open ${url.hostname} (${e.code ?? e.message})`, e.code === "EBLOCKED" ? 403 : 502)));
  });
}

/** Fetch one https URL, following checked redirects. A 4xx/5xx answer is an error. */
export async function fetchRaw(u: string, o: FetchOpts = {}): Promise<RawPage> {
  // web.ts's guards, loaded on first use: web.ts pulls in the assistant (and the command registry, which imports this file).
  const { checkUrl, publicLookup } = await import("../assistant/web");
  let url = checkUrl(u);
  for (let hop = 0; ; hop++) {
    const r = await getOnce(url, o, publicLookup);
    if (r.location !== undefined) {
      if (hop >= MAX_REDIRECTS) throw new AppError("fetch_failed", "Too many redirects", 502);
      url = checkUrl(new URL(r.location, url).href);
      continue;
    }
    if (r.status >= 400) throw new AppError("fetch_failed", `${url.hostname} answered ${r.status}`, 502);
    return { url: url.href, status: r.status, type: r.type, body: r.body };
  }
}

export async function fetchJson<T = unknown>(u: string, o: FetchOpts = {}): Promise<T> {
  const r = await fetchRaw(u, { accept: "application/json,*/*;q=0.5", ...o });
  try { return JSON.parse(r.body) as T; } catch { throw new AppError("fetch_failed", `${new URL(r.url).hostname} didn't send JSON`, 502); }
}

/**
 * The network side, swappable in tests: `setFetcher` installs a fake that answers from fixtures. Readers call `net.raw` / `net.json`.
 * Within one refresh run pages are cached by URL, so a preset page shared by several rooms (Z2, Rockhouse) is fetched once.
 */
type Fetcher = (u: string, o?: FetchOpts) => Promise<RawPage>;

/**
 * e2e only: when VENUE_EVENTS_FIXTURES names a directory, the default fetcher answers from files in it, never the network.
 * A URL maps to host + path + query with every non-alphanumeric run turned into "_" (https://calendar.example.com/shows.ics
 * is calendar_example_com_shows_ics); the file is that name as is, or with .ics/.json/.html/.xml added. Nothing there: a 404.
 */
export const fixtureName = (u: string) => { const x = new URL(u); return `${x.hostname}${x.pathname}${x.search}`.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, ""); };
async function fixtureFetch(dir: string, u: string): Promise<RawPage> {
  const base = path.join(dir, fixtureName(u));
  for (const ext of ["", ".ics", ".json", ".html", ".xml"]) {
    try {
      if (!fs.statSync(base + ext).isFile()) continue;
      const type = ext === ".ics" ? "text/calendar" : ext === ".json" ? "application/json" : ext === ".xml" ? "application/xml" : "text/html";
      return { url: u, status: 200, type, body: fs.readFileSync(base + ext, "utf8") };
    } catch { /* try the next extension */ }
  }
  throw new AppError("fetch_failed", `${new URL(u).hostname} answered 404`, 502);
}
const defaultFetcher: Fetcher = (u, o) => (process.env.VENUE_EVENTS_FIXTURES ? fixtureFetch(process.env.VENUE_EVENTS_FIXTURES, u) : fetchRaw(u, o));
let fetcher: Fetcher = defaultFetcher;
export const setFetcher = (f: Fetcher | null) => { fetcher = f ?? defaultFetcher; };

export class Net {
  private cache = new Map<string, Promise<RawPage>>();
  raw(u: string, o: FetchOpts = {}): Promise<RawPage> {
    const key = `${u}|${o.accept ?? ""}|${o.headers?.["user-agent"] ?? ""}`; // a retry with another user agent is a new fetch
    let p = this.cache.get(key);
    if (!p) { p = fetcher(u, o); this.cache.set(key, p); p.catch(() => this.cache.delete(key)); }
    return p;
  }
  async json<T = unknown>(u: string, o: FetchOpts = {}): Promise<T> {
    const r = await this.raw(u, { accept: "application/json,*/*;q=0.5", ...o });
    try { return JSON.parse(r.body) as T; } catch { throw new AppError("fetch_failed", `${new URL(r.url).hostname} didn't send JSON`, 502); }
  }
}
