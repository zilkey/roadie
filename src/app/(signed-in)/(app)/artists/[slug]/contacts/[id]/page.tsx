"use client";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { formatCents } from "@/lib/money";
import { fmtLongYear, showCity, showName } from "@/lib/shows";
import { BackLink, ContactLinks, CopyButton, EntityForm, contactForm, hrefFor, useBooking, useNotFound, type Values } from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, useSingleEdit } from "@/components/booking/DetailCards";
import { STATUS_CHIP } from "@/components/shows/common";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { PickDialog, RowX, type PickItem } from "@/components/booking/PickDialog";
import { withBandNote } from "@/lib/bandNotes";
import type { ActDoc, ActNote, Contact, Expense, Payout, Show, ShowDeal } from "@/schema";
import { personSearchUrl } from "@/lib/links";
import { WeKnowToggle } from "@/components/booking/WhoWeKnow";

export default function Page() { return <AdminOnly><ContactPage /></AdminOnly>; }

type Parent = "venues" | "promoters" | "festivals";
const PARENT: Record<"venue" | "promoter" | "festival", Parent> = { venue: "venues", promoter: "promoters", festival: "festivals" };
const PARENT_NOUN: Record<Parent, string> = { venues: "venue", promoters: "promoter", festivals: "festival" };

// Each card autosaves its own fields, so each form builds only its own keys: a key left out would be cleared on the server.
/** Contact info: everything but the notes (the notes card saves those in place, into this band's contactNotes). */
const infoForm = {
  fields: contactForm.fields.filter((f) => f.key !== "notes"),
  build: (v: Values) => Object.fromEntries(Object.entries(contactForm.build(v)).filter(([k]) => k !== "notes")),
};

