"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, PickChip, useCommand } from "@/components/ui";
import { BackLink, Tabs, hrefFor, useBooking } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { BAND_TIME_ZONE } from "@/lib/timezone";
import { nameFromAddress } from "@/lib/email-signature";
import { roleFirst, fmtPhone } from "@/lib/venues";
import { e164 } from "@/schema/normalize";
import type { Row } from "@/lib/firestore-hooks";
import type { Contact } from "@/schema";

type Kind = "venue" | "promoter" | "festival" | "edition";
const KINDS: readonly string[] = ["venue", "promoter", "festival", "edition"];
interface ThreadHit { threadId: string; subject: string; snippet: string; lastDate: string; lastFrom: string; messageCount: number; participants: string[]; linkedId?: string }
interface PersonHit { email: string; name: string; title?: string; phone?: string; lastDate: string; count: number; contactId?: string }
type Place = { kind: Kind; id: string; name: string; word: string; attach: "venues" | "promoters" | "festivals"; placeId: string; href: string };

const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: BAND_TIME_ZONE });
const domainOf = (a: string) => a.split("@")[1] ?? "";

export default function Page() {
  return <AdminOnly><Suspense fallback={null}><SearchGmail /></Suspense></AdminOnly>;
}

function SearchGmail() {
  const params = useSearchParams();
  const [kindRaw, id = ""] = (params.get("target") ?? "").split(":");
  const pitch = params.get("pitch") ?? undefined;
  const b = useBooking();
  const me = useProfile();

  // The place the search is about; an edition's threads and contacts are its festival's.
  const found = useMemo((): { place: Place; contactIds: string[] } | null => {
    if (!KINDS.includes(kindRaw) || !id) return null;
    const kind = kindRaw as Kind;
    if (kind === "venue") {
      const v = b.venues.find((x) => x.id === id);
      return v ? { place: { kind, id, name: v.name, word: "venue", attach: "venues", placeId: id, href: hrefFor("venue", id) }, contactIds: roleFirst(v.contactIds.map((c) => ({ id: c })), v.bookingContactIds).map((c) => c.id) } : null;
    }
    if (kind === "promoter") {
      const p = b.promoters.find((x) => x.id === id);
      return p ? { place: { kind, id, name: p.name, word: "promoter", attach: "promoters", placeId: id, href: hrefFor("promoter", id) }, contactIds: p.contactIds ?? [] } : null;
    }
    const festivalId = kind === "edition" ? b.editions.find((e) => e.id === id)?.festivalId : id;
    const f = b.festivals.find((x) => x.id === festivalId);
    return f ? { place: { kind, id, name: f.name, word: "festival", attach: "festivals", placeId: f.id, href: hrefFor("festival", f.id) }, contactIds: f.contactIds ?? [] } : null;
  }, [kindRaw, id, b.venues, b.promoters, b.festivals, b.editions]);

  const contacts = useMemo(() => (found?.contactIds ?? []).map((c) => b.contacts.find((x) => x.id === c)).filter((c): c is Row<Contact> => !!c && c.emails.length > 0), [found, b.contacts]);
  const domains = useMemo(() => [...new Set(contacts.flatMap((c) => c.emails.map(domainOf)))], [contacts]);
  const sharedDomain = contacts.length > 0 && domains.length === 1 ? domains[0] : "";

  if (b.loading) return null;
  if (!found) return <div className="card" data-testid="search-no-place"><p className="s">Pick a venue, festival or promoter to search for first. <Link href="/booking" className="underline">Back to Booking</Link></p></div>;
  return <Search place={found.place} pitch={pitch} contacts={contacts} sharedDomain={sharedDomain} account={me.email} />;
}

function Search({ place, pitch, contacts, sharedDomain, account }: { place: Place; pitch?: string; contacts: Row<Contact>[]; sharedDomain: string; account: string }) {
  const [tab, setTab] = useState<"threads" | "people">("threads");
  const back = pitch ? `/booking/pitches/${pitch}` : place.href;
  return (
    <div className="show-page" data-testid="gmail-search-page">
      <PageTitle back={<BackLink href={back} label={pitch ? "Pitch" : place.name} />} title="Search Gmail" sub={`Looks in ${account}. Nothing is copied until you link it.`} />
      <section className="card">
        <Tabs<"threads" | "people"> value={tab} onChange={setTab} testid="gmail-tabs" options={[["threads", "Threads"], ["people", "People"]]} />
        {/* Both stay mounted so a search survives a switch of tab. */}
        <div hidden={tab !== "threads"}><ThreadsTab place={place} pitch={pitch} contacts={contacts} sharedDomain={sharedDomain} /></div>
        <div hidden={tab !== "people"}><PeopleTab place={place} sharedDomain={sharedDomain} active={tab === "people"} /></div>
      </section>
    </div>
  );
}

