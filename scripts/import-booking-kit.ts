/**
 * Imports the three claude.ai booking trackers (Venue Book, Festival Run 2027, Support Slots) from the
 * snapshots in .booking-kit/ (gitignored: real contacts, public repo). All writes go through db.ts with
 * via 'import' and one runId, so Admin → History can undo the whole import.
 *
 * Idempotent: records get fixed ids (vb-*, fr-*, ss-*) and venues/promoters/festivals/contacts dedupe on
 * matchKey, so a second run only adds what is new. Needs the artist (and musicians, for personnel) set up.
 *   npm run import:booking                 (emulators: FIRESTORE_EMULATOR_HOST etc. set by the npm script)
 *   npm run import:booking -- --dry-run    (validate and count, write nothing)
 *   npm run import:booking -- --artist=ingrid-avison-band   (which artist, when there is more than one)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, run, type Doc, type Writer } from "../src/server/db";
import { importCtx } from "../src/server/ctx";
import { isPrivateField } from "../src/lib/venues";
import { hasPrivate, noteOf, writeNote } from "../src/server/venues";
import { email as emailSchema } from "../src/schema/common";
import { e164 } from "../src/schema/normalize";
import { roleIn } from "../src/schema/users";
import { joinNames } from "../src/lib/shows";
import { dateInBandZone } from "../src/lib/timezone";

const DIR = join(process.cwd(), ".booking-kit");
const DRY = process.argv.includes("--dry-run");
const load = <T>(f: string): T => JSON.parse(readFileSync(join(DIR, f), "utf8")) as T;
const TODAY = dateInBandZone();

type Region = "boulder" | "denver" | "north" | "south" | "mountains" | "southwest" | "out";
const counts: Record<string, number> = {};
const bump = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };
const warnings: string[] = [];
/** Venue Book contacts left out on purpose (by name, lowercase). */
const SKIP_CONTACTS = new Set(["angel"]);

// ---------- shared helpers ----------

const REGION_CITIES: [Region, RegExp][] = [
  ["boulder", /boulder|longmont|lyons|lafayette|gold hill|jamestown|hygiene|gunbarrel|louisville|superior|niwot|erie/i],
  ["denver", /denver|westminster|arvada|castle rock|englewood|golden|parker|wheat ridge|broomfield|aurora|lakewood/i],
  ["north", /fort collins|loveland|greeley|milliken|berthoud|windsor|northern co/i],
  ["south", /colorado springs|manitou|divide|pueblo|ca[nñ]on city/i],
  ["mountains", /idaho springs|silver plume|buena vista|salida|carbondale|nederland|conifer|dillon|frisco|breckenridge|steamboat|vail|ridgway|palisade/i],
  ["southwest", /durango|cortez|dolores|pagosa|del norte|alamosa|montrose/i],
];
function regionForCity(city: string, state = "CO"): Region | undefined {
  if (state && state !== "CO") return "out";
  return REGION_CITIES.find(([, re]) => re.test(city))?.[0];
}
const FEST_REGIONS: Record<string, Region> = {
  "Denver metro": "denver", "Boulder County": "boulder", "Northern CO": "north", "Southern CO": "south",
  Mountains: "mountains", "Upper Arkansas": "mountains", "Western Slope": "mountains",
  Southwest: "southwest", "San Luis Valley": "southwest", "Out of state": "out",
};

/** "Boulder, CO" -> {city, state}. No comma: the whole string is the city, in CO. */
function splitCity(s: string): { city: string; state: string } {
  const m = s.trim().match(/^(.*),\s*([A-Z]{2})$/);
  if (m) return { city: m[1].trim(), state: m[2] };
  return { city: s.trim(), state: /\bTX\b/.test(s) ? "TX" : "CO" };
}

const validEmail = (s: string) => emailSchema.safeParse(s.trim().toLowerCase()).success;
const validPhone = (s: string) => /^\+[1-9]\d{6,14}$/.test(e164(s));
const lines = (...xs: (string | false | undefined | null)[]) => xs.filter((x): x is string => !!x && !!x.trim()).join("\n") || undefined;

