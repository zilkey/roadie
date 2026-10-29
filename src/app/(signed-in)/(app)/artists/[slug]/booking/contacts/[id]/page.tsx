"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useDoc } from "@/lib/firestore-hooks";
import { BackLink, CopyButton, EntityForm, contactForm, hrefFor, useBooking, useNotFound, type Values } from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { ShowLinks } from "@/components/shows/common";
import { InlineValue, PlusButton } from "@/components/InlineValue";
import { PickDialog, RowX, type PickItem } from "@/components/booking/PickDialog";
import { withBandNote } from "@/lib/bandNotes";
import type { Contact } from "@/schema";

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
  const nf = useNotFound(loading, shared, "contact");
  if (nf || !shared) return nf;
  const note = b.bandNotes.contacts.get(id);
  const c = withBandNote("contacts", shared, note);
  const at = [
    ...b.venues.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "venue" as const, id: x.id, name: x.name })),
    ...b.promoters.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "promoter" as const, id: x.id, name: x.name })),
    ...b.festivals.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "festival" as const, id: x.id, name: x.name })),
  ];
  // Things this contact is not linked to yet, for the "Works with" plus: `<kind>:<id>`, the kind and city on the muted line.
  const places: [Parent, { id: string; name: string; contactIds: string[]; address?: { city?: string } }[]][] = [["venues", b.venues], ["promoters", b.promoters], ["festivals", b.festivals]];
  const free: PickItem[] = places.flatMap(([k, rows]) => rows
    .filter((x) => !x.contactIds.includes(id))
    .map((x) => ({ id: `${k}:${x.id}`, name: x.name, sub: [PARENT_NOUN[k], x.address?.city].filter(Boolean).join(" · ") })));
  const archive = async () => { if (confirm(`Archive ${c.name}?`) && (await call("contacts.remove", { id }))) router.replace("/booking"); };
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
    ["Instagram", c.instagram ? <a className="underline" href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noreferrer">@{c.instagram}</a> : null],
  ];

  return (
    <DetailPage testid="contact-page" back={<BackLink mode="back" href="/booking/contacts" label="All contacts" />} title={c.name} meta={c.title}
      more={<Menu label="More actions" testid="contact" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[{ key: "archive", label: "Archive contact", danger: true, onSelect: archive }]} />}>
      <ErrorBox error={error} />
      <CardGroup kind="shared">
        <DetailCard title="Contact info" editKey="info" edit={edit} warn={SHARED_WARN} editTestid="edit-toggle"
          editChildren={
            <div>
              <EntityForm testid="contact-edit" fields={infoForm.fields} initial={contactForm.initial(c)} build={infoForm.build}
                autosave={{ command: "contacts.update", id, rev: c.rev, title: c.name }} />
            </div>
          }>
          <KV rows={infoRows} />
        </DetailCard>

        <DetailCard title="Works with" testid="works-with" headerExtra={<PlusButton label="Link a venue, festival or promoter" testid="works-add" onClick={() => setLinking(true)} />}>
          {at.length === 0 ? <div className="empty"><span>Not linked to anything yet.</span></div> : at.map((a) => (
            <div key={a.kind + a.id} className="d-row" data-testid={`works-${a.name}`}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <Link href={hrefFor(a.kind, a.id)} className="font-bold">{a.name}</Link><span className="d-muted">{a.kind}</span>
              </div>
              <RowX label={`Remove ${c.name} from ${a.name}`} disabled={busy} testid={`works-remove-${a.name}`}
                onClick={() => void call("contacts.detach", { contactId: id, kind: PARENT[a.kind], id: a.id })} />
            </div>
          ))}
          {at.length > 0 && <span className="s" data-testid="works-foot">× takes {c.name} off that place; they stay in Contacts.</span>}
        </DetailCard>
        <PickDialog open={linking} onClose={() => { setError(null); setLinking(false); }} title="Link a place" subtitle={`For ${c.name}`} testid="works-add"
          findLabel="Find it" placeholder="Name, kind or city" addLabel="Link" busy={busy} error={error} items={free}
          onPick={async (value) => !!(await link(value))} />
      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="Our notes" testid="notes-private">
          <InlineValue testid="contact-notes" label="Notes" kind="textarea" value={c.notes ?? ""} canEdit error={error}
            onSave={async (next) => !!(await call("contacts.update", { id, patch: { notes: next || null } }))} />
        </DetailCard>

        <DetailCard private title="House concerts hosted">
          <ShowLinks where={["hostContactIds", "array-contains", id]} empty="None." testid="hosted-shows" />
        </DetailCard>
      </CardGroup>
    </DetailPage>
  );
}