function ThreadsTab({ place, pitch, contacts, sharedDomain }: { place: Place; pitch?: string; contacts: Row<Contact>[]; sharedDomain: string }) {
  const router = useRouter();
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const [text, setText] = useState(place.name);
  const [pressed, setPressed] = useState<string[]>(() => contacts.map((c) => c.id));
  const [domainOn, setDomainOn] = useState(false);
  const [hits, setHits] = useState<ThreadHit[] | null>(null);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const target = { kind: place.kind, id: place.id };

  async function search() {
    const addresses = contacts.filter((c) => pressed.includes(c.id)).flatMap((c) => c.emails);
    const r = await call<ThreadHit[]>("email.search", { target, q: text.trim() || undefined, addresses, ...(domainOn && sharedDomain ? { domain: sharedDomain } : {}) });
    if (r) { setHits(r); setLinked({}); }
  }
  useEffect(() => { void search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (addr: string) => b.contacts.find((c) => c.emails.includes(addr))?.name ?? addr;
  const linkedId = (h: ThreadHit) => linked[h.threadId] ?? h.linkedId;
  async function link(h: ThreadHit) {
    const r = await call<{ id: string }>("email.link", { threadId: h.threadId, target, ...(pitch ? { pitchId: pitch } : {}) });
    if (r) setLinked((l) => ({ ...l, [h.threadId]: r.id }));
    return r?.id;
  }
  async function reply(h: ThreadHit) {
    const id = linkedId(h) ?? (await link(h));
    if (id) router.push(`/booking/email/${id}`);
  }

  return (
    <div className="grid gap-3 pt-3" data-testid="gmail-threads">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input className="input sm:flex-1" aria-label="Search Gmail" value={text} onChange={(e) => setText(e.target.value)} data-testid="gmail-q" />
        <button type="submit" className="btn acc" disabled={busy} data-testid="gmail-search">Search</button>
      </form>
      {contacts.length > 0 && (
        <div className="grid gap-1.5">
          <span className="lbl">Also from or to</span>
          <div className="flex flex-wrap gap-1.5" data-testid="gmail-from-chips">
            {contacts.map((c) => (
              <PickChip key={c.id} on={pressed.includes(c.id)} testid={`gmail-from-${c.id}`}
                onToggle={() => setPressed((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>{c.name}</PickChip>
            ))}
            {sharedDomain && <PickChip on={domainOn} testid="gmail-from-domain" onToggle={() => setDomainOn(!domainOn)}>anyone @{sharedDomain}</PickChip>}
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      {hits !== null && hits.length === 0 && <div className="empty" data-testid="gmail-none"><span>Nothing in Gmail matches. Try other words, or press another name.</span></div>}
      {hits !== null && hits.length > 0 && (
        <div className="grid gap-1" data-testid="gmail-results">
          {hits.map((h) => {
            const lid = linkedId(h);
            const who = h.participants.map(nameOf);
            return (
              <div key={h.threadId} className="flex flex-wrap items-start gap-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }} data-testid={`gmail-thread-${h.threadId}`}>
                <span className="avatar" aria-hidden>{(who[0] ?? h.subject).charAt(0).toUpperCase()}</span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="truncate">{h.subject || "(no subject)"}</b>
                    {lid && <span className="chip g" data-testid={`gmail-linked-${h.threadId}`}>On this {place.word}</span>}
                  </span>
                  <span className="s truncate">{who.join(", ")} · {h.messageCount} message{h.messageCount === 1 ? "" : "s"}</span>
                  <span className="line-clamp-2 text-sm">{h.snippet}</span>
                </span>
                <span className="s shrink-0">{short(h.lastDate)}</span>
                <span className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                  {lid
                    ? <Link href={`/booking/email/${lid}`} className="btn sm" data-testid={`gmail-open-${h.threadId}`}>Open</Link>
                    : <button type="button" className="btn sm" disabled={busy} onClick={() => void link(h)} data-testid={`gmail-link-${h.threadId}`}>Link to {place.word}</button>}
                  <button type="button" className="btn sm acc" disabled={busy} onClick={() => void reply(h)} data-testid={`gmail-reply-${h.threadId}`}>Reply from Roadie</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="s">Linking a thread puts it on this {place.word}&apos;s Email card and starts watching it for replies. Replying from Roadie links it too.</p>
    </div>
  );
}

function PeopleTab({ place, sharedDomain, active }: { place: Place; sharedDomain: string; active: boolean }) {
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const [q, setQ] = useState(sharedDomain);
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [phoned, setPhoned] = useState<string[]>([]);
  const target = { kind: place.kind, id: place.id };

  async function search() {
    if (!q.trim()) return;
    const r = await call<PersonHit[]>("email.people", { target, q: q.trim() });
    if (r) { setHits(r); setAdded({}); setPhoned([]); }
  }
  // The first time the tab is shown with a domain already in the box, look it up.
  const [ran, setRan] = useState(false);
  useEffect(() => { if (active && !ran) { setRan(true); void search(); } }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addContact(p: PersonHit) {
    const r = await call<{ id: string }>("contacts.create", { name: p.name || nameFromAddress(p.email), ...(p.title ? { title: p.title } : {}), emails: [p.email], ...(p.phone ? { phones: [p.phone] } : {}), attachTo: { kind: place.attach, id: place.placeId } });
    if (!r) return;
    if (place.attach === "venues" && !(await call("contacts.setRoles", { contactId: r.id, venueId: place.placeId, roles: ["booking"] }))) return;
    setAdded((a) => ({ ...a, [p.email]: r.id }));
  }
  async function addPhone(p: PersonHit, c: Row<Contact>) {
    if (await call("contacts.update", { id: c.id, patch: { phones: [...c.phones, p.phone] } })) setPhoned((x) => [...x, p.email]);
  }

  return (
    <div className="grid gap-3 pt-3" data-testid="gmail-people-tab">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input className="input sm:flex-1" aria-label="Find a person in Gmail" placeholder="A name, an address or a domain" value={q} onChange={(e) => setQ(e.target.value)} data-testid="gmail-people-q" />
        <button type="submit" className="btn acc" disabled={busy || !q.trim()} data-testid="gmail-people-search">Search</button>
      </form>
      <ErrorBox error={error} />
      {hits !== null && hits.length === 0 && <div className="empty" data-testid="gmail-people-none"><span>No one in Gmail matches that.</span></div>}
      {hits !== null && hits.length > 0 && (
        <div className="grid gap-1" data-testid="gmail-people">
          {hits.map((p) => {
            const contact = p.contactId ? b.contacts.find((c) => c.id === p.contactId) : undefined;
            const newId = added[p.email];
            const needsPhone = !!contact && !!p.phone && !contact.phones.includes(e164(p.phone)) && !phoned.includes(p.email);
            return (
              <div key={p.email} className="flex flex-wrap items-start gap-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }} data-testid={`gmail-person-${p.email}`}>
                <span className="avatar" aria-hidden>{(p.name || p.email).charAt(0).toUpperCase()}</span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <b className="truncate">{p.name || p.email}</b>
                  <span className="s"><span className="lbl">Email</span> {p.email}</span>
                  <span className="s"><span className="lbl">From signature</span> {p.title || p.phone ? [p.title, p.phone && fmtPhone(p.phone)].filter(Boolean).join(" · ") : "No signature"}</span>
                  <span className="s"><span className="lbl">Last email</span> {short(p.lastDate)} · {p.count} message{p.count === 1 ? "" : "s"} with you</span>
                </span>
                <span className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                  {p.contactId || newId
                    ? <>
                        <span className="chip g" data-testid={`gmail-known-${p.email}`}>{newId ? (place.attach === "venues" ? "Added · Booking" : "Added") : "Already a contact"}</span>
                        {needsPhone && contact && <button type="button" className="btn sm" disabled={busy} onClick={() => void addPhone(p, contact)} data-testid={`gmail-add-phone-${p.email}`}>Add the phone number</button>}
                      </>
                    : <button type="button" className="btn sm acc" disabled={busy} onClick={() => void addContact(p)} data-testid={`gmail-add-${p.email}`}>Add as contact</button>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="s">Names, titles and phone numbers come from email signatures. Check them before you save.</p>
    </div>
  );
}