let artist: Doc;
let musiciansByName: Map<string, string>;
let assigneeId: string | undefined;
const configMusicians = (cfg: string) => (artist.configurations as { id: string; musicianIds: string[] }[]).find((c) => c.id === cfg)?.musicianIds;
const hasConfig = (cfg: string) => !!configMusicians(cfg);

/** Create with a fixed id unless that id already exists. Dedupe collections may merge into another id. */
async function ensure(w: Writer, path: string, id: string, doc: Record<string, unknown>): Promise<string> {
  const existing = await w.get(path, id);
  if (existing) { bump(`${path} (already there)`); return id; }
  const r = await w.create(path, doc, { id });
  bump(r.merged ? `${path} (merged into existing)` : path);
  return r.id;
}

/**
 * A venue from the trackers: the room goes in the shared directory, its contacts/promoters/notes are this artist's private venueNotes
 * (the same split venues.create makes). Where the room already exists (dedupe merge or a rerun) the band's notes are filled in, never replaced.
 */
async function ensureVenue(w: Writer, id: string, doc: Record<string, unknown>): Promise<string> {
  const priv = Object.fromEntries(Object.entries(doc).filter(([k, v]) => isPrivateField(k) && v !== undefined));
  const vid = await ensure(w, "venues", id, Object.fromEntries(Object.entries(doc).filter(([k]) => !isPrivateField(k))));
  const venue = (await w.get("venues", vid))!;
  const { doc: noteDoc, fields } = await noteOf(w, venue, artist.id);
  const union = (a: string[], b: unknown) => [...new Set([...a, ...((b as string[] | undefined) ?? [])])];
  const next = {
    contactIds: union(fields.contactIds, priv.contactIds), promoterIds: union(fields.promoterIds, priv.promoterIds),
    ...(!fields.notes && priv.notes ? { notes: priv.notes as string } : {}), ...(!fields.loadInNotes && priv.loadInNotes ? { loadInNotes: priv.loadInNotes as string } : {}),
  };
  const changed = next.contactIds.length !== fields.contactIds.length || next.promoterIds.length !== fields.promoterIds.length || "notes" in next || "loadInNotes" in next;
  if (changed && (noteDoc || hasPrivate({ ...fields, ...next }))) await writeNote(w, venue, artist.id, next);
  return vid;
}

interface ContactIn { name: string; emails: string[]; phones: string[]; notes?: string; title?: string }
async function contact(w: Writer, idHint: string, c: ContactIn): Promise<string> {
  const emails = [...new Set(c.emails.map((e) => e.trim().toLowerCase()).filter(validEmail))];
  const phones = [...new Set(c.phones.map(e164).filter((p) => /^\+[1-9]\d{6,14}$/.test(p)))];
  const bad = [...c.emails.filter((e) => !validEmail(e)), ...c.phones.filter((p) => !validPhone(p))];
  return ensure(w, "contacts", idHint, {
    name: c.name, title: c.title, emails, phones, notes: lines(c.notes, bad.length > 0 && `Unparsed: ${bad.join(", ")}`),
  });
}

// ---------- Venue Book ----------

interface VbContact { name?: string; email?: string; phone?: string; note?: string }
interface VbShow { date: string; dateLabel?: string; time?: string; event?: string; billedAs?: string; who?: string; setLength?: string; sound?: string; pay?: string; notes?: string; olive?: string; where?: string }
interface VbVenue { id: string; name: string; city: string; type: string; lead?: string; link?: string; notes?: string; contacts: VbContact[]; shows: VbShow[] }

const VB_TYPES: Record<string, string> = {
  "Listening room": "listening", "Cafe / listening room": "listening", "House concert": "house", "Brewery / taproom": "brewery",
  "Bar / club": "bar", Festival: "outdoor", "Outdoor series": "outdoor", "Farm / outdoor": "outdoor",
};

