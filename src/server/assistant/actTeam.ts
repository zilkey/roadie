/**
 * "Find their team" on an act's Contacts card: who books, manages or does press for the act. Only on a click, never from chat.
 * - The act's own website: the home page, then up to five pages on the same site whose link says contact, booking, management,
 *   team, about, press or EPK. Bandcamp too, when the act has it.
 * - One Google search through Gemini's grounding ("<act> band booking agent manager publicist"), and up to three of the pages it
 *   came from (not social or listings sites): agency rosters and press pages often name the agent.
 * - A structured extraction over those pages, then a check: an email is kept only when it is written on a page that was read, a name
 *   only when a page (or the search answer) says it, a phone only when its digits are on a page. Emails on the pages that the model
 *   left out are added too, with a role guessed from the words around them (or the address itself: booking@, mgmt@, press@).
 * - Then one more search per named person ("<name>" <company> email LinkedIn), reading up to two of the pages it came from. What it
 *   adds is checked the same way: an email only when it's on a page that names the person and is theirs (their name in the address,
 *   or written near their name), a phone only when it's near their name, a LinkedIn profile only when its address has their name,
 *   and a page as a link only when it names them.
 * - Last, dedupeTeam: each address on one person only, an inbox folded into the person it belongs to, and name variants merged.
 * Nothing is saved: the card lists what was found and each person has an Add button (the band's own contacts, linked to the act).
 */
import { z as gz } from "genkit";
import { db } from "../db";
import { AppError } from "../errors";
import type { ArtistLinkKey } from "@/schema";
import { e164 } from "@/schema/normalize";
import { nameTokens, sameTeamName, TEAM_ROLES, TEAM_ROLE_LABEL, type TeamRole, type TeamPerson, type TeamResult } from "@/lib/acts";
import { getAi, modelMode, withModelRetry } from "./ai";
import { fetchBytes, isAggregator, normalizeUrl, pageText, resolveSource, searchWeb, socialOf, WEB_NOTICE } from "./web";

export { nameTokens, TEAM_ROLES, TEAM_ROLE_LABEL, type TeamRole, type TeamPerson, type TeamResult };
/** One page that was read: its address, readable text and the addresses in its mailto links. */
export interface ReadPage { url: string; text: string; emails: string[] }

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_HTML_BYTES = 2_000_000;
const MAX_SITE_PAGES = 5;
const MAX_SOURCE_PAGES = 3;
const PAGE_CHARS = 6_000;
const MAX_PEOPLE = 12;
const MAX_PERSON_SEARCHES = 6;
const MAX_PERSON_PAGES = 2;
const MAX_PERSON_LINKS = 3;

/** Words in a link (its address or its text) that point at a page with the act's people on it. */
const TEAM_WORDS = /\b(contact|contacts|booking|book us|book-us|bookings|management|mgmt|team|about|press|epk|info|connect)\b/i;

/**
 * Pages on the same site that likely list the act's people, from the home page's links: the address or the link text says contact,
 * booking, management, team, about, press or EPK. The home page itself, other sites, files and anchors on the same page are left out.
 */
export function teamPageLinks(html: string, base: string, max = MAX_SITE_PAGES): string[] {
  let home: URL;
  try { home = new URL(base); } catch { return []; }
  const host = home.hostname.replace(/^www\./, "");
  const out: string[] = [];
  for (const [, href, inner] of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(href.replace(/&amp;/g, "&"), home); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|mp3|wav)$/i.test(u.pathname)) continue;
    u.hash = "";
    const n = normalizeUrl(u.href.replace(/^http:/, "https:"));
    if (!n || n === normalizeUrl(home.href)) continue;
    const words = `${decodeURIComponent(u.pathname).replace(/[-_/]+/g, " ")} ${inner.replace(/<[^>]+>/g, " ")}`;
    if (TEAM_WORDS.test(words) && !out.includes(n)) out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

/** Addresses that are page plumbing, not people: image names (logo@2x.png), error trackers, site builders, placeholders. */
const JUNK_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(sentry|.*\.sentry|wixpress|.*\.wixpress|sentry-next\.wixpress|godaddy|domain|email|yourdomain|example)\.(com|io|net|org)$|^(noreply|no-reply|donotreply|privacy|abuse|webmaster|postmaster)@/i;