function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: shared, loading } = useDoc<Contact>("contacts", id);
  const b = useBooking();
  const { call, error, busy, setError } = useCommand();
  const edit = useSingleEdit<"info">();
  const [linking, setLinking] = useState(false);
  const { artistId } = useArtist();
  // Acts link their people on this band's actNotes (contactIds): read them all and pick this person's, like the Acts tab does.
  const actNotes = useCollection<ActNote>("actNotes", { where: [["artistId", "==", artistId]] });
  const nf = useNotFound(loading, shared, "contact");
  if (nf || !shared) return nf;
  const note = b.bandNotes.contacts.get(id);
  const c = withBandNote("contacts", shared, note);
  const actIds = (actNotes.rows ?? []).filter((n) => !n.deletedAt && n.contactIds?.includes(id)).map((n) => n.actId);
  const at = [
    // This band's venue notes say what they do there: they book it, or they're the day-of person.
    ...b.venues.filter((x) => x.contactIds?.includes(id)).map((x) => ({ kind: "venue" as const, id: x.id, name: x.name,
      roles: [x.bookingContactIds?.includes(id) && "books", x.dayOfContactIds?.includes(id) && "day-of"].filter((r): r is string => !!r) })),
    ...b.promoters.filter((x) => x.contactIds?.includes(id)).map((x) => ({ kind: "promoter" as const, id: x.id, name: x.name, roles: [] as string[] })),
    ...b.festivals.filter((x) => x.contactIds?.includes(id)).map((x) => ({ kind: "festival" as const, id: x.id, name: x.name, roles: [] as string[] })),
  ];
  // Things this contact is not linked to yet, for the "Works with" plus: `<kind>:<id>`, the kind and city on the muted line.
  const places: [Parent, { id: string; name: string; contactIds?: string[]; address?: { city?: string } }[]][] = [["venues", b.venues], ["promoters", b.promoters], ["festivals", b.festivals]];
  const free: PickItem[] = places.flatMap(([k, rows]) => rows
    .filter((x) => !x.contactIds?.includes(id))
    .map((x) => ({ id: `${k}:${x.id}`, name: x.name, sub: [PARENT_NOUN[k], x.address?.city].filter(Boolean).join(" · ") })));
  const archive = async () => { if (confirm(`Archive ${c.name}?`) && (await call("contacts.remove", { id }))) router.replace("/contacts"); };
  const link = async (value: string) => {
    const [kind, parentId] = value.split(":");
    return kind && parentId ? call("contacts.attach", { contactId: id, kind, id: parentId }) : undefined;
  };

  const infoRows: [string, React.ReactNode][] = [
    ["Email", c.emails.length > 0 ? (
      <div className="grid gap-2">
        {c.emails.map((e) => (
          <div key={e} className="flex items-center justify-between gap-2"><span className="font-mono text-sm break-all">{e}</span><CopyButton text={e} label="Copy email" /></div>
        ))}
      </div>
    ) : null],
    ["Phone", c.phones.length > 0 ? (
      <div className="grid gap-1">{c.phones.map((p) => <span key={p} className="font-mono text-sm">{p}</span>)}</div>
    ) : null],
    ["Role", c.title],
    ["Links", c.links?.length ? <ContactLinks links={c.links} /> : null],
    ["Instagram", c.instagram ? <a className="underline" href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noreferrer">@{c.instagram}</a> : null],
  ];

  return (
    <DetailPage testid="contact-page" back={<BackLink mode="back" href="/contacts" label="All contacts" />} title={c.name} meta={c.title}
      more={<span className="flex items-center gap-2">
        <WeKnowToggle kind="contact" id={id} on={!!c.weKnow} />
        <a className="btn ghost sm" href={personSearchUrl(c.name, c.title)} target="_blank" rel="noreferrer" data-testid="contact-google">Google ↗</a>
        <Menu label="More actions" testid="contact" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive contact", danger: true, onSelect: archive }]} />
      </span>}>
      <ErrorBox error={error} />
      {/* A contact is this band's own (contacts/{id}.artistId): every card is private, nothing here is shared with other bands. */}
      <CardGroup kind="private">
        <DetailCard private title="Contact info" editKey="info" edit={edit} editTestid="edit-toggle"
          editChildren={
            <div>
              <EntityForm testid="contact-edit" fields={infoForm.fields} initial={contactForm.initial(c)} build={infoForm.build}
                autosave={{ command: "contacts.update", id, rev: c.rev, title: c.name }} />
            </div>
          }>
          <KV rows={infoRows} />
        </DetailCard>

        <DetailCard private title="Works with" testid="works-with" headerExtra={<PlusButton label="Link a venue, festival or promoter" testid="works-add" onClick={() => setLinking(true)} />}>
          {at.length === 0 && actIds.length === 0 ? <div className="empty"><span>Not linked to anything yet.</span></div> : at.map((a) => (
            <div key={a.kind + a.id} className="d-row" data-testid={`works-${a.name}`}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <Link href={hrefFor(a.kind, a.id)} className="font-bold text-[var(--accent-text)] hover:underline">{a.name}</Link><span className="d-muted">{[a.kind, ...a.roles].join(" · ")}</span>
              </div>
              <RowX label={`Remove ${c.name} from ${a.name}`} disabled={busy} testid={`works-remove-${a.name}`}
                onClick={() => void call("contacts.detach", { contactId: id, kind: PARENT[a.kind], id: a.id })} />
            </div>
          ))}
          {actIds.map((actId) => (
            <ActRow key={actId} actId={actId} disabled={busy} onRemove={() => void call("contacts.detach", { contactId: id, kind: "acts", id: actId })} contactName={c.name} />
          ))}
          {at.length + actIds.length > 0 && <span className="s" data-testid="works-foot">× takes {c.name} off that place; they stay in Contacts.</span>}
        </DetailCard>
        <PickDialog open={linking} onClose={() => { setError(null); setLinking(false); }} title="Link a place" subtitle={`For ${c.name}`} testid="works-add"
          findLabel="Find it" placeholder="Name, kind or city" addLabel="Link" busy={busy} error={error} items={free}
          onPick={async (value) => !!(await link(value))} />
        <DetailCard private title="Our notes" testid="notes-private">
          <InlineValue testid="contact-notes" label="Notes" kind="textarea" value={c.notes ?? ""} canEdit error={error}
            onSave={async (next) => !!(await call("contacts.update", { id, patch: { notes: next || null } }))} />
        </DetailCard>

        <ShowsCard contactId={id} />
        <MoneyCard contactId={id} />
      </CardGroup>
    </DetailPage>
  );
}

/** An act this person works for (linked on the act's Contacts card), with an × that unlinks them. */
function ActRow({ actId, contactName, disabled, onRemove }: { actId: string; contactName: string; disabled: boolean; onRemove(): void }) {
  const { doc: act } = useDoc<ActDoc>("acts", actId);
  if (!act || act.deletedAt) return null;
  return (
    <div className="d-row" data-testid={`works-${act.name}`}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Link href={hrefFor("act", actId)} className="font-bold text-[var(--accent-text)] hover:underline">{act.name}</Link><span className="d-muted">act</span>
      </div>
      <RowX label={`Remove ${contactName} from ${act.name}`} disabled={disabled} testid={`works-remove-${act.name}`} onClick={onRemove} />
    </div>
  );
}

