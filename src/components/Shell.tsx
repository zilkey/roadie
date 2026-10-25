"use client";
import Link from "@/lib/artist";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { useAuth, useProfile } from "@/lib/auth";
import { useArtist, useHref } from "@/lib/artist";
import { ARTISTS_PATH, artistPath } from "@/lib/routes";
import { Roadie } from "@/components/roadie/Roadie";
import { setSectionHidden, setSectionOrder, useHiddenSections } from "@/lib/sections";
import { isSectionId, SECTION_IDS, type SectionId } from "@/schema/sections";
import { I, navFor, type NavItem } from "@/lib/nav";
import { Dialog } from "@/components/ui";
import { toast } from "@/components/Toasts";

function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

/** The artist-settings sections (artist-relative), named as in the settings sub-nav. the band setup card, the phone title and `useOn` read this. */
export const ADMIN_LINKS = [
  { href: "/admin/artist", label: "General", testid: "admin-artist" },
  { href: "/admin/lineups", label: "Lineups", testid: "admin-lineups" },
  { href: "/admin/people", label: "People", testid: "admin-people" },
  { href: "/admin/fields", label: "Custom fields", testid: "admin-fields" },
  { href: "/admin/mcp", label: "Integrations", testid: "admin-mcp" },
  { href: "/admin/history", label: "Activity", testid: "admin-history" },
];

