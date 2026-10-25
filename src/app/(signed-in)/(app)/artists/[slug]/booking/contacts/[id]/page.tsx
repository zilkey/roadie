"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { useParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, useCommand } from "@/components/ui";
import { Menu } from "@/components/Menu";
import { useDoc } from "@/lib/firestore-hooks";
import { BackLink, CopyButton, EntityForm, contactForm, hrefFor, useBooking, useNotFound, type Values } from "@/components/booking/common";
import { CardGroup, DetailCard, DetailPage, KV, SHARED_WARN, useSingleEdit } from "@/components/booking/DetailCards";
import { ShowLinks } from "@/components/shows/common";
import type { Contact } from "@/schema";

export default function Page() { return <AdminOnly><ContactPage /></AdminOnly>; }

type Parent = "venues" | "promoters" | "festivals";
const PARENT: Record<"venue" | "promoter" | "festival", Parent> = { venue: "venues", promoter: "promoters", festival: "festivals" };
const PARENT_LABEL: Record<Parent, string> = { venues: "Venues", promoters: "Promoters", festivals: "Festivals" };

// Each card autosaves its own fields, so each form builds only its own keys: a key left out would be cleared on the server.
/** Contact info: everything but the notes (the notes card saves those). */
const infoForm = {
  fields: contactForm.fields.filter((f) => f.key !== "notes"),
  build: (v: Values) => Object.fromEntries(Object.entries(contactForm.build(v)).filter(([k]) => k !== "notes")),
};
/** Notes: the contact's shared notes only. */
const notesForm = {
  fields: contactForm.fields.filter((f) => f.key === "notes"),
  initial: (d: Contact): Values => ({ notes: d.notes ?? "" }),
  build: (v: Values) => ({ notes: v.notes?.trim() || undefined }),
};

function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: c, loading } = useDoc<Contact>("contacts", id);
  const b = useBooking();
  const { call, error, busy } = useCommand();
  const edit = useSingleEdit<"info" | "works" | "notes">();
  const nf = useNotFound(loading, c, "contact");
  if (nf || !c) return nf;
  const at = [
    ...b.venues.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "venue" as const, id: x.id, name: x.name })),
    ...b.promoters.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "promoter" as const, id: x.id, name: x.name })),
    ...b.festivals.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "festival" as const, id: x.id, name: x.name })),
  ];
  // Things this contact is not linked to yet, for the "Works with" picker.
  const free: Record<Parent, { id: string; name: string }[]> = {
    venues: b.venues.filter((x) => !x.contactIds.includes(id)).sort((x, y) => x.name.localeCompare(y.name)),
    promoters: b.promoters.filter((x) => !x.contactIds.includes(id)).sort((x, y) => x.name.localeCompare(y.name)),
    festivals: b.festivals.filter((x) => !x.contactIds.includes(id)).sort((x, y) => x.name.localeCompare(y.name)),
  };
  const archive = async () => { if (confirm(`Archive ${c.name}?`) && (await call("contacts.remove", { id }))) router.replace("/booking"); };
  const link = async (value: string) => {
    const [kind, parentId] = value.split(":");
    if (kind && parentId) await call("contacts.attach", { contactId: id, kind, id: parentId });
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
    <DetailPage testid="contact-page" back={<BackLink href="/booking/contacts" label="All contacts" />} title={c.name} meta={c.title}
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

        <DetailCard title="Works with" editKey="works" edit={edit} editTestid="works-edit"
          editChildren={
            <div className="grid gap-3">
              {at.map((a) => (
                <div key={a.kind + a.id} className="d-row">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2"><b>{a.name}</b><span className="d-muted">{a.kind}</span></div>
                  <button type="button" className="btn danger sm" disabled={busy}
                    onClick={() => call("contacts.detach", { contactId: id, kind: PARENT[a.kind], id: a.id })}>Remove</button>
                </div>
              ))}
              <label className="grid gap-1">
                <span className="lbl">Add a venue, festival or promoter</span>
                <select className="select" value="" disabled={busy} data-testid="works-link" onChange={(e) => void link(e.target.value)}>
                  <option value="">Choose…</option>
                  {(Object.keys(free) as Parent[]).map((k) => free[k].length > 0 && (
                    <optgroup key={k} label={PARENT_LABEL[k]}>
                      {free[k].map((x) => <option key={x.id} value={`${k}:${x.id}`}>{x.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
          }>
          {at.length === 0 ? <div className="empty"><span>Not linked to anything yet.</span></div> : at.map((a) => (
            <Link key={a.kind + a.id} href={hrefFor(a.kind, a.id)} className="d-row">
              <b>{a.name}</b><span className="d-muted">{a.kind}</span>
            </Link>
          ))}
        </DetailCard>

        <DetailCard title="Notes" editKey="notes" edit={edit} warn={SHARED_WARN} editTestid="notes-edit"
          editChildren={
            <div>
              <EntityForm testid="contact-notes" fields={notesForm.fields} initial={notesForm.initial(c)} build={notesForm.build}
                autosave={{ command: "contacts.update", id, rev: c.rev, title: c.name }} />
            </div>
          }>
          {c.notes ? <div className="whitespace-pre-wrap">{c.notes}</div> : <span className="d-muted">—</span>}
        </DetailCard>
      </CardGroup>

      <CardGroup kind="private">
        <DetailCard private title="House concerts hosted">
          <ShowLinks where={["hostContactIds", "array-contains", id]} empty="None." testid="hosted-shows" />
        </DetailCard>
      </CardGroup>
    </DetailPage>
  );
}
