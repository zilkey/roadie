"use client";
import { useMemo, useState } from "react";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { draftPath } from "@/schema/drafts";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { WelcomeEmpty } from "@/components/WelcomeEmpty";
import { EntityForm, contactForm, hrefFor, useBooking, type SubmitMeta } from "@/components/booking/common";
import { fmtPhone } from "@/components/booking/listRows";
import { useCollection } from "@/lib/firestore-hooks";
import { useHasDraft } from "@/lib/drafts";
import { highlight } from "@/lib/booking";
import { isAgent, isManager } from "@/lib/contactRoles";
import type { Show } from "@/schema";

/** The Contacts section: everyone the band deals with, with where they work. Admins only (contacts are admin-only data). */
export function ContactsIndex() { return <AdminOnly><Contacts /></AdminOnly>; }

type Filter = "venue" | "festival" | "promoter" | "host" | "manager" | "agent" | "email";
const FILTERS: [Filter, string][] = [["venue", "Venue"], ["festival", "Festival"], ["promoter", "Promoter"], ["host", "Host"], ["manager", "Managers"], ["agent", "Booking agents"], ["email", "Has email"]];
type Place = { kind: "venue" | "festival" | "promoter"; id: string; name: string; city?: string };

const Dash = () => <span className="dash">—</span>;

function Contacts() {
  const router = useRouter();
  const b = useBooking();
  const shows = useCollection<Show>("shows");
  const { call, error } = useCommand();
  const [q, setQ] = useState("");
  const [on, setOn] = useState<Filter[]>([]);
  // An unfinished "new contact" opens its form by itself; Cancel (or a create) clears the draft, so it doesn't come back on load.
  const hasDraft = useHasDraft(draftPath.newIn("contacts"));
  const [explicit, setAdd] = useState<boolean | undefined>(undefined);
  const adding = explicit ?? hasDraft;

  const hosts = useMemo(() => new Set((shows.rows ?? []).flatMap((s) => s.hostContactIds ?? [])), [shows.rows]);
  // Every place each contact is linked to: venues, then festivals, then promoters.
  const placesOf = useMemo(() => {
    const m = new Map<string, Place[]>();
    const add = (cid: string, p: Place) => m.set(cid, [...(m.get(cid) ?? []), p]);
    for (const v of b.venues) for (const c of v.contactIds ?? []) add(c, { kind: "venue", id: v.id, name: v.name, city: v.address.city });
    for (const f of b.festivals) for (const c of f.contactIds ?? []) add(c, { kind: "festival", id: f.id, name: f.name, city: f.address?.city });
    for (const p of b.promoters) for (const c of p.contactIds ?? []) add(c, { kind: "promoter", id: p.id, name: p.name });
    return m;
  }, [b.venues, b.festivals, b.promoters]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...b.contacts].sort((x, y) => x.name.localeCompare(y.name)).filter((c) => {
      const at = placesOf.get(c.id) ?? [];
      if (needle && ![c.name, ...c.emails, c.title ?? "", ...at.map((p) => p.name)].some((t) => t.toLowerCase().includes(needle))) return false;
      return on.every((f) => f === "host" ? hosts.has(c.id) : f === "email" ? c.emails.length > 0 : f === "manager" ? isManager(c.title) : f === "agent" ? isAgent(c.title) : at.some((p) => p.kind === f));
    });
  }, [b.contacts, placesOf, hosts, q, on]);

  const toggle = (f: Filter) => setOn((x) => x.includes(f) ? x.filter((y) => y !== f) : [...x, f]);
  async function create(data: Record<string, unknown>, meta: SubmitMeta) {
    const r = await call<{ id: string }>("contacts.create", data, meta);
    if (r) router.push(hrefFor("contact", r.id));
    return !!r;
  }
  const form = adding && (
    <EntityForm testid="new-contact" fields={contactForm.fields} initial={contactForm.blank} build={contactForm.build}
      submitLabel="Add contact" onSubmit={create} onCancel={() => setAdd(false)}
      draft={{ path: draftPath.newIn("contacts"), route: "/contacts", title: (v) => `New contact${v.name ? ` · ${v.name}` : ""}` }} />
  );
  const addButton = <button type="button" className="btn acc" data-testid="add-contact" onClick={() => setAdd(!adding)}>+ Add contact</button>;

  if (!b.loading && b.contacts.length === 0) {
    return (
      <WelcomeEmpty section="contacts" title="Welcome to Contacts!"
        body="The people you deal with: the talent buyer at a room, a festival producer, a promoter. Add them here, or from a venue, festival or promoter page, and see where each one works."
        actions={addButton}>
        <ErrorBox error={error} />
        {form}
      </WelcomeEmpty>
    );
  }

  return (
    <div className="grid gap-5">
      <PageTitle title="Contacts" center actions={<>
        <label className="search-field">
          <svg className="search-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className="input" type="search" placeholder="Search name, email, role, place…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="contacts-search" aria-label="Search contacts" />
          {q.trim() && <button type="button" className="search-clear" onClick={() => setQ("")} data-testid="contacts-search-clear">Clear</button>}
        </label>
        {addButton}
      </>} />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter contacts" data-testid="contacts-filters">
        <span className="s font-semibold whitespace-nowrap">Filter by</span>
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" className={`chip w${on.includes(f) ? " dk" : ""}`} aria-pressed={on.includes(f)} data-testid={`contacts-filter-${f}`} onClick={() => toggle(f)}>{label}</button>
        ))}
        {on.length > 0 && <button type="button" className="search-clear" onClick={() => setOn([])} data-testid="contacts-filter-clear">Clear filters</button>}
      </div>
      <ErrorBox error={error} />
      {form}
      <div className="grid min-w-0 gap-3" data-testid="contacts-list">
        {b.loading && <span className="s">Loading…</span>}
        {!b.loading && rows.length === 0 && <div className="empty" data-testid="no-results"><span>Nothing matches.</span></div>}
        {rows.length > 0 && (
          <div className="book-tw">
            <table className="book-table">
              <thead><tr><th>Name</th><th>Works with</th><th>City</th><th>Email</th><th>Phone</th></tr></thead>
              <tbody>
                {rows.map((c) => {
                  const at = placesOf.get(c.id) ?? [];
                  const hl = (text: string) => { const h = q.trim() ? highlight(text, q) : null; return h?.match ? <>{h.before}<mark>{h.match}</mark>{h.after}</> : text; };
                  return (
                    <tr key={c.id} data-testid={`row-contact-${c.id}`}>
                      <td className="name">
                        <Link href={hrefFor("contact", c.id)} className="nm" data-testid={`contact-full-${c.id}`}>{hl(c.name)}</Link>
                        {c.title && <span className="sub">{c.title}</span>}
                      </td>
                      <td data-testid={`contact-works-${c.id}`}>
                        {at.length === 0 ? <Dash /> : <>
                          {at.slice(0, 2).map((p, i) => <span key={p.kind + p.id}>{i > 0 && ", "}<Link href={hrefFor(p.kind, p.id)}>{p.name}</Link></span>)}
                          {at.length > 2 && <span className="s"> +{at.length - 2}</span>}
                        </>}
                      </td>
                      <td className="nw">{at.find((p) => p.kind === "venue")?.city || <Dash />}</td>
                      <td>{c.emails[0] ? <a className="em" href={`mailto:${c.emails[0]}`}>{hl(c.emails[0])}</a> : <Dash />}</td>
                      <td className="nw">{c.phones[0] ? <a className="ph" href={`tel:${c.phones[0]}`}>{fmtPhone(c.phones[0])}</a> : <Dash />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
