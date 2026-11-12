"use client";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Link, useArtist, useHref } from "@/lib/artist";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { previousPath, subscribeNav } from "@/lib/navHistory";
import { ROUTES } from "@/lib/routes";
import type { Campaign } from "@/schema";
import { FlagCampaignProvider } from "@/components/booking/FlagCampaign";
import { sortCampaigns } from "@/lib/campaigns";
import { isActive } from "@/lib/booking";
import { hrefFor } from "@/components/booking/common";

/**
 * The Booking sub-nav (admins only): Pitches, Places, Discover, Set up. Beside the page on desktop; on a phone the same links
 * become one row that scrolls sideways above it. Members who open a venue page get the page alone.
 */
export function BookingLayout({ children }: { children: React.ReactNode }) {
  const { role } = useArtist();
  const [q, setQ] = useState("");
  const [trail, setTrail] = useState<string[]>([]);
  if (role !== "admin") return <>{children}</>;
  return (
    <SearchContext.Provider value={{ q, setQ }}><TrailContext.Provider value={{ trail, setTrail }}><FlagCampaignProvider>
      <div className="min-[900px]:flex min-[900px]:items-start min-[900px]:gap-6">
        <BookingNav />
        <div className="min-w-0 min-[900px]:flex-1">{children}</div>
      </div>
    </FlagCampaignProvider></TrailContext.Provider></SearchContext.Provider>
  );
}

/**
 * The search typed on a Booking list. The list publishes it here so the sub-nav's links carry it along as ?q= (the next
 * section opens already searching), as the tabs did.
 */
const SearchContext = createContext<{ q: string; setQ(q: string): void }>({ q: "", setQ: () => {} });
export const useBookingSearch = () => useContext(SearchContext);

/**
 * The links of the page's breadcrumbs, published by Crumbs. A page the sidebar has no link for (a pitch, an email, Search
 * Gmail) lights up the deepest crumb that is a sidebar link: the pitch's campaign, Ongoing, or the place's section.
 */
const TrailContext = createContext<{ trail: string[]; setTrail(t: string[]): void }>({ trail: [], setTrail: () => {} });

type Key = "campaigns" | "pitches" | "venues" | "festivals" | "promoters" | "contacts" | "calendars" | "acts" | "templates" | `campaign-${string}`;
interface Item { key: Key; href: string; label: string; /** Paths under /booking that light this item up besides its own (record pages that belong to it). */ also?: string[]; /** Drawn under All campaigns, with tree lines (desktop). */ kid?: boolean; exact?: boolean }
/**
 * Campaigns (#82) replace the Pitch List: All campaigns, Ongoing (key "pitches", where every pitch with no campaign is), then
 * each active campaign (added in BookingNav, from the band's campaigns). Closed campaigns are on All campaigns only.
 */
const GROUPS: { head: string; items: Item[] }[] = [
  { head: "Campaigns", items: [
    { key: "campaigns", href: ROUTES.bookingCampaigns.path, label: "All campaigns", exact: true },
    { key: "pitches", href: ROUTES.bookingPitches.path, label: ROUTES.bookingPitches.title },
  ] },
  { head: "Places", items: [
    { key: "venues", href: ROUTES.bookingVenues.path, label: ROUTES.bookingVenues.title },
    { key: "festivals", href: ROUTES.bookingFestivals.path, label: ROUTES.bookingFestivals.title, also: ["/booking/editions"] },
    { key: "promoters", href: ROUTES.bookingPromoters.path, label: ROUTES.bookingPromoters.title },
    { key: "contacts", href: ROUTES.contacts.path, label: ROUTES.contacts.title }, // its own section (/booking/contacts redirects there)
  ] },
  { head: "Discover", items: [
    { key: "calendars", href: ROUTES.bookingCalendars.path, label: ROUTES.bookingCalendars.title },
    { key: "acts", href: ROUTES.bookingActs.path, label: ROUTES.bookingActs.title },
  ] },
  { head: "Set up", items: [{ key: "templates", href: ROUTES.bookingTemplates.path, label: ROUTES.bookingTemplates.title }] },
];
const SECTIONS = GROUPS.flatMap((g) => g.items);
/** The lists the search carries to (Contacts and Email templates have no Booking search). */
const SEARCHABLE: Key[] = ["venues", "festivals", "promoters", "calendars", "acts"];