/** "7:00 PM" -> "19:00". Anything looser stays in the show notes. */
function clock(s: string | undefined): string | undefined {
  const m = s?.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return undefined;
  const h = (+m[1] % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
function minutes(s: string | undefined): number | undefined {
  const t = s?.trim().toLowerCase() ?? "";
  const m = t.match(/^(\d+)\s*(min|mins|minutes)?$/);
  if (m) return +m[1];
  const h = t.match(/^(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs)$/);
  return h ? Math.round(+h[1] * 60) : undefined;
}
/** Who played -> a configuration id when it is clearly one. */
function configFor(who: string | undefined): string | undefined {
  const w = (who ?? "").trim().toLowerCase();
  if (/full band|whole band/.test(w)) return "full-band";
  if (w === "ingrid" || w === "solo") return "ingrid-solo";
  if (/^ingrid,\s*jeff$/.test(w)) return "duo";
  return undefined;
}
function personnelFor(who: string | undefined, cfg: string | undefined): string[] {
  if (cfg && configMusicians(cfg)) return configMusicians(cfg)!;
  const names = (who ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return [...new Set(names.map((n) => musiciansByName.get(n)).filter((x): x is string => !!x))];
}
type Deal = { deal: "guarantee" | "doorSplit" | "flat" | "tips" | "free"; guarantee?: number };
function dealFor(pay: string | undefined): Deal {
  const p = (pay ?? "").trim().toLowerCase();
  const amt = p.match(/^\$?\s*(\d+(?:\.\d{2})?)$/);
  if (amt) return { deal: "guarantee", guarantee: Math.round(+amt[1] * 100) };
  if (/^(none|free|no pay|0)$/.test(p)) return { deal: "free" };
  if (/tip/.test(p)) return { deal: "tips" };
  if (/door|%/.test(p)) return { deal: "doorSplit" };
  return { deal: "flat" };
}

/** Venue Book "festivals" that are already in Festival Run (Venue Book id -> Festival Run id). */
const VB_FESTIVALS: Record<string, string> = {
  "boulder-creek-fest": "bouldercreek", "greeley-arts-picnic": "artspicnic", "water-lantern": "waterlantern", "porchfest-boulder": "porchfest",
};
/** Shows at a real venue that were part of a festival (`venueBookId:date` -> Festival Run id). */
const VB_SHOW_FESTIVALS: Record<string, string> = { "wolverine:2026-04-24": "focomx" };
/** House concerts with no host contact in the Venue Book: the host, from the entry's name. */
const VB_HOSTS: Record<string, string> = { "amy-hc": "Amy", testhost: "Testhost", "lee-hc": "Lee", poppe: "Kristen Poppe", "shelleys-place": "Shelley" };

/** One edition per festival per year we played it (Festival Run already has 2027). */
async function editionFor(w: Writer, festivalId: string, year: string, dates: string[], sources: unknown[]) {
  const festival = (await w.get("festivals", festivalId))!;
  const sorted = [...dates].sort();
  const id = await ensure(w, "editions", `${festivalId}-${year}`, {
    festivalId, festivalName: festival.name, year: +year, label: year, startDate: sorted[0],
    endDate: sorted.at(-1) !== sorted[0] ? sorted.at(-1) : undefined, venueIds: [], sources,
  });
  return { id, name: `${festival.name} ${year}` };
}

async function importVenueBook() {
  const { source, pulledAt, venues } = load<{ source: string; pulledAt: string; venues: VbVenue[] }>("venue-book.json");
  const sources = [{ url: source, checkedAt: pulledAt, note: "Venue Book (claude.ai tracker)" }];
  for (const v of venues) {
    await run(ctx, async (w) => {
      const { city, state } = v.city ? splitCity(v.city) : { city: "Unknown", state: "CO" };
      const region = regionForCity(city, state) ?? "boulder";
      if (!v.city || !regionForCity(city, state)) warnings.push(`Venue Book "${v.name}": city "${v.city}" → region ${region} (check it)`);
      const house = v.type === "House concert";
      const festivalEntry = v.type === "Festival" || !!VB_FESTIVALS[v.id];
      const placeNotes = lines(v.type && !VB_TYPES[v.type] && v.type !== "Other" && `Kind: ${v.type}`, v.lead && `Booking window: ${v.lead}`, v.link, v.notes);

      const contactIds: string[] = [];
      for (const [i, c] of v.contacts.entries()) {
        if (!c.name && !c.email && !c.phone) continue;
        if (!c.email && SKIP_CONTACTS.has((c.name ?? "").trim().toLowerCase())) continue;
        contactIds.push(await contact(w, `vb-${v.id}-c${i + 1}`, {
          name: c.name?.trim() || c.email?.trim() || `${v.name} contact`, emails: c.email ? [c.email] : [], phones: c.phone ? [c.phone] : [],
          // A house has no record of its own: what the Venue Book knew about it goes on the (first) host.
          notes: lines(c.note, house && i === 0 && placeNotes && `${v.name}: ${placeNotes}`),
        }));
      }
      if (house && !contactIds.length && VB_HOSTS[v.id]) {
        contactIds.push(await contact(w, `vb-${v.id}-c1`, { name: VB_HOSTS[v.id], emails: [], phones: [], notes: lines(`Hosted ${v.name}`, placeNotes) }));
      }

      // Where the shows happen: a venue, a house (hosts + city), or a festival (its own record, one edition per year).
      let venueId: string | undefined;
      let festivalId: string | undefined;
      if (festivalEntry) {
        festivalId = VB_FESTIVALS[v.id] ? `fr-${VB_FESTIVALS[v.id]}` : await ensure(w, "festivals", `vb-${v.id}`, {
          name: v.name.trim(), type: "festival", region, website: v.link || undefined, contactIds, notes: lines(v.lead && `Booking window: ${v.lead}`, v.notes), sources,
        });
        const fest = (await w.get("festivals", festivalId))!;
        const missing = contactIds.filter((c) => !(fest.contactIds as string[]).includes(c));
        if (missing.length) await w.update("festivals", festivalId, { contactIds: [...(fest.contactIds as string[]), ...missing] });
      } else if (!house) {
        venueId = await ensureVenue(w, `vb-${v.id}`, {
          name: v.name.trim(), type: VB_TYPES[v.type] ?? "other", address: { city, state }, region,
          website: v.link || undefined, contactIds, promoterIds: [], sources,
          notes: lines(v.type && !VB_TYPES[v.type] && v.type !== "Other" && `Kind: ${v.type}`, v.lead && `Booking window: ${v.lead}`, v.notes),
        });
      }
      const venueName = venueId ? String((await w.get("venues", venueId))!.name) : undefined;
      const hostName = house ? joinNames(await Promise.all(contactIds.map(async (id) => String((await w.get("contacts", id))!.name)))) : undefined;
      const datesByYear = new Map<string, string[]>();
      for (const s of v.shows) if (s.date) datesByYear.set(s.date.slice(0, 4), [...(datesByYear.get(s.date.slice(0, 4)) ?? []), s.date]);

      const seen = new Map<string, number>();
      for (const s of [...v.shows].sort((a, b) => a.date.localeCompare(b.date))) {
        if (!s.date) continue;
        const n = (seen.get(s.date) ?? 0) + 1; seen.set(s.date, n);
        const showId = `vb-${v.id}-${s.date}${n > 1 ? `-${n}` : ""}`;
        const hold = /^hold/i.test(s.event ?? "");
        const past = s.date < TODAY;
        const status = hold ? (past ? "canceled" : "hold") : past ? "played" : "confirmed";
        const cfg = configFor(s.who);
        const set = clock(s.time);
        const setLength = minutes(s.setLength);
        const soundText = s.sound?.trim();
        const showFest = VB_SHOW_FESTIVALS[`${v.id}:${s.date}`];
        const edition = festivalId ? await editionFor(w, festivalId, s.date.slice(0, 4), datesByYear.get(s.date.slice(0, 4))!, sources)
          : showFest ? await editionFor(w, `fr-${showFest}`, s.date.slice(0, 4), [s.date], sources) : undefined;
        const kind = house ? "house" : edition ? "festival" : /radio/i.test(v.type) ? "radio" : "venue";
        const created = await ensure(w, "shows", showId, {
          date: s.date, status, kind,
          ...(venueId ? { venue: { id: venueId, name: venueName!, city } } : { place: { city } }),
          ...(house && contactIds.length ? { hostContactIds: contactIds, hostName } : {}),
          editionId: edition?.id, editionName: edition?.name ?? (s.billedAs?.trim() || undefined),
          times: { ...(set ? { set } : {}), ...(setLength ? { setLength } : {}) },
          artistId: artist.id, billedAs: cfg && hasConfig(cfg) ? cfg : undefined, personnel: personnelFor(s.who, cfg),
          sound: { provider: /band|ours|we bring|jeff/i.test(soundText ?? "") || (house && !soundText) ? "bandProvided" : "venueProvided", notes: soundText || undefined },
          needs: { poster: false, backline: false, merch: false }, checklist: [], gear: [], docs: [], public: false, listings: {},
          bandNotes: lines(
            s.dateLabel && `Dates: ${s.dateLabel}`, s.event, edition && s.billedAs && s.billedAs, hold && past && "Hold that didn't confirm",
            house && !contactIds.length && `Was in the Venue Book as "${v.name}"`,
            s.who && `Who: ${s.who}`, s.time && !set && `Time: ${s.time}`, s.setLength && !setLength && `Set: ${s.setLength}`,
            s.pay && `Pay: ${s.pay}`, s.olive && `Olive: ${s.olive}`, s.where && s.where !== v.city && `Where: ${s.where}`, s.notes,
          ),
        });
        if (status === "canceled") continue;
        // Past shows count as settled so Home and Roadie don't ask for their money; the pay text is in the notes.
        await ensure(w, "showDeals", created, { contactIds: house ? contactIds : [], editionId: edition?.id, ...dealFor(s.pay), settled: past });
      }
    });
  }
}

// ---------- Festival Run 2027 ----------

interface FrEvent {
  id: string; n: string; c?: string; r?: string; t?: "A" | "B" | "C"; ty: "Festival" | "Series" | "Promoter"; sr?: 1;
  s?: string; e?: string; o?: string; ok?: "est" | "conf"; d?: string; dk?: "est" | "conf" | "target";
  url?: string; ct?: string; g?: string; nt?: string; sp?: 1;
}
const FR_STATUS: Record<string, string> = { todo: "toPitch", pitched: "pitched", waiting: "waiting", accepted: "booked", declined: "declined", skip: "dropped" };
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /^\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}$/;

/** "Name, Org · a@b.org · 303-555-1212" -> contacts for each segment with an email; a lone phone joins the only contact. */
function contactsFromText(ct: string | undefined, fallbackName: string): ContactIn[] {
  if (!ct) return [];
  const segs = ct.split(/\s+·\s+|\s*,\s+(?=[^,]*@)/);
  const out: ContactIn[] = [];
  const phones: string[] = [];
  for (const seg of segs) {
    const emails = seg.match(EMAIL_RE) ?? [];
    if (emails.length) {
      for (const e of emails) {
        const name = seg.replace(EMAIL_RE, "").replace(/[(),]/g, " ").trim().replace(/\s+/g, " ");
        out.push({ name: name || fallbackName, emails: [e], phones: [], notes: /\(music\)/.test(seg) ? "Music" : undefined });
      }
    } else if (PHONE_RE.test(seg.trim())) phones.push(seg.trim());
  }
  if (out.length === 1) out[0].phones.push(...phones);
  return out;
}

async function importFestivalRun() {
  const { source, pulledAt, events, state } = load<{ source: string; pulledAt: string; events: FrEvent[]; state: { t: Record<string, { st?: string; ap?: string; nt?: string }> } }>("festival-run.json");
  const sources = [{ url: source, checkedAt: pulledAt, note: "Festival Run 2027 (claude.ai tracker)" }];
  for (const ev of events) {
    await run(ctx, async (w) => {
      const city = (ev.c ?? "").split(/\s+[–-]\s+/)[0];
      const region = (ev.r && FEST_REGIONS[ev.r]) ?? regionForCity(city) ?? "boulder";
      if (!(ev.r && FEST_REGIONS[ev.r]) && !regionForCity(city)) warnings.push(`Festival Run "${ev.n}": region "${ev.r ?? ""}" → ${region} (check it)`);
      const contactIds: string[] = [];
      for (const [i, c] of contactsFromText(ev.ct, `${ev.n} booking`).entries()) contactIds.push(await contact(w, `fr-${ev.id}-c${i + 1}`, c));
      const notes = lines(ev.t && `Tier ${ev.t}`, ev.c && `Where: ${ev.c}`, ev.nt, ev.ct && `Contact: ${ev.ct}`, ev.sp && "Invite only: no open call.");
      const tracked = state.t[ev.id];
      const status = tracked?.st ? FR_STATUS[tracked.st] ?? "toPitch" : ev.t === "C" || ev.sp ? "idea" : "toPitch";

      let target: { kind: "edition" | "promoter"; id: string; name: string };
      if (ev.ty === "Promoter") {
        const id = await ensure(w, "promoters", `fr-${ev.id}`, { name: ev.n, kind: "promoter", website: ev.url, contactIds, venueIds: [], notes, sources });
        target = { kind: "promoter", id, name: ev.n };
      } else {
        const festivalId = await ensure(w, "festivals", `fr-${ev.id}`, {
          name: ev.n, type: ev.ty === "Series" || ev.sr ? "series" : "festival", region, website: ev.url, genres: ev.g, contactIds,
          typicalMonth: ev.s ? +ev.s.slice(5, 7) : undefined, notes, sources,
        });
        const festival = (await w.get("festivals", festivalId))!;
        const editionId = await ensure(w, "editions", `fr-${ev.id}-2027`, {
          festivalId, festivalName: festival.name, year: 2027, label: "2027", startDate: ev.s, endDate: ev.e && ev.e !== ev.s ? ev.e : undefined,
          appOpens: ev.o ? { date: ev.o, sure: ev.ok === "conf" ? "confirmed" : "estimated" } : undefined,
          appDeadline: ev.d ? { date: ev.d, sure: ev.dk === "conf" ? "confirmed" : ev.dk === "est" ? "estimated" : "target" } : undefined,
          applyUrl: ev.url, venueIds: [], sources,
        });
        target = { kind: "edition", id: editionId, name: `${festival.name} 2027` };
      }
      const due = ev.d && ev.d >= TODAY ? ev.d : ev.o && ev.o >= TODAY ? ev.o : undefined;
      const open = status === "toPitch" || status === "idea";
      await pitch(w, `fr-${ev.id}`, target, status, {
        nextStep: open && due ? { text: due === ev.d ? (ev.dk === "target" ? "Pitch by" : "Apply by deadline") : "Applications open", due } : undefined,
        notes: tracked?.nt, pitchedOn: tracked?.ap,
      });
    });
  }
}

// ---------- Support Slots ----------

interface SsVenue { id: string; tier: 1 | 2 | 3; n: string; c: string; cap: string; who: string; how: string; ct: string; verify?: boolean; ask?: string; why: string }
const SS_STATUS: Record<string, string> = { todo: "toPitch", pitched: "pitched", waiting: "waiting", booked: "booked", declined: "declined", skip: "dropped" };
const SS_TYPES: Record<string, string> = {
  hidive: "bar", lostlake: "club", larimer: "club", globe: "club", roots: "listening", velvet: "bar", swallow: "listening", seventh: "other",
  louisville: "bar", fox: "theater", bouldertheater: "theater", aggie: "theater", washingtons: "club", oriental: "theater", ophelias: "club",
  marquis: "club", bluebird: "theater", gothic: "theater", summit: "club",
};
/** Buyers named in the support doc: who books which room. */
const SS_PROMOTERS: { id: string; name: string; kind: "promoter" | "venueGroup" | "nonprofit" | "buyer"; venues: string[]; website?: string; howToPitch?: string; notes?: string }[] = [
  { id: "z2", name: "Z2 Entertainment", kind: "promoter", venues: ["fox", "bouldertheater", "aggie", "velvet"], website: "https://z2ent.com",
    howToPitch: "Email bookingasst@z2ent.com with social and web links, contact info, and a brief history of shows played in the area. Ask for local support on indie touring dates.",
    notes: "Buyers: joe@z2ent.com (Fox, booking across rooms), david@z2ent.com (Boulder Theater). Keeps a public door open to local bands." },
  { id: "larimer-group", name: "Larimer Lounge group", kind: "venueGroup", venues: ["lostlake", "larimer", "globe"],
    howToPitch: "Booking form on any of the three sites (asks your Denver draw: answer with a number), or one email to haylee@ and jackson@larimerlounge.com naming all three rooms.",
    notes: "Owner Scott Campbell is also an AEG talent buyer: the on-ramp to the Bluebird and Gothic." },
  { id: "live-nation-co", name: "Live Nation Colorado", kind: "promoter", venues: ["marquis", "summit"],
    howToPitch: "No public submission. Support comes from their buyers or the touring act's agent: open for touring bands at Larimer / Hi-Dive, then ask their agent for the date next time through." },
  { id: "aeg-rm", name: "AEG Presents Rocky Mountains", kind: "promoter", venues: ["bluebird", "gothic"],
    howToPitch: "Support placed by AEG buyers and the headliner's agent. Build the Larimer group relationship first." },
  { id: "roots-music-project", name: "Roots Music Project", kind: "nonprofit", venues: ["roots"], website: "https://rootsmusicproject.org",
    howToPitch: "Ask Ian Steele directly (warm relationship). Also runs the BIFF showcase at Velvet Elk and the Tulagi festival.",
    notes: "Dave Kennedy and Ian Steele teach the venue-booking workshop; a referral from them carries weight at the Fox, Velvet Elk and the Larimer rooms." },
  { id: "bohemian", name: "Bohemian Foundation", kind: "nonprofit", venues: ["washingtons"], website: "https://bohemianfoundation.org",
    notes: "Music District is the local-artist side door; also runs Thursday Night Live." },
];
const TIER_LABEL = { 1: "Tier 1 · pitch now", 2: "Tier 2 · after two or three Tier 1 shows", 3: "Tier 3 · later" } as const;

function ssAddress(c: string): { city: string; street?: string } {
  const [city, rest = ""] = c.split(/\s+·\s+/);
  const paren = rest.match(/\(([^)]+)\)/)?.[1];
  const street = paren ?? (/^\d/.test(rest) ? rest.split(",")[0] : undefined);
  return { city: city.trim(), street: street?.trim() };
}

async function importSupportSlots() {
  const { source, pulledAt, venues, tracking } = load<{ source: string; pulledAt: string; venues: SsVenue[]; tracking: Record<string, { status?: string; date?: string; notes?: string }> }>("support-slots.json");
  const sources = [{ url: source, checkedAt: pulledAt, note: "Support Slot Targets (claude.ai tracker)" }];
  const venueIds: Record<string, string> = {};
  for (const v of venues) {
    await run(ctx, async (w) => {
      const { city, street } = ssAddress(v.c);
      const contactIds: string[] = [];
      for (const [i, e] of (v.ct.match(EMAIL_RE) ?? []).entries()) {
        const local = e.split("@")[0];
        const name = /^(booking|bookingasst|info|hello|contact)$/i.test(local) ? `${v.n} booking` : local.replace(/[._]/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
        contactIds.push(await contact(w, `ss-${v.id}-c${i + 1}`, { name, emails: [e], phones: [], notes: v.verify ? "Second-hand source: verify" : undefined }));
      }
      const phone = v.ct.match(/\d{3}-\d{3}-\d{4}/)?.[0];
      if (phone && !contactIds.length) contactIds.push(await contact(w, `ss-${v.id}-c1`, { name: `${v.n} booking`, emails: [], phones: [phone] }));
      const cap = v.cap.match(/\d+/g)?.map(Number);
      const id = await ensureVenue(w, `ss-${v.id}`, {
        name: v.n, type: SS_TYPES[v.id] ?? "other", address: { city, state: "CO", ...(street ? { street } : {}) }, region: regionForCity(city) ?? "denver",
        capacity: cap ? Math.max(...cap) : undefined, ages: /all members 21\+|21\+ only|mostly 21\+/i.test(v.ask ?? "") ? "21" : /all ages/i.test(v.ask ?? "") ? "all" : undefined,
        website: /^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(v.ct) ? v.ct.split(/\s/)[0] : undefined,
        contactIds, promoterIds: [], sources,
        notes: lines(TIER_LABEL[v.tier], `Capacity: ${v.cap}`, `Booker: ${v.who}`, `How to pitch: ${v.how}`, `Contact: ${v.ct}${v.verify ? " (verify)" : ""}`, v.ask, `Why: ${v.why}`),
      });
      venueIds[v.id] = id;
      const venue = (await w.get("venues", id))!;
      const t = tracking[v.id] ?? {};
      await pitch(w, `ss-${v.id}`, { kind: "venue", id, name: venue.name as string }, t.status ? SS_STATUS[t.status] ?? "toPitch" : v.tier === 3 ? "idea" : "toPitch",
        { notes: lines("Local support slot on a touring indie bill.", t.notes), pitchedOn: t.date });
    });
  }
  for (const p of SS_PROMOTERS) {
    await run(ctx, async (w) => {
      const ids = p.venues.map((k) => venueIds[k]).filter(Boolean);
      const id = await ensure(w, "promoters", `ss-${p.id}`, { name: p.name, kind: p.kind, website: p.website, contactIds: [], venueIds: ids, howToPitch: p.howToPitch, notes: p.notes, sources });
      const prom = (await w.get("promoters", id))!;
      const add = ids.filter((x) => !(prom.venueIds as string[]).includes(x));
      if (add.length) await w.update("promoters", id, { venueIds: [...(prom.venueIds as string[]), ...add] });
      for (const vid of ids) {
        const venue = (await w.get("venues", vid))!;
        const { fields } = await noteOf(w, venue, artist.id);
        if (!fields.promoterIds.includes(id)) await writeNote(w, venue, artist.id, { promoterIds: [...fields.promoterIds, id] });
      }
    });
  }
}

// ---------- pitches ----------

async function pitch(w: Writer, id: string, target: { kind: "venue" | "promoter" | "edition"; id: string; name: string }, status: string,
  o: { nextStep?: { text: string; due: string }; notes?: string; pitchedOn?: string }) {
  if (await w.get("pitches", id)) { bump("pitches (already there)"); return; }
  const open = (await w.query("pitches", (q) => q.where("target.id", "==", target.id))).find((p) => p.target.kind === target.kind);
  if (open) { bump("pitches (target already on Pitch List)"); return; }
  const cfg = hasConfig("full-band") ? "full-band" : undefined;
  await w.create("pitches", {
    target, status, artistId: artist.id, pitchedAs: cfg, personnel: cfg ? configMusicians(cfg)! : [], assigneeId,
    nextStep: o.nextStep, notes: o.notes, showIds: [], ...(o.pitchedOn ? { lastContactAt: new Date(`${o.pitchedOn}T12:00:00-06:00`) } : {}),
  }, { id });
  await w.create(`pitches/${id}/activity`, { type: "status", toStatus: status, text: "Imported from the claude.ai booking trackers" });
  if (o.pitchedOn && status !== "toPitch" && status !== "idea") await w.create(`pitches/${id}/activity`, { type: "note", text: `Pitched on ${o.pitchedOn}` });
  bump("pitches");
}

// ---------- main ----------

const ctx = importCtx("import-booking-kit");

async function main() {
  // Which artist the data is for: --artist=<slug>, or the only one there is.
  const want = process.argv.find((x) => x.startsWith("--artist="))?.slice("--artist=".length);
  const all = await db.list("artists");
  if (!want && all.length > 1) throw new Error(`There are ${all.length} artists: say which with --artist=<slug> (${all.map((x) => x.slug).join(", ")})`);
  const a = want ? all.find((x) => x.slug === want) : all[0];
  if (!a) throw new Error(want ? `No artist with slug ${want}` : "No artist yet. Run `npm run seed -- --people` (local) or set the band up in Admin first.");
  artist = a;
  const musicians = await db.list("musicians");
  musiciansByName = new Map(musicians.map((m) => [String(m.name).split(/\s+/)[0].toLowerCase(), m.id]));
  const users = await db.list("users");
  const isAdmin = (u: Doc) => roleIn(u, artist.id) === "admin";
  assigneeId = users.find((u) => isAdmin(u) && /^jeff\b/i.test(String(u.name)))?.id ?? users.find(isAdmin)?.id;

  if (DRY) {
    const vb = load<{ venues: VbVenue[] }>("venue-book.json").venues;
    const fr = load<{ events: FrEvent[] }>("festival-run.json").events;
    const ss = load<{ venues: SsVenue[] }>("support-slots.json").venues;
    console.log(`Dry run: ${vb.length} Venue Book venues (${vb.reduce((n, v) => n + v.shows.length, 0)} shows), ${fr.length} Festival Run events, ${ss.length} support-slot rooms. Nothing written.`);
    return;
  }
  await importFestivalRun();
  await importSupportSlots();
  await importVenueBook();
  console.log(`Imported (runId ${ctx.runId}; undo it from Admin → History):`);
  for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${k}: ${n}`);
  if (warnings.length) { console.log(`\nCheck these (${warnings.length}):`); for (const x of warnings) console.log(`  ${x}`); }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
