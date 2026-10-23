"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useDoc } from "@/lib/firestore-hooks";
import { BackLink, CopyButton, EntityForm, contactForm, hrefFor, useBooking, useNotFound } from "@/components/booking/common";
import type { Contact } from "@/schema";

export default function Page() { return <AdminOnly><ContactPage /></AdminOnly>; }

function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doc: c, loading } = useDoc<Contact>("contacts", id);
  const b = useBooking();
  const { call, error } = useCommand();
  const [edit, setEdit] = useState(false);
  const nf = useNotFound(loading, c, "contact");
  if (nf || !c) return nf;
  const at = [
    ...b.venues.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "venue" as const, id: x.id, name: x.name })),
    ...b.promoters.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "promoter" as const, id: x.id, name: x.name })),
    ...b.festivals.filter((x) => x.contactIds.includes(id)).map((x) => ({ kind: "festival" as const, id: x.id, name: x.name })),
  ];
  return (
    <div className="grid gap-3" data-testid="contact-page">
      <BackLink href="/booking" label="Booking" />
      <PageTitle title={c.name} sub={c.title} />
      <ErrorBox error={error} />
      <div className="card">
        {c.emails.map((e) => <div key={e} className="flex items-center justify-between gap-2"><span className="font-mono text-sm break-all">{e}</span><CopyButton text={e} /></div>)}
        {c.phones.map((p) => <span key={p} className="font-mono text-sm">{p}</span>)}
        {c.instagram && <a className="underline" href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noreferrer">@{c.instagram}</a>}
        {c.notes && <span className="s">{c.notes}</span>}
      </div>
      <button className="btn ghost justify-self-start" onClick={() => setEdit(!edit)} data-testid="edit-toggle">{edit ? "Done" : "Edit"}</button>
      {edit && (
        <EntityForm testid="contact-edit" fields={contactForm.fields} initial={contactForm.initial(c)} build={contactForm.build}
          autosave={{ command: "contacts.update", id, rev: c.rev, title: c.name }} />
      )}
      <span className="lbl">Works with</span>
      {at.length === 0 ? <span className="s">Not linked to anything yet.</span> : at.map((a) => (
        <Link key={a.kind + a.id} href={hrefFor(a.kind, a.id)} className="card"><b>{a.name}</b><span className="s">{a.kind}</span></Link>
      ))}
      <button className="btn ghost sm justify-self-start" onClick={async () => { if (confirm(`Archive ${c.name}?`) && (await call("contacts.remove", { id }))) router.replace("/booking"); }}>Archive contact</button>
    </div>
  );
}