function BookingNav() {
  const path = usePathname();
  const full = useHref();
  const { artistId } = useArtist();
  const { q } = useBookingSearch();
  const { trail } = useContext(TrailContext);
  const campaigns = useCollection<Campaign>("campaigns", { where: [["artistId", "==", artistId]] });
  // Ongoing and each active campaign hang under All campaigns as a small tree (no counts: Jeff, 2026-11-12).
  const groups = useMemo(() => GROUPS.map((g, n) => n > 0 ? g : { ...g, items: [
    ...g.items.map((i) => i.key === "pitches" ? { ...i, kid: true } : i),
    ...sortCampaigns(campaigns.rows ?? []).active.map((c): Item => ({ key: `campaign-${c.id}`, href: `/booking/campaigns/${c.id}`, label: c.name, kid: true })),
  ] }), [campaigns.rows]);
  const under = (href: string) => path === full(href) || path.startsWith(full(href) + "/");
  // The current item: the link to this very page; else the deepest crumb that is a link here (a pitch's campaign); else the
  // section the path is under.
  const items = groups.flatMap((g) => g.items);
  const current = items.find((i) => path === full(i.href))
    ?? [...trail].reverse().map((h) => items.find((i) => i.href === h)).find(Boolean)
    ?? items.find((i) => (i.exact ? path === full(i.href) : under(i.href)) || (i.also ?? []).some((a) => under(a)));
  const on = (i: Item) => i.key === current?.key;
  const href = (i: Item) => SEARCHABLE.includes(i.key) && q.trim() ? `${i.href}?q=${encodeURIComponent(q)}` : i.href;
  return (
    <nav aria-label="Booking" data-testid="booking-nav"
      className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 pb-2 min-[900px]:sticky min-[900px]:top-6 min-[900px]:mx-0 min-[900px]:mb-0 min-[900px]:w-[220px] min-[900px]:shrink-0 min-[900px]:flex-col min-[900px]:gap-0 min-[900px]:overflow-visible min-[900px]:rounded-lg min-[900px]:border min-[900px]:bg-surface min-[900px]:p-2">
      {groups.map((g) => (
        <div key={g.head} className="contents min-[900px]:block">
          <div className="hidden px-3 pb-1 pt-2 text-[0.6875rem] font-bold uppercase tracking-wide text-muted min-[900px]:block">{g.head}</div>
          {g.items.map((i, k) => (
            <Link key={i.key} href={href(i)} data-testid={`booking-seg-${i.key}`} aria-current={on(i) ? "page" : undefined}
              data-last={i.kid && !g.items[k + 1]?.kid ? "1" : undefined}
              className={`menu-item shrink-0 whitespace-nowrap${i.kid ? " nav-kid" : ""}${on(i) ? " bg-accent-soft text-accent" : ""}`}>
              {i.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

export interface Crumb { label: string; href?: string }

/**
 * Where a Booking record page sits: Booking › section › record (› its page). Desktop and admins only: phones keep their back
 * button, and members (who only reach venue pages) keep `back`, which is also what narrow screens show instead of the trail.
 * A crumb for the page you just came from goes back through history, so a list comes back with its filters and scroll, as
 * BackLink's "back" mode does. Reached from another Booking list (a venue from Venue calendars), the section crumb is that list.
 */
export function Crumbs({ items, back, fixed }: { items: Crumb[]; back?: React.ReactNode; /** Keep the trail as given: never swap the section for the list you came from (campaign pages: Booking › Campaigns › name). */ fixed?: boolean }) {
  const { role } = useArtist();
  const router = useRouter();
  const full = useHref();
  const prev = useSyncExternalStore(subscribeNav, previousPath, () => undefined);
  const { setTrail } = useContext(TrailContext);
  const from = prev && SECTIONS.find((i) => full(i.href) === prev);
  const fromHref = from && from.href;
  // A pitch's trail starts Campaigns › its campaign: only Ongoing (a section) gives way to the list you came from.
  const lead = items[0]?.href === ROUTES.bookingCampaigns.path && items.length > 1 ? 1 : 0;
  const isSection = SECTIONS.some((i) => i.href === items[lead]?.href) && fromHref !== items[lead]?.href && fromHref !== ROUTES.bookingCampaigns.path;
  const head = !fixed && from && fromHref && isSection ? [{ label: from.label, href: fromHref }, ...items.slice(lead + 1)] : items;
  const links = JSON.stringify(head.flatMap((c) => (c.href ? [c.href.split("?")[0]] : [])));
  useEffect(() => { setTrail(JSON.parse(links)); return () => setTrail([]); }, [links, setTrail]);
  if (role !== "admin") return <>{back}</>;
  const trail = [{ label: ROUTES.booking.title, href: ROUTES.booking.path }, ...head];
  return (
    <>
      {back && <span className="min-[900px]:hidden">{back}</span>}
      <nav aria-label="Breadcrumb" data-testid="crumbs" className="hidden flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold text-muted min-[900px]:flex">
        {trail.map((c, n) => {
          const last = n === trail.length - 1;
          return (
            <span key={n} className="flex items-center gap-1.5">
              {last || !c.href ? <span aria-current={last ? "page" : undefined} className="text-ink" data-testid={last ? "crumb-current" : undefined}>{c.label}</span> : (
                <NextLink href={full(c.href)} className="text-muted no-underline hover:text-accent hover:underline" data-testid={`crumb-${n}`}
                  onClick={(e) => {
                    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    if (c.href!.includes("?") || previousPath() !== full(c.href!)) return;
                    e.preventDefault();
                    router.back();
                  }}>{c.label}</NextLink>
              )}
              {!last && <span aria-hidden>›</span>}
            </span>
          );
        })}
      </nav>
    </>
  );
}

type PlaceKind = Parameters<typeof hrefFor>[0];
const SECTION: Record<PlaceKind, { title: string; path: string }> = {
  venue: ROUTES.bookingVenues, promoter: ROUTES.bookingPromoters, festival: ROUTES.bookingFestivals, edition: ROUTES.bookingFestivals,
  act: ROUTES.bookingActs, contact: ROUTES.contacts,
} as Record<PlaceKind, { title: string; path: string }>;
/** The Booking section a kind of record is listed in, as a crumb. */
export const sectionCrumb = (kind: PlaceKind): Crumb => ({ label: SECTION[kind].title, href: SECTION[kind].path });
/** Where a pitch is listed: its campaign's page while that is live and active (or the pitch is closed), else Ongoing. */
export const campaignCrumb = (campaign?: { id: string; name: string; status: string } | null, pitchActive = true): Crumb =>
  campaign && (campaign.status === "active" || !pitchActive) ? { label: campaign.name, href: `/booking/campaigns/${campaign.id}` } : { label: ROUTES.bookingPitches.title, href: ROUTES.bookingPitches.path };
export const campaignsCrumb: Crumb = { label: ROUTES.bookingCampaigns.title, href: ROUTES.bookingCampaigns.path };
/** A pitch's campaign crumb (its campaign, or Ongoing), read from the pitch; undefined without a pitch. */
export function usePitchCampaignCrumb(pitchId?: string | null): Crumb | undefined {
  const { doc: p } = useDoc<{ status: string; campaignId?: string | null }>("pitches", pitchId ?? "", { skip: !pitchId });
  const { doc: c } = useDoc<Campaign>("campaigns", p?.campaignId ?? "", { skip: !p?.campaignId });
  return pitchId ? campaignCrumb(c, isActive(p?.status ?? "toPitch")) : undefined;
}
/**
 * The trail down to a place, or to its pitch when there is one: Campaigns › the pitch's campaign (or Ongoing) › the place's
 * pitch, else Venues › the venue.
 */
export const placeTrail = (kind: PlaceKind, id: string, name: string, pitchId?: string, campaign?: Crumb): Crumb[] => pitchId
  ? [campaignsCrumb, campaign ?? { label: ROUTES.bookingPitches.title, href: ROUTES.bookingPitches.path }, { label: name, href: `/booking/pitches/${pitchId}` }]
  : [sectionCrumb(kind), { label: name, href: hrefFor(kind, id) }];