/** Every email address written in some text, lowercase, each once, without page plumbing. */
export function emailsIn(text: string): string[] {
  const out = new Set<string>();
  for (const [m] of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const e = m.toLowerCase().replace(/\.$/, "");
    if (!JUNK_EMAIL.test(e)) out.add(e);
  }
  return [...out];
}

const ROLE_WORDS: [TeamRole, RegExp][] = [
  ["booking", /\b(booking|bookings|book(?:ed)? by|agent|agency|talent buyer|touring)\b/i],
  ["management", /\b(management|manager|mgmt|managed by)\b/i],
  ["publicity", /\b(press|publicist|publicity|pr|media inquiries|media)\b/i],
  ["label", /\b(label|records|recordings)\b/i],
  ["general", /\b(general|info|inquiries|enquiries|contact us|say hi|hello)\b/i],
];

/** The role an address's own name says: booking@, mgmt@, press@, info@… else undefined. */
export function roleFromEmail(email: string): TeamRole | undefined {
  const local = email.split("@")[0].toLowerCase();
  if (/book|agent|tour/.test(local)) return "booking";
  if (/mgmt|manage/.test(local)) return "management";
  if (/^(press|pr|publicity|media)\b/.test(local)) return "publicity";
  if (/label|records/.test(local)) return "label";
  if (/^(info|hello|hi|contact|band|general|inquiries|team|mail)$/.test(local)) return "general";
  return undefined;
}

/** The role the words just before an address on the page say ("Booking: jo@agency.com"), else the address's own, else "other". */
export function roleNear(text: string, email: string): TeamRole {
  const at = text.toLowerCase().indexOf(email.toLowerCase());
  if (at >= 0) {
    const before = text.slice(Math.max(0, at - 120), at);
    // The nearest heading wins: look at the words closest to the address first.
    const lines = before.split("\n").reverse();
    // Lines with an address on them are skipped: "mgmt@band.com" above a general inbox says nothing about it.
    for (const line of lines) {
      if (line.includes("@")) continue;
      for (const [role, re] of ROLE_WORDS) if (re.test(line)) return role;
    }
  }
  return roleFromEmail(email) ?? "other";
}

const PeopleOut = gz.object({
  people: gz.array(gz.object({
    name: gz.string().nullable().describe("The person's full name as the page writes it, or null for an inbox with no name (booking@band.com)"),
    role: gz.enum(TEAM_ROLES).describe("booking = booking agent or agency; management = manager; publicity = publicist or press; label = record label; general = the band's own general inbox; other = anyone else on the team"),
    company: gz.string().nullable().describe("The agency, management company, PR firm or label they are at, as the page writes it, or null"),
    email: gz.string().nullable().describe("Their email exactly as written on a page, or null"),
    phone: gz.string().nullable().describe("Their phone exactly as written on a page, or null"),
    sourceUrl: gz.string().nullable().describe("The url of the page that says this, or null when only the search answer does"),
  })).describe("The act's team: booking agent, manager, publicist, label contact, general inbox. Empty when the pages name no one"),
});
type PeopleRaw = gz.infer<typeof PeopleOut>["people"];

const extractSystem = () =>
  "You list the people who work for one music act (a band or artist) from pages about it: its booking agent, manager, publicist, " +
  "label contact, and the band's own general inbox. Use only what the pages and the search answer say; never make up a name, an email or a phone. " +
  "Leave out venues, promoters, fans, other bands and the website's maker. " + WEB_NOTICE;

const SEARCH_SYSTEM =
  "Search the web for one music act's team and answer in at most six short sentences: who their booking agent is (and the agency), " +
  "their manager (and the company), their publicist and their label, with any booking or management email shown publicly. Facts only. " +
  "Say when you couldn't find something.";

const clip = (s: string | null | undefined) => (typeof s === "string" && s.trim() ? s.trim().replace(/\s+/g, " ") : undefined);
const digits = (s: string) => s.replace(/\D/g, "");

/**
 * Keep only what the pages back up, then add the addresses the model left out. `answer` is the search answer: a name or company it
 * says counts, but an email or phone must be on a page that was read.
 */