type Why = "deal" | "day-of" | "host";
const WHY_LABEL: Record<Why, string> = { deal: "On the deal", "day-of": "Day-of contact", host: "Host" };

/** Every show this person is on: the deal's contacts, the show's day-of contact, or a house-concert host. One row per show, date order, each with why. */
function ShowsCard({ contactId }: { contactId: string }) {
  const deals = useCollection<ShowDeal>("showDeals", { where: [["contactIds", "array-contains", contactId]] });
  const dayOf = useCollection<Show>("shows", { where: [["dayOfContact.contactId", "==", contactId]] });
  const hosted = useCollection<Show>("shows", { where: [["hostContactIds", "array-contains", contactId]] });
  const dealShows = useCollection<Show>("shows");
  const loading = [deals, dayOf, hosted, dealShows].some((c) => c.loading);
  const rows = useMemo(() => {
    const by = new Map<string, { show: Row<Show>; why: Why[] }>();
    const add = (show: Row<Show>, why: Why) => { const e = by.get(show.id); if (e) { if (!e.why.includes(why)) e.why.push(why); } else by.set(show.id, { show, why: [why] }); };
    const dealIds = new Set((deals.rows ?? []).map((d) => d.id)); // a showDeals doc has the id of its show
    for (const s of dealShows.rows ?? []) if (dealIds.has(s.id)) add(s, "deal");
    for (const s of dayOf.rows ?? []) add(s, "day-of");
    for (const s of hosted.rows ?? []) add(s, "host");
    return [...by.values()].sort((a, b) => a.show.date.localeCompare(b.show.date));
  }, [deals.rows, dayOf.rows, hosted.rows, dealShows.rows]);
  return (
    <DetailCard private title="Shows" testid="contact-shows">
      {loading ? null : rows.length === 0 ? <span className="s">None.</span> : (
        <div className="grid gap-2" data-testid="contact-shows-list">
          {rows.map(({ show: s, why }) => (
            <Link key={s.id} href={`/shows/${s.id}`} className="card" data-testid={`contact-show-${s.id}`}>
              <b>{fmtLongYear(s.date)} · {showName(s)}</b>
              <span className="s">{[showCity(s), STATUS_CHIP[s.status]?.[0], why.map((w) => WHY_LABEL[w]).join(", ")].filter(Boolean).join(" · ")}</span>
            </Link>
          ))}
        </div>
      )}
    </DetailCard>
  );
}

/** What the band paid this person: payouts and expenses made out to them. */
function MoneyCard({ contactId }: { contactId: string }) {
  const payouts = useCollection<Payout>("payouts", { where: [["to.contactId", "==", contactId]] });
  const expenses = useCollection<Expense>("expenses", { where: [["to.contactId", "==", contactId]] });
  const shows = useCollection<Show>("shows");
  const rows = useMemo(() => {
    const dateOf = (showId: string | undefined, fallback: string | undefined) => (showId ? (shows.rows ?? []).find((s) => s.id === showId)?.date : undefined) ?? fallback ?? "";
    return [
      ...(payouts.rows ?? []).map((p) => ({ key: `p${p.id}`, kind: "Payout", date: dateOf(p.showId, p.paidAt ?? p.dueDate), what: p.what ?? "Payout", amount: p.amount, open: !p.paidAt })),
      ...(expenses.rows ?? []).map((e) => ({ key: `e${e.id}`, kind: "Expense", date: dateOf(e.showId, e.date), what: e.what, amount: e.amount, open: false })),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }, [payouts.rows, expenses.rows, shows.rows]);
  return (
    <DetailCard private title="Money" testid="contact-money">
      {[payouts, expenses, shows].some((c) => c.loading) ? null : rows.length === 0 ? <span className="s">None.</span> : (
        <div data-testid="contact-money-list">
          {rows.map((r) => (
            <div key={r.key} className="d-row" data-testid={`contact-money-${r.key}`}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <b>{r.date ? fmtLongYear(r.date) : "No date"}</b><span>{r.what}</span><span className="d-muted">{r.kind}{r.open ? " · we owe" : ""}</span>
              </div>
              <span className="font-mono text-sm">{formatCents(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </DetailCard>
  );
}