const NAV_LINK = "inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-xl px-3.5 text-[15px] no-underline";
const MENU_HEAD = "px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-muted";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** A button that opens a `.menu-list` under it. Any click inside the list closes it; so do Escape and a click outside. */
function Dropdown({ label, testid, trigger, className, listTestid, left, children }: {
  label: string; testid: string; trigger: React.ReactNode; className: string; listTestid?: string; left?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <div className="menu" ref={root} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); btn.current?.focus(); } }}>
      <button ref={btn} type="button" className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open} data-testid={testid} onClick={() => setOpen(!open)}>{trigger}</button>
      {open && <div className="menu-list" role="menu" aria-label={label} data-testid={listTestid} style={left ? { left: 0, right: "auto" } : undefined} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

/** The avatar menu's rows: your name, your profile, Customize menu, Claude Code (admins), Sign out. Band settings live in the band menu. */
function AccountItems({ name, role, signOut, signoutTestid, switchTo, onEdit }: { name: string; role: string; signOut(): void; signoutTestid: string; switchTo?: string; onEdit(): void }) {
  const on = useOn();
  return (
    <>
      <div className="px-3 py-2" data-testid="whoami"><div className="text-sm font-bold">{name}</div><div className="s">{role}</div></div>
      {switchTo && <NextLink href={switchTo} role="menuitem" className="menu-item" data-testid="switch-artist-mobile">Switch band</NextLink>}
      <div className="menu-sep" role="separator" />
      <Link href="/me" role="menuitem" data-testid="side-me" aria-current={on("/me") ? "page" : undefined} className={`menu-item${on("/me") ? " text-accent" : ""}`}>Your profile</Link>
      <button type="button" role="menuitem" className="menu-item" data-testid="account-edit-menu" onClick={onEdit}>Customize menu</button>
      {role === "admin" && <Link href="/admin/mcp" role="menuitem" data-testid="side-admin-mcp" aria-current={on("/admin/mcp") ? "page" : undefined} className={`menu-item${on("/admin/mcp") ? " text-accent" : ""}`}>Claude Code</Link>}
      <div className="menu-sep" role="separator" />
      <button type="button" role="menuitem" className="menu-item" data-testid={signoutTestid} onClick={signOut}>Sign out</button>
    </>
  );
}
/**
 * Is the browser on this link's page? A link covers its own path and everything under it, except what a more specific
 * link already covers: /booking/templates is its own section, so /booking doesn't light up for it.
 */
const NAV_HREFS = [...navFor("admin", [...SECTION_IDS]).map((n) => n.href), ...ADMIN_LINKS.map((l) => l.href), "/me"];
function useOn() {
  const path = usePathname();
  const full = useHref();
  const under = (href: string) => path === full(href) || path.startsWith(full(href) + "/");
  return (href: string) => under(href) && !NAV_HREFS.some((o) => o.length > href.length && under(o));
}

/** The rows of More (desktop) and of the phone's More sheet: main sections that don't fit the bar or are switched off. */
function MoreItems({ items, testidPrefix = "more" }: { items: NavItem[]; testidPrefix?: string }) {
  const on = useOn();
  return (
    <>
      {items.map((n) => (
        <Link key={n.key} href={n.href} role="menuitem" data-testid={`${testidPrefix}-${n.key}`} aria-current={on(n.href) ? "page" : undefined} className={`menu-item${on(n.href) ? " bg-accent-soft text-accent" : ""}`}><Icon d={n.icon} size={20} />{n.label}</Link>
      ))}
    </>
  );
}

/** "Customize menu": per section an on/off switch and up/down. Saved per user as it changes. */
function EditMenuDialog({ open, onClose, role, hidden, order }: { open: boolean; onClose(): void; role: string; hidden: SectionId[]; order: SectionId[] }) {
  const rows = navFor(role as "admin" | "member", order).filter((n) => n.key !== "calendar") as (NavItem & { key: SectionId })[];
  const fail = (what: string, e: unknown) => toast({ key: "menu-edit", text: `Couldn't ${what}: ${e instanceof Error ? e.message : "error"}`, ms: 6000 });
  async function toggle(n: NavItem & { key: SectionId }) {
    try { await setSectionHidden(n.key, !hidden.includes(n.key)); } catch (e) { fail(`change ${n.label}`, e); }
  }
  async function move(i: number, by: -1 | 1) {
    const keys = rows.map((r) => r.key);
    const j = i + by;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
    // sections this role can't see (Booking for members) keep their slots in the stored order
    let k = 0;
    const next = order.map((s) => (keys.includes(s) ? keys[k++]! : s));
    try { await setSectionOrder(next); } catch (e) { fail("reorder the menu", e); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Customize menu" testid="menu-dialog">
      <p className="s">Switch sections off to tuck them into More, and move them up or down. Calendar is always first.</p>
      <ul className="grid gap-1" aria-label="Sections">
        {rows.map((n, i) => {
          const off = hidden.includes(n.key);
          return (
            <li key={n.key} className="flex items-center gap-2 rounded-xl border border-border px-3" data-testid={`menu-row-${n.key}`}>
              <span className="flex-1 text-sm font-semibold">{n.label}</span>
              <button type="button" className="icon-btn" aria-label={`Move ${n.label} up`} disabled={i === 0} data-testid={`menu-up-${n.key}`} onClick={() => move(i, -1)}><Icon d={I.up} size={18} /></button>
              <button type="button" className="icon-btn" aria-label={`Move ${n.label} down`} disabled={i === rows.length - 1} data-testid={`menu-down-${n.key}`} onClick={() => move(i, 1)}><span className="rotate-180"><Icon d={I.up} size={18} /></span></button>
              <button type="button" role="switch" aria-checked={!off} aria-label={`Show ${n.label} in my menu`} data-testid={`menu-switch-${n.key}`} onClick={() => toggle(n)}
                className="inline-flex h-11 w-14 shrink-0 items-center justify-center"><span className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${off ? "bg-divider" : "bg-[var(--accent)]"}`}>
                  <span className={`h-5 w-5 rounded-full bg-surface shadow transition-transform ${off ? "" : "translate-x-5"}`} /></span></button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end"><button type="button" className="btn" data-testid="menu-done" onClick={onClose}>Done</button></div>
    </Dialog>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  // The print route is just the sheets: no nav, no Roadie column.
  if (usePathname().endsWith("/print")) return <>{children}</>;
  return <ShellFrame>{children}</ShellFrame>;
}

function ShellFrame({ children }: { children: React.ReactNode }) {
  const profile = useProfile();
  const { signOut } = useAuth();
  const artist = useArtist();
  const router = useRouter();
  const path = usePathname();
  const full = useHref();
  const { hidden, order } = useHiddenSections();
  const on = useOn();
  const all = navFor(profile.role, order);
  const away = (n: NavItem) => isSectionId(n.key) && hidden.includes(n.key);
  const shown = all.filter((n) => !away(n));
  const switchedOff = all.filter(away);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(false);

  // Desktop: how many of the shown sections fit in the top bar. A hidden copy of the row is measured, so nothing jumps.
  const navBox = useRef<HTMLElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(shown.length);
  const sig = shown.map((n) => n.key + n.label).join("|");
  useLayoutEffect(() => {
    const box = navBox.current, m = measure.current;
    if (!box || !m) return;
    const compute = () => {
      const avail = box.clientWidth;
      if (avail === 0) return; // the phone layout: nothing to fit
      const w = Array.from(m.querySelectorAll<HTMLElement>("[data-m=item]")).map((e) => e.getBoundingClientRect().width);
      const moreW = m.querySelector<HTMLElement>("[data-m=more]")?.getBoundingClientRect().width ?? 0;
      let used = moreW, k = 0;
      for (const x of w) { if (k > 0 && used + 4 + x > avail) break; used += 4 + x; k++; }
      setFit(Math.max(1, k));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(box); ro.observe(m);
    return () => ro.disconnect();
  }, [sig]);
  const inBar = shown.slice(0, fit);
  const overflow = shown.slice(fit);
  const moreDesktop = [...switchedOff, ...overflow];
  const phoneTabs = shown.slice(0, 4);
  const morePhone = [...switchedOff, ...shown.slice(4)];

  const current = all.find((n) => on(n.href));
  const atRoot = all.some((n) => path === full(n.href));
  const title = current?.label ?? ADMIN_LINKS.find((l) => on(l.href))?.label ?? (on("/me") ? "Your profile" : artist.name);
  const edit = () => { setSheet(false); setEditing(true); };
  const switchTo = profile.artists.length > 1 ? ARTISTS_PATH : undefined;
  // The shows list and the booking tabs' tables use the full width, and so does a show's page (its checklists are a column on the right edge);
  // every other page (other detail pages too) keeps the 1240px column.
  const showPage = path.startsWith(full("/shows/")) && !path.startsWith(full("/shows/new")) && path.split("/").length === full("/shows/x").split("/").length;
  const wide = showPage || ["/shows", "/booking", "/booking/pitches", "/booking/venues", "/booking/festivals", "/booking/promoters", "/booking/contacts"].some((p) => path === full(p));

  const barLink = (n: NavItem, testid?: string) => (
    <Link key={n.key} href={n.href} data-testid={testid} aria-current={on(n.href) ? "page" : undefined}
      className={`${NAV_LINK} ${on(n.href) ? "bg-accent-soft font-bold text-accent" : "font-semibold text-nav hover:bg-divider"}`}>{n.label}</Link>
  );
  const switcher = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--strong)] text-xs font-bold text-[var(--on-strong)]" aria-hidden>{initials(artist.name)}</span>
      <span className="truncate text-[15px] font-bold" data-testid="current-artist">{artist.name}</span>
      <Icon d={I.chevron} size={16} />
    </>
  );
  const switcherClass = "flex h-11 min-w-0 max-w-[260px] items-center gap-2.5 rounded-xl px-1.5 text-ink no-underline";

  return (
    <div className="min-h-dvh min-[900px]:flex" style={{ "--tabbar-h": "calc(60px + env(safe-area-inset-bottom))" } as React.CSSProperties}>
      {profile.role === "admin" && <Roadie />}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar */}
        <header className="@container hidden h-[68px] shrink-0 items-center gap-4 border-b border-border bg-surface px-5 min-[900px]:flex" data-testid="topbar">
          {/* Only when the bar has room to spare: the nav tabs come first (with Roadie's panel open there often isn't) */}
          <NextLink href={ARTISTS_PATH} className="hidden shrink-0 @min-[1000px]:block" data-testid="topbar-logo"><img src="/logo-header.svg" alt="Roadie" width={109} height={36} /></NextLink>
          <Dropdown label="Band menu" testid="band-menu" left className={switcherClass} trigger={switcher} listTestid="band-menu-list">
            <div className="px-3 py-2"><div className="text-sm font-bold">{artist.name}</div><div className="s">{profile.role === "admin" ? "You're an admin" : "You're a member"}</div></div>
            {profile.role === "admin" && <Link href="/admin/artist" role="menuitem" data-testid="band-menu-settings" className="menu-item">Artist settings</Link>}
            <div className="menu-sep" role="separator" />
            <div className={MENU_HEAD}>Switch artist</div>
            {profile.artists.map((a) => (
              <NextLink key={a.slug} href={artistPath(a.slug)} role="menuitem" data-testid={`band-menu-artist-${a.slug}`} aria-current={a.slug === artist.slug ? "page" : undefined} className="menu-item">
                <span className="flex-1 truncate">{a.name}</span>{a.slug === artist.slug && <span aria-label="Current artist">✓</span>}
              </NextLink>
            ))}
            <button type="button" role="menuitem" aria-disabled="true" className="menu-item" data-testid="band-menu-add-artist" onClick={(e) => e.stopPropagation()}><span className="flex-1">Add an artist</span><span className="s">Not ready yet</span></button>
          </Dropdown>
          <nav ref={navBox} className="relative min-w-0 flex-1" aria-label="Main">
            <div className="flex items-center gap-1">
              {inBar.map((n) => barLink(n, `tab-${n.key}`))}
              <Dropdown label="More" testid="more-toggle" left className={`${NAV_LINK} gap-1 ${moreDesktop.some((n) => on(n.href)) ? "bg-accent-soft font-bold text-accent" : "font-semibold text-nav hover:bg-divider"}`}
                trigger={<>More<Icon d={I.chevron} size={16} /></>} listTestid="more-menu">
                <MoreItems items={moreDesktop} />
              </Dropdown>
            </div>
            <div ref={measure} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max items-center gap-1 overflow-hidden">
              {shown.map((n) => <span key={n.key} data-m="item" className={`${NAV_LINK} font-bold`}>{n.label}</span>)}
              <span data-m="more" className={`${NAV_LINK} gap-1 font-bold`}>More<Icon d={I.chevron} size={16} /></span>
            </div>
          </nav>
          <Dropdown label="Account menu" testid="account-menu" className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-[15px] font-bold text-accent hover:brightness-95"
            trigger={initials(profile.name).slice(0, 1)}>
            <AccountItems name={profile.name} role={profile.role} signOut={signOut} signoutTestid="signout" onEdit={edit} />
          </Dropdown>
        </header>

        {/* Phone top bar */}
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 min-[900px]:hidden" data-testid="phonebar">
          {atRoot ? <span className="w-2" /> : <button type="button" className="icon-btn text-ink" aria-label="Back" data-testid="back-button" onClick={() => router.back()}><Icon d={I.back} /></button>}
          <span className="min-w-0 flex-1 truncate text-base font-bold" data-testid="section-title">{title}</span>
          <Dropdown label="More actions" testid="account-menu-mobile" className="icon-btn text-ink" trigger={<Icon d={I.more} />}>
            <AccountItems name={profile.name} role={profile.role} signOut={signOut} signoutTestid="signout-mobile" switchTo={switchTo} onEdit={edit} />
          </Dropdown>
        </header>

        <main className={`w-full ${wide ? "" : "max-w-[1240px] "}flex-1 px-4 pb-[calc(var(--tabbar-h)+200px)] pt-5 min-[900px]:px-8 min-[900px]:pb-[200px] min-[900px]:pt-6`}>{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-10 grid h-[var(--tabbar-h)] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] min-[900px]:hidden"
          style={{ gridTemplateColumns: `repeat(${phoneTabs.length + 1}, 1fr)` }} data-testid="bottom-tabs">
          {phoneTabs.map((n) => (
            <Link key={n.key} href={n.href} data-testid={`mtab-${n.key}`} aria-current={on(n.href) ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 text-xs font-semibold no-underline ${on(n.href) ? "text-accent" : "text-muted"}`}>
              <Icon d={n.icon} />{n.label}
            </Link>
          ))}
          <button type="button" data-testid="mtab-more" aria-expanded={sheet} onClick={() => setSheet(!sheet)}
            className={`flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${morePhone.some((n) => on(n.href)) || sheet ? "text-accent" : "text-muted"}`}>
            <Icon d={I.more} />More
          </button>
        </nav>
        {sheet && (
          <>
            <div className="fixed inset-x-0 top-0 bottom-[var(--tabbar-h)] z-10 min-[900px]:hidden" onClick={() => setSheet(false)} aria-hidden />
            <div className="fixed inset-x-2 bottom-[calc(var(--tabbar-h)+8px)] z-20 grid gap-0.5 rounded-[14px] border border-border bg-surface p-1.5 shadow-lg min-[900px]:hidden" role="menu" aria-label="More" data-testid="more-sheet" onClick={() => setSheet(false)}>
              <MoreItems items={morePhone} testidPrefix="msheet" />
            </div>
          </>
        )}
      </div>
      <EditMenuDialog open={editing} onClose={() => setEditing(false)} role={profile.role} hidden={hidden} order={order} />
    </div>
  );
}
