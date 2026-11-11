/**
 * The selector reader: a server-rendered calendar page read with saved CSS selectors. `item` matches one element per event;
 * each field is read inside it (text by default, or an attribute). A field's selector may be "" or ":scope" for the item itself.
 * Relative links and image paths resolve against the page URL. Shared templates are presets (presets.ts).
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { SelectorField, VenueCalendar } from "@/schema";
import { AppError } from "../errors";
import type { RawEvent, Reader, ReaderResult } from "./types";
import { PRESET_DEFS } from "./presets";

type SelCal = Extract<VenueCalendar, { type: "selectors" }>;
type Fields = NonNullable<SelCal["fields"]>;
export interface SelectorConfig { item: string; fields: Fields; dateFormat?: string; bill?: ReaderResult["bill"]; url?: string }

/** The venue's own settings over its preset's. */
export function resolveSelectors(cal: SelCal): SelectorConfig {
  const p = cal.preset ? PRESET_DEFS[cal.preset] : undefined;
  const item = cal.item ?? p?.item;
  const fields = { ...(p?.fields ?? {}), ...(cal.fields ?? {}) };
  if (!item || !fields.title) throw new AppError("invalid_input", cal.preset ? `Preset ${cal.preset} has no selectors yet` : "This calendar has no selectors yet", 400);
  return { item, fields, dateFormat: cal.dateFormat ?? p?.dateFormat, bill: p?.bill, url: p?.url };
}

const INLINE = new Set(["a", "b", "i", "em", "strong", "span", "small", "u", "sup", "sub", "abbr", "time", "mark", "var", "font"]);
/** An element's text with a space between blocks ("<h3>Band</h3><p>Opener</p>" → "Band Opener"), none inside a word's inline tags. */
function text(_$: cheerio.CheerioAPI, el: AnyNode): string {
  const out: string[] = [];
  const walk = (n: AnyNode) => {
    if (n.type === "text") { out.push((n as unknown as { data: string }).data); return; }
    const e = n as Element;
    if (!e.children) return;
    const block = e.type === "tag" && !INLINE.has(e.name);
    if (block) out.push(" ");
    if (e.name === "br") { out.push(" "); return; }
    for (const c of e.children) walk(c);
    if (block) out.push(" ");
  };
  walk(el);
  return out.join("").replace(/\s+/g, " ").trim();
}

function pick($: cheerio.CheerioAPI, item: Element, sel: string) {
  const s = sel.trim();
  return !s || s === ":scope" || s === "&" ? $(item) : $(item).find(s);
}

const BG = /url\(\s*['"]?([^'")]+)['"]?\s*\)/i;
/** An image's address: src, else data-src / lazy attributes, else the first srcset entry, else a background-image. */
function imageOf($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>, attr?: string): string | undefined {
  if (attr) {
    const v = el.attr(attr);
    if (v && attr.toLowerCase().includes("srcset")) return v.split(",")[0].trim().split(/\s+/)[0];
    if (v && attr === "style") return BG.exec(v)?.[1];
    return v || undefined;
  }
  const img = el.is("img, source") ? el : el.find("img").first();
  const target = img.length ? img : el;
  for (const a of ["src", "data-src", "data-lazy-src", "data-original", "data-image"]) {
    const v = target.attr(a);
    if (v && !v.startsWith("data:")) return v;
  }
  const ss = target.attr("srcset") ?? target.attr("data-srcset");
  if (ss) return ss.split(",")[0].trim().split(/\s+/)[0];
  const style = target.attr("style") ?? el.attr("style");
  return style ? BG.exec(style)?.[1] : undefined;
}

function read($: cheerio.CheerioAPI, item: Element, f: SelectorField | undefined, kind: "text" | "url" | "image"): string | undefined {
  if (f === undefined) return undefined;
  const sel = typeof f === "string" ? f : f.sel;
  const attr = typeof f === "string" ? undefined : f.attr;
  const el = pick($, item, sel).first();
  if (!el.length) return undefined;
  if (kind === "image") return imageOf($, el, attr);
  if (attr) return el.attr(attr)?.trim() || undefined;
  if (kind === "url") return (el.is("a") ? el.attr("href") : el.find("a").first().attr("href") ?? el.closest("a").attr("href"))?.trim() || undefined;
  const t = text($, el[0]);
  return t || undefined;
}

const abs = (u: string | undefined, base: string) => {
  if (!u) return undefined;
  try { const x = new URL(u.trim(), base); return /^https?:$/.test(x.protocol) ? x.href : undefined; } catch { return undefined; }
};

/** Run selectors over a page: the rows they produce (used by the reader, by setup's preview, and by the Gemini check). */
export function extract(html: string, pageUrl: string, cfg: SelectorConfig): RawEvent[] {
  const $ = cheerio.load(html);
  const out: RawEvent[] = [];
  $(cfg.item).each((_, node) => {
    const item = node as Element;
    const f = cfg.fields;
    const title = read($, item, f.title, "text");
    if (!title) return;
    // A configured url selector is the only source: falling back to the first link picked up map and image links.
    const url = abs(f.url !== undefined ? read($, item, f.url, "url") : read($, item, { sel: ":scope", attr: "href" }, "url") ?? read($, item, "a", "url"), pageUrl);
    const dateAttr = typeof f.date === "object" ? read($, item, f.date, "text") : undefined;
    const dateText = dateAttr ?? read($, item, f.date, "text");
    const acts = f.acts !== undefined
      ? pick($, item, typeof f.acts === "string" ? f.acts : f.acts.sel).toArray().map((el) => (typeof f.acts === "object" ? $(el).attr(f.acts.attr) ?? "" : text($, el))).filter(Boolean)
      : undefined;
    const status = read($, item, f.status, "text");
    out.push({
      title,
      ...(dateText ? { dateText } : {}),
      ...(read($, item, f.time, "text") ? { timeText: read($, item, f.time, "text") } : {}),
      ...(read($, item, f.doors, "text") ? { doorsText: read($, item, f.doors, "text") } : {}),
      ...(url ? { ticketUrl: url } : {}), // no sourceId: a page may list one URL for every date of a recurring show (toDraft adds the date)
      ...(abs(read($, item, f.image, "image"), pageUrl) ? { imageUrl: abs(read($, item, f.image, "image"), pageUrl) } : {}),
      ...(acts?.length ? { acts: acts.map((name, i) => ({ name, role: i === 0 ? "headliner" as const : "support" as const })) } : {}),
      ...(read($, item, f.venue, "text") ? { venueName: read($, item, f.venue, "text") } : {}),
      ...(status && /sold\s*out/i.test(status) ? { status: "soldout" as const } : status && /cancel/i.test(status) ? { status: "cancelled" as const } : {}),
    });
  });
  return out;
}

export const readSelectors: Reader<"selectors"> = async (cal, ctx) => {
  const cfg = resolveSelectors(cal);
  const page = await ctx.net.raw(cal.url ?? cfg.url!);
  return { events: extract(page.body, page.url, cfg), bill: cfg.bill ?? "title", ...(cfg.dateFormat ? { dateFormat: cfg.dateFormat } : {}) };
};