export function groundTeam(raw: PeopleRaw | null | undefined, pages: ReadPage[], answer = ""): TeamPerson[] {
  const pageText = pages.map((p) => p.text).join("\n");
  const said = `${pageText}\n${answer}`.toLowerCase();
  const pageDigits = digits(pageText);
  const pageEmails = new Map<string, string>(); // email → the first page it is on
  for (const p of pages) for (const e of [...p.emails.map((x) => x.toLowerCase()), ...emailsIn(p.text)]) if (!JUNK_EMAIL.test(e) && !pageEmails.has(e)) pageEmails.set(e, p.url);
  const urls = new Set(pages.map((p) => p.url));

  const out: TeamPerson[] = [];
  const has = (p: TeamPerson) => out.find((o) => (p.email && o.email === p.email) || (p.name && o.name?.toLowerCase() === p.name.toLowerCase()));
  for (const r of raw ?? []) {
    const email = clip(r.email)?.toLowerCase();
    const okEmail = email && pageEmails.has(email) ? email : undefined;
    const name = clip(r.name);
    const okName = name && name.length <= 80 && said.includes(name.toLowerCase()) ? name : undefined;
    if (!okName && !okEmail) continue;
    const company = clip(r.company);
    const phone = clip(r.phone);
    const p164 = phone ? e164(phone) : undefined;
    const okPhone = p164 && /^\+[1-9]\d{6,14}$/.test(p164) && digits(phone!).length >= 7 && pageDigits.includes(digits(phone!).slice(-7)) ? p164 : undefined;
    const src = normalizeUrl(clip(r.sourceUrl) ?? "");
    const source = src && urls.has(src) ? src : okEmail ? pageEmails.get(okEmail) : undefined;
    const role = TEAM_ROLES.includes(r.role) ? r.role : "other";
    const person: TeamPerson = {
      role, ...(okName ? { name: okName } : {}), ...(company && company.length <= 100 && said.includes(company.toLowerCase()) ? { company } : {}),
      ...(okEmail ? { email: okEmail } : {}), ...(okPhone ? { phone: okPhone } : {}), ...(source ? { source } : {}),
    };
    const dup = has(person);
    if (dup) Object.assign(dup, { ...person, ...dup });
    else out.push(person);
  }
  for (const [email, url] of pageEmails) {
    if (out.some((o) => o.email === email)) continue;
    const page = pages.find((p) => p.url === url)!;
    out.push({ role: roleNear(page.text, email), email, source: url });
  }
  const order = (r: TeamRole) => TEAM_ROLES.indexOf(r);
  return out.sort((a, b) => order(a.role) - order(b.role)).slice(0, MAX_PEOPLE);
}

/** A page read for one person: also the LinkedIn profiles it links to (agency rosters often do). */
export interface PersonPage extends ReadPage { hrefs: string[] }

