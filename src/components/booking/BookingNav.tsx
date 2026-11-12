"use client";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Link, useArtist, useHref } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { isActive } from "@/lib/booking";
import { previousPath, subscribeNav } from "@/lib/navHistory";
import { ROUTES } from "@/lib/routes";
import type { Pitch } from "@/schema";
import { hrefFor } from "@/components/booking/common";

/**
 * The Booking sub-nav (admins only): Pitches, Places, Discover, Set up. Beside the page on desktop; on a phone the same links
 * become one row that scrolls sideways above it. Members who open a venue page get the page alone.
 */
export function BookingLayout({ children }: { children: React.ReactNode }) {
  const { role } = useArtist();
  const [q, setQ] = useState("");
  if (role !== "admin") return <>{children}</>;
  return (
    <SearchContext.Provider value={{ q, setQ }}>
      <div className="min-[900px]:flex min-[900px]:items-start min-[900px]:gap-6">
        <BookingNav />
        <div className="min-w-0 min-[900px]:flex-1">{children}</div>
      </div>
    </SearchContext.Provider>
  );
}

/**
 * The search typed on a Booking list. The list publishes it here so the sub-nav's links carry it along as ?q= (the next
 * section opens already searching), as the tabs did.
 */
const SearchContext = createContext<{ q: string; setQ(q: string): void }>({ q: "", setQ: () => {} });
export const useBookingSearch = () => useContext(SearchContext);

type Key = "pitches" | "venues" | "festivals" | "promoters" | "contacts" | "calendars" | "acts" | "templates";
interface Item { key: Key; href: string; label: string; /** Paths under /booking that light this item up besides its own (record pages that belong to it). */ also?: string[] }
const GROUPS: { head: string; items: Item[] }[] = [
  { head: "Pitches", items: [{ key: "pitches", href: ROUTES.bookingPitches.path, label: ROUTES.bookingPitches.title, also: ["/booking", "/booking/email"] }] },
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
const SEARCHABLE: Key[] = ["pitches", "venues", "festivals", "promoters", "calendars", "acts"];

function BookingNav() {
  const path = usePathname();
  const full = useHref();
  const { artistId } = useArtist();
  const { q } = useBookingSearch();
  const pitches = useCollection<Pitch>("pitches", { where: [["artistId", "==", artistId]] });
  const activeCount = pitches.rows?.filter((p) => isActive(p.status)).length;
  const under = (href: string) => path === full(href) || path.startsWith(full(href) + "/");
  const on = (i: Item) => under(i.href) || (i.also ?? []).some((a) => a === "/booking" ? path === full(a) : under(a));
  const href = (i: Item) => SEARCHABLE.includes(i.key) && q.trim() ? `${i.href}?q=${encodeURIComponent(q)}` : i.href;
  return (
    <nav aria-label="Booking" data-testid="booking-nav"
      className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 pb-2 min-[900px]:sticky min-[900px]:top-6 min-[900px]:mx-0 min-[900px]:mb-0 min-[900px]:w-[220px] min-[900px]:shrink-0 min-[900px]:flex-col min-[900px]:gap-0 min-[900px]:overflow-visible min-[900px]:rounded-lg min-[900px]:border min-[900px]:bg-surface min-[900px]:p-2">
      {GROUPS.map((g) => (
        <div key={g.head} className="contents min-[900px]:block">
          <div className="hidden px-3 pb-1 pt-2 text-[0.6875rem] font-bold uppercase tracking-wide text-muted min-[900px]:block">{g.head}</div>
          {g.items.map((i) => (
            <Link key={i.key} href={href(i)} data-testid={`booking-seg-${i.key}`} aria-current={on(i) ? "page" : undefined}
              className={`menu-item shrink-0 whitespace-nowrap${on(i) ? " bg-accent-soft text-accent" : ""}`}>
              {i.label}
              {i.key === "pitches" && activeCount !== undefined && <span className="chip a ml-auto" data-testid="pitch-count">{activeCount}</span>}
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
export function Crumbs({ items, back }: { items: Crumb[]; back?: React.ReactNode }) {
  const { role } = useArtist();
  const router = useRouter();
  const full = useHref();
  const prev = useSyncExternalStore(subscribeNav, previousPath, () => undefined);
  if (role !== "admin") return <>{back}</>;
  const from = prev && SECTIONS.find((i) => (i.key === "pitches" ? [i.href, "/booking"] : [i.href]).some((h) => full(h) === prev));
  const fromHref = from && (from.key === "pitches" && prev === full("/booking") ? "/booking" : from.href);
  const isSection = SECTIONS.some((i) => i.href === items[0]?.href);
  const head = from && fromHref && isSection ? [{ label: from.label, href: fromHref }, ...items.slice(1)] : items;
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
/** The trail down to a place, or to its pitch when there is one: Pitch List › the place's pitch, else Venues › the venue. */
export const placeTrail = (kind: PlaceKind, id: string, name: string, pitchId?: string): Crumb[] => pitchId
  ? [{ label: ROUTES.bookingPitches.title, href: ROUTES.bookingPitches.path }, { label: name, href: `/booking/pitches/${pitchId}` }]
  : [sectionCrumb(kind), { label: name, href: hrefFor(kind, id) }];