const LINKEDIN = /^https:\/\/([a-z]+\.)?linkedin\.com\/in\/([^/?#]+)/i;
/** LinkedIn profile links in a page's html. */
export function linkedInHrefs(html: string): string[] {
  const out = new Set<string>();
  for (const [m] of html.matchAll(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[^"'\s<>?#]+/gi)) { const n = normalizeUrl(m.replace(/^http:/, "https:")); if (n) out.add(n); }
  return [...out];
}

/**
 * What the search for one person backs up: an email, a phone and links, each tied to them. `sources` are the search's (resolved)
 * result pages, read or not: a LinkedIn profile among them counts when its address has the person's surname.
 */
export function groundPerson(p: TeamPerson, pages: PersonPage[], sources: string[]): Pick<TeamPerson, "email" | "phone" | "links" | "infoFrom"> {
  const tokens = p.name ? nameTokens(p.name) : [];
  if (!tokens.length) return {};
  const last = tokens[tokens.length - 1], first = tokens[0];
  const out: Pick<TeamPerson, "email" | "phone" | "links" | "infoFrom"> = {};
  const links: string[] = [];
  const addLink = (u: string) => { if (u !== p.source && !links.includes(u)) links.push(u); };
  const NEAR = 120;
  for (const page of pages) {
    const lower = page.text.toLowerCase();
    if (!lower.includes(last) || (first !== last && !lower.includes(first))) continue; // the page doesn't name them
    const nameAt = [...lower.matchAll(new RegExp(`\\b${last}\\b`, "g"))].map((m) => m.index!);
    // Rosters write the name, then the email and phone: "near" is just after their name.
    const near = (at: number) => at >= 0 && nameAt.some((n) => at > n && at - n <= NEAR);
    if (!p.email && !out.email) {
      const email = [...new Set([...page.emails.map((e) => e.toLowerCase()), ...emailsIn(page.text)])].find((e) => {
        if (JUNK_EMAIL.test(e)) return false;
        const local = e.split("@")[0].replace(/[^a-z]/g, "");
        return tokens.some((t) => local.includes(t)) || near(lower.indexOf(e));
      });
      if (email) { out.email = email; out.infoFrom ??= page.url; }
    }
    if (!p.phone && !out.phone) {
      for (const m of page.text.matchAll(/\+?\d[\d\s().-]{8,}\d/g)) {
        const n = e164(m[0]);
        if (n && /^\+[1-9]\d{9,14}$/.test(n) && near(m.index!)) { out.phone = n; out.infoFrom ??= page.url; break; }
      }
    }
    addLink(page.url);
    for (const h of page.hrefs) if (LINKEDIN.exec(h)?.[2].toLowerCase().includes(last)) addLink(h);
  }
  for (const u of sources) if (LINKEDIN.exec(u)?.[2].toLowerCase().includes(last)) addLink(u);
  // LinkedIn first: it's the one people want.
  links.sort((a, b) => Number(LINKEDIN.test(b)) - Number(LINKEDIN.test(a)));
  if (links.length) out.links = links.slice(0, MAX_PERSON_LINKS);
  return out;
}

const PERSON_SYSTEM =
  "Search the web for one person who works in the music business and answer in at most four short sentences: their email, their phone, " +
  "the company they work at and its website, and their LinkedIn profile. Facts only. Say when you couldn't find something.";

/** The search for one person: their name, their company (else the act) and what they do. */
async function findPerson(p: TeamPerson, actName: string, skip: Set<string>): Promise<TeamPerson> {
  if (!p.name) return p;
  const q = `"${p.name}" ${p.company ? `"${p.company}"` : `"${actName}"`} ${TEAM_ROLE_LABEL[p.role].toLowerCase()} email contact LinkedIn`;
  try {
    const found = await withModelRetry(() => searchWeb(q, { system: PERSON_SYSTEM, max: 6 }));
    const sources = (await Promise.all(found.sources.map((s) => resolveSource(s.url)))).filter((u): u is string => !!u);
    const toRead = sources.filter((u) => !skip.has(u) && !socialOf(u) && !isAggregator(u) && !LINKEDIN.test(u)).slice(0, MAX_PERSON_PAGES);
    const pages = (await Promise.all(toRead.map(readPage))).filter((r) => !!r).map((r) => ({ ...r!.page, hrefs: linkedInHrefs(r!.html) }));
    return { ...p, ...groundPerson(p, pages, sources) };
  } catch (e) {
    console.warn("acts.findTeam person", p.name, e instanceof Error ? e.message : e);
    return p;
  }
}

async function readPage(url: string): Promise<{ page: ReadPage; html: string } | undefined> {
  try {
    const r = await fetchBytes(url, { ua: BROWSER_UA, accept: "text/html", type: /html/i, max: MAX_HTML_BYTES });
    const html = r.body.toString("utf8");
    const p = pageText(html);
    return { html, page: { url: normalizeUrl(r.url) ?? r.url, text: p.text.slice(0, PAGE_CHARS), emails: p.emails } };
  } catch (e) {
    console.warn("acts.findTeam read", url, e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** The act's own site: home page first, then its contact/booking/about pages. Bandcamp too. */
async function readOwnSite(links: Partial<Record<ArtistLinkKey, string>>): Promise<ReadPage[]> {
  const pages: ReadPage[] = [];
  if (links.website) {
    const home = await readPage(links.website);
    if (home) {
      pages.push(home.page);
      const more = await Promise.all(teamPageLinks(home.html, home.page.url).map(readPage));
      for (const m of more) if (m) pages.push(m.page);
    }
  }
  if (links.bandcamp) { const bc = await readPage(links.bandcamp); if (bc) pages.push(bc.page); }
  return pages;
}

const union = (...lists: (string | undefined)[][]) => [...new Set(lists.flat().filter((u): u is string => !!u))];

/** An unnamed inbox folded into the person whose address it is: their name and role, the inbox's page kept as where the email was. */
function withInbox(person: TeamPerson, inbox: TeamPerson): TeamPerson {
  const source = person.source ?? inbox.source;
  const infoFrom = person.infoFrom ?? (inbox.source !== source ? inbox.source : undefined);
  const links = union(person.links ?? [], inbox.links ?? [], [inbox.source].filter((u) => u !== source && u !== infoFrom));
  return {
    ...inbox, ...person, ...(person.company ?? inbox.company ? { company: person.company ?? inbox.company } : {}),
    ...(person.phone ?? inbox.phone ? { phone: person.phone ?? inbox.phone } : {}),
    ...(source ? { source } : {}), ...(infoFrom ? { infoFrom } : {}), ...(links.length ? { links } : {}),
  };
}

/** Two rows that are one person (by name): the fuller name, the first row's role unless it's just "other", the rest filled in from both. */
function samePerson(a: TeamPerson, b: TeamPerson): TeamPerson {
  const name = (b.name?.length ?? 0) > (a.name?.length ?? 0) ? b.name : a.name;
  const source = a.source ?? b.source;
  const links = union(a.links ?? [], b.links ?? [], [b.source].filter((u) => u !== source));
  const out: TeamPerson = { ...b, ...a, ...(name ? { name } : {}), role: a.role === "other" ? b.role : a.role };
  for (const k of ["company", "email", "phone", "source", "infoFrom"] as const) { const v = a[k] ?? b[k]; if (v) out[k] = v; }
  if (links.length) out.links = links;
  return out;
}

/**
 * The last check after the per-person searches, so the list has each person and each address once:
 * - An address is never on two people. The row that had it before the search keeps it (`before`, the grounded list, row for row),
 *   else the first; a second named person loses it (two agents at booking@agency.com: only the first keeps it).
 * - A named person and an unnamed inbox with the same address are one row, under the person's name and role, keeping both pages.
 * - Name variants are one person (sameTeamName: `Joseph "JP" Pineda`, `JP Pineda`, `J. Pineda`), merged.
 * Then sorted by role, as groundTeam does.
 */
export function dedupeTeam(people: TeamPerson[], before: TeamPerson[] = people): TeamPerson[] {
  const rows: (TeamPerson | undefined)[] = people.map((p) => ({ ...p }));
  const searched = (i: number) => !!rows[i]?.email && !before[i]?.email;
  const order = rows.map((_, i) => i).sort((a, b) => Number(searched(a)) - Number(searched(b)));
  const owner = new Map<string, number>();
  for (const i of order) {
    const r = rows[i]!;
    if (!r.email) continue;
    const o = owner.get(r.email);
    if (o === undefined) { owner.set(r.email, i); continue; }
    const first = rows[o]!;
    if (!r.name) { rows[o] = first.name ? withInbox(first, r) : samePerson(first, r); rows[i] = undefined; }
    else if (!first.name) { rows[i] = withInbox(r, first); rows[o] = undefined; owner.set(r.email, i); }
    else delete r.email; // rows are copies
  }
  const out: TeamPerson[] = [];
  for (const r of rows) {
    if (!r) continue;
    const at = r.name ? out.findIndex((o) => o.name && sameTeamName(o.name, r.name!)) : -1;
    if (at < 0) { out.push(r); continue; }
    // One email each: the merged row keeps the first one's; the other's stays nowhere (it was on the same person anyway).
    out[at] = samePerson(out[at], r);
  }
  const rank = (r: TeamRole) => TEAM_ROLES.indexOf(r);
  return out.sort((a, b) => rank(a.role) - rank(b.role));
}

/**
 * Canned pages and model output for the fake model: "A Brother's Fountain" has a team (and one made-up email the check must drop), and
 * two duplicates dedupeTeam must fold: "D. Reyes" is Dana Reyes, and the press inbox on the act's page is the address Sam Ortiz's
 * search finds.
 */
export const FAKE_TEAM = {
  pages: [
    {
      url: "https://abrothersfountain.example/contact",
      text: "Contact\nBooking\nDana Reyes, Front Range Touring\ndana@frontrangetouring.example\n(970) 555-0142\nManagement\nmgmt@abrothersfountain.example\nPress\nsam@ortizpr.example\nGeneral\nhello@abrothersfountain.example\nAll tour dates booked by D. Reyes.",
      emails: ["dana@frontrangetouring.example", "hello@abrothersfountain.example"],
    },
  ] as ReadPage[],
  answer: "A Brother's Fountain is booked by Dana Reyes at Front Range Touring. Their publicist is Sam Ortiz.",
  people: [
    { name: "Dana Reyes", role: "booking", company: "Front Range Touring", email: "dana@frontrangetouring.example", phone: "(970) 555-0142", sourceUrl: "https://abrothersfountain.example/contact" },
    { name: "Sam Ortiz", role: "publicity", company: null, email: "sam@made-up-pr.example", phone: null, sourceUrl: null },
    { name: "D. Reyes", role: "booking", company: null, email: null, phone: null, sourceUrl: "https://abrothersfountain.example/contact" },
  ] as PeopleRaw,
  /** The search for Sam Ortiz: the PR firm's team page names Sam and a colleague; only Sam's address and LinkedIn are theirs. */
  person: {
    pages: [{
      url: "https://ortizpr.example/team",
      text: "Our team\nSam Ortiz, Publicist\nsam@ortizpr.example\n+1 303 555 0177\n\nLee Park, Coordinator\nlee@ortizpr.example\n+1 303 555 0188",
      emails: ["sam@ortizpr.example", "lee@ortizpr.example"],
      hrefs: ["https://www.linkedin.com/in/sam-ortiz-pr", "https://www.linkedin.com/in/lee-park"],
    }] as PersonPage[],
    sources: ["https://ortizpr.example/team", "https://www.linkedin.com/in/sam-ortiz-pr"],
  },
};

/** Look for the act's team. Throws not_found for a missing act; a web that can't be reached comes back as nothing found. */
export async function findActTeam(id: string): Promise<TeamResult> {
  const act = await db.get("acts", id) as (Record<string, unknown> & { name: string; links?: Partial<Record<ArtistLinkKey, string>> }) | null;
  if (!act || act.deletedAt) throw new AppError("not_found", "No act with that id", 404);
  if (modelMode() === "fake") {
    if (!/fountain/i.test(act.name)) return { id, name: act.name, people: [], read: [], searched: true };
    const team = groundTeam(FAKE_TEAM.people, FAKE_TEAM.pages, FAKE_TEAM.answer);
    const people = team.map((p) => p.name === "Sam Ortiz" ? { ...p, ...groundPerson(p, FAKE_TEAM.person.pages, FAKE_TEAM.person.sources) } : p);
    return { id, name: act.name, people: dedupeTeam(people, team), read: FAKE_TEAM.pages.map((p) => p.url), searched: true };
  }

  const links = act.links ?? {};
  const q = `"${act.name}" band booking agent, manager, management, publicist, record label, booking contact email`;
  const [own, found] = await Promise.all([
    readOwnSite(links),
    withModelRetry(() => searchWeb(q, { system: SEARCH_SYSTEM, max: 8 })).catch((e) => { console.error("acts.findTeam search", e); return undefined; }),
  ]);
  const sources = found ? (await Promise.all(found.sources.map((s) => resolveSource(s.url)))).filter((u): u is string => !!u) : [];
  const have = new Set(own.map((p) => p.url));
  const extra = sources.filter((u) => !have.has(u) && !socialOf(u) && !isAggregator(u)).slice(0, MAX_SOURCE_PAGES);
  const more = (await Promise.all(extra.map(readPage))).filter((r) => !!r).map((r) => r!.page);
  const pages = [...own, ...more];
  const answer = found?.answer ?? "";
  if (!pages.length && !answer) return { id, name: act.name, people: [], read: [], searched: !!found };

  const { ai, model } = await getAi();
  const prompt = [
    `Act: ${act.name}.`,
    answer && `<search_answer>${answer}</search_answer>`,
    ...pages.map((p) => `<page url="${p.url}">\n${p.text}${p.emails.length ? `\nEmail links: ${p.emails.join(", ")}` : ""}\n</page>`),
  ].filter(Boolean).join("\n\n");
  let raw: PeopleRaw = [];
  try {
    const res = await withModelRetry(() => ai.generate({ model: model as never, system: extractSystem(), prompt, output: { schema: PeopleOut } }));
    raw = res.output?.people ?? [];
  } catch (e) {
    // The addresses on the pages still count without the model.
    console.error("acts.findTeam extract", e);
  }
  const team = groundTeam(raw, pages, answer);
  // One more search per named person for their own email, phone and LinkedIn; the pages already read aren't read again.
  const skip = new Set(pages.map((p) => p.url));
  const named = team.filter((p) => p.name).slice(0, MAX_PERSON_SEARCHES);
  const people = await Promise.all(team.map((p) => (named.includes(p) ? findPerson(p, act.name, skip) : p)));
  return { id, name: act.name, people: dedupeTeam(people, team), read: pages.map((p) => p.url), searched: !!found };
}
