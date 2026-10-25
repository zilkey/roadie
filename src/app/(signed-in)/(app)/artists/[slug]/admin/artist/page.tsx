"use client";
import { useEffect, useState } from "react";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, Select, useCommand } from "@/components/ui";
import { Icons } from "@/components/people/shared";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { useRouter } from "next/navigation";
import { useArtist } from "@/lib/artist";
import { artistPath } from "@/lib/routes";
import { withScheme } from "@/lib/links";
import { ChecklistTemplatesEditor } from "@/components/shows/checklists/ChecklistTemplatesEditor";
import { ARTIST_LINKS, DEFAULT_LIST_WORDING, SIGNAL_GROUP_PREFIX, artistSlug, normalizePaymentUrl, normalizeSignalGroupUrl, type Artist, type ArtistLinkKey } from "@/schema";

type Links = Artist["links"];


export default function ArtistPage() { return <AdminOnly><ArtistEditor /></AdminOnly>; }

/**
 * Name and web address (/artists/{slug}) in one card: read-only until Edit, then saved together with Save.
 * Not autosaved: changing the address breaks old links, and the page you're on moves with it.
 */
function ArtistCard({ artist }: { artist: Artist }) {
  const router = useRouter();
  const { call, error, busy, setError } = useCommand();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(artist.name);
  const [slug, setSlug] = useState(artist.slug);
  const check = artistSlug.safeParse(slug);
  const hint = slug && !check.success ? check.error.issues[0]?.message : null;
  const changed = name.trim() !== artist.name || slug !== artist.slug;
  function open() { setName(artist.name); setSlug(artist.slug); setError(null); setEditing(true); }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Artist name is required");
    if (!check.success) return setError(hint ?? "Not a valid URL name");
    if (!changed) return setEditing(false);
    const patch: { name?: string; slug?: string } = {};
    if (name.trim() !== artist.name) patch.name = name.trim();
    if (slug !== artist.slug) patch.slug = slug;
    if (!(await call("artists.update", { id: artist.id, patch }))) return;
    setEditing(false);
    if (patch.slug) router.replace(artistPath(patch.slug, "/admin/artist"));
  }
  return (
    <section className={`card${editing ? " editing" : ""}`} data-testid="artist-card" aria-labelledby="artist-card-title">
      <div className="card-head">
        <h2 id="artist-card-title">Name and web address</h2>
        {editing ? <span className="tag">Editing</span>
          : <button type="button" className="card-edit" onClick={open} data-testid="artist-edit">Edit</button>}
      </div>
      {editing ? (
        <form className="grid gap-4" onSubmit={save} data-testid="artist-form">
          <div className="grid gap-1.5">
            <label htmlFor="artist-name" className="lbl">Artist name</label>
            <input id="artist-name" className="input" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} data-testid="artist-name" autoFocus />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="artist-slug" className="lbl">Web address</label>
            <div className="flex items-center gap-2">
              <span className="s">/artists/</span>
              <input id="artist-slug" className="input !w-auto flex-1" value={slug} onChange={(e) => { setSlug(e.target.value.trim().toLowerCase()); setError(null); }}
                aria-invalid={!!hint} data-testid="artist-slug" spellCheck={false} autoCapitalize="none" />
            </div>
            {hint ? <span className="err" data-testid="artist-slug-hint">{hint}</span> : <span className="s">Lowercase letters, numbers and hyphens. Links with the old address stop working.</span>}
          </div>
          <ErrorBox error={error} />
          <div className="card-foot"><div className="end">
            <button type="button" className="btn text" onClick={() => { setEditing(false); setError(null); }} data-testid="artist-cancel">Cancel</button>
            <button className="btn acc" disabled={busy || !name.trim() || !check.success || !changed} data-testid="artist-save">Save</button>
          </div></div>
        </form>
      ) : (
        <dl className="grid gap-3 m-0">
          <div className="grid gap-0.5"><dt className="lbl">Artist name</dt><dd className="m-0" data-testid="artist-name-value">{artist.name}</dd></div>
          <div className="grid gap-0.5"><dt className="lbl">Web address</dt><dd className="m-0" data-testid="artist-slug-value"><span className="s">/artists/</span>{artist.slug}</dd></div>
        </dl>
      )}
    </section>
  );
}

/** Spotify, Instagram and the rest: one row per platform the artist has, editable in place (autosaved), with an Add row for the others. */
function LinksCard({ links, onChange }: { links: Links; onChange: (next: Links) => void }) {
  const [kind, setKind] = useState<ArtistLinkKey | "">("");
  const [url, setUrl] = useState("");
  const have = ARTIST_LINKS.filter(([k]) => links[k] !== undefined);
  const free = ARTIST_LINKS.filter(([k]) => links[k] === undefined);
  const without = (k: ArtistLinkKey) => { const next = { ...links }; delete next[k]; return next; };
  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!kind || !url.trim()) return;
    onChange({ ...links, [kind]: withScheme(url.trim()) });
    setKind(""); setUrl("");
  }
  return (
    <section className="card" data-testid="links" aria-labelledby="links-title">
      <div><h2 id="links-title" className="text-lg font-bold">Links</h2><p className="s">Where people can find the band online.</p></div>
      {have.length === 0 ? <p className="s" data-testid="links-empty">No links yet.</p> : (
        <ul className="link-list">{have.map(([k, label]) => (
          <li key={k} data-testid={`link-${k}`}>
            <label htmlFor={`link-${k}-url`}>{label}</label>
            <input id={`link-${k}-url`} className="input" type="url" value={links[k]} spellCheck={false} autoCapitalize="none" data-testid={`link-${k}-url`}
              onChange={(e) => onChange({ ...links, [k]: e.target.value })}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== links[k]) onChange({ ...links, [k]: withScheme(v) }); }} />
            <button type="button" className="icon-btn danger" aria-label={`Delete ${label} link`} data-testid={`link-${k}-delete`} onClick={() => onChange(without(k))}>{Icons.trash}</button>
          </li>
        ))}</ul>
      )}
      {free.length > 0 && (
        <form className="link-add" onSubmit={add} noValidate data-testid="link-add">
          <Select<ArtistLinkKey> value={kind} options={free} onChange={setKind} placeholder="Add a link…" label="Platform" testid="link-add-kind" />
          <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label="URL" spellCheck={false} autoCapitalize="none" data-testid="link-add-url" />
          <button className="btn acc" disabled={!kind || !url.trim()} data-testid="link-add-save">Add</button>
        </form>
      )}
    </section>
  );
}

/** The band's Signal group (Who's free can post there). Not a link: it's private, so it has its own card. Autosaved; empty or Delete removes it. */
function BandChatCard({ url, onChange }: { url: string; onChange: (next: string) => void }) {
  const r = url.trim() ? normalizeSignalGroupUrl(url) : null;
  const bad = !!r && "error" in r;
  return (
    <section className="card" data-testid="band-chat" aria-labelledby="band-chat-title">
      <div><h2 id="band-chat-title" className="text-lg font-bold">Band chat</h2><p className="s">Only band members can see this. Anyone with the link can join the group.</p></div>
      <ul className="link-list"><li>
        <label htmlFor="signal-group-url">Signal group</label>
        <input id="signal-group-url" className="input" type="text" inputMode="url" value={url} placeholder={`${SIGNAL_GROUP_PREFIX}…`} spellCheck={false} autoCapitalize="none"
          aria-invalid={bad} data-testid="signal-group-url" onChange={(e) => onChange(e.target.value)} />
        {url && <button type="button" className="icon-btn danger" aria-label="Delete Signal group link" data-testid="signal-group-delete" onClick={() => onChange("")}>{Icons.trash}</button>}
      </li></ul>
      {r && "error" in r ? <span className="err" data-testid="signal-group-hint">{r.error}</span>
        : <span className="s">In Signal: the group&apos;s settings, Group link, Share.</span>}
    </section>
  );
}

/** Fans and Merch on/off, the payment app link and the list page's opt-in wording. All autosaved; an empty field removes the setting. */
function FansMerchCard({ features, payment, wording, onFeature, onPayment, onWording }: {
  features: NonNullable<Artist["features"]>; payment: string; wording: string;
  onFeature: (k: "fans" | "merch", on: boolean) => void; onPayment: (next: string) => void; onWording: (next: string) => void;
}) {
  const r = payment.trim() ? normalizePaymentUrl(payment) : null;
  const bad = !!r && "error" in r;
  return (
    <section className="card" data-testid="fans-merch-card" aria-labelledby="fans-merch-title">
      <div><h2 id="fans-merch-title" className="text-lg font-bold">Fans &amp; merch</h2><p className="s">Turn on the fan list and the merch table. Off hides their pages and menu items.</p></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!features.fans} onChange={(e) => onFeature("fans", e.target.checked)} data-testid="feature-fans" />Fans (the email list)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!features.merch} onChange={(e) => onFeature("merch", e.target.checked)} data-testid="feature-merch" />Merch</label>
      <ul className="link-list"><li>
        <label htmlFor="payment-url">Payment app</label>
        <input id="payment-url" className="input" type="text" inputMode="url" value={payment} placeholder="https://venmo.com/u/yourname" spellCheck={false} autoCapitalize="none"
          aria-invalid={bad} data-testid="payment-url" onChange={(e) => onPayment(e.target.value)} />
        {payment && <button type="button" className="icon-btn danger" aria-label="Delete payment link" data-testid="payment-url-delete" onClick={() => onPayment("")}>{Icons.trash}</button>}
      </li></ul>
      {r && "error" in r ? <span className="err" data-testid="payment-url-hint">{r.error}</span>
        : <span className="s">Where fans pay for merch. Venmo for now; only band members see this.</span>}
      <label className="grid gap-1"><span className="lbl">List page wording</span>
        <textarea className="input" rows={3} value={wording} placeholder={DEFAULT_LIST_WORDING} data-testid="list-wording" onChange={(e) => onWording(e.target.value)} />
      </label>
      <span className="s">Shown under the Join button, and saved with each signup.</span>
    </section>
  );
}

function ArtistEditor() {
  const { error } = useCommand();
  const artist = useArtist().doc ?? undefined;
  const [links, setLinks] = useState<Links>({});
  const [signal, setSignal] = useState("");
  const [features, setFeatures] = useState<NonNullable<Artist["features"]>>({});
  const [payment, setPayment] = useState("");
  const [wording, setWording] = useState("");
  const resetFrom = (a: Artist) => { setLinks(a.links ?? {}); setSignal(a.signalGroupUrl ?? ""); setFeatures(a.features ?? {}); setPayment(a.paymentUrl ?? ""); setWording(a.listWording ?? ""); };
  const as = useAutosave({ command: "artists.update", id: artist?.id ?? "", rev: artist?.rev, scope: "general", title: artist?.name, onUseTheirs: () => artist && resetFrom(artist) });

  // Follow the live document (someone else's edit, an Undo, the ids the server gave) whenever nothing of ours is waiting to be saved.
  const liveKey = JSON.stringify(artist ? [artist.links, artist.signalGroupUrl, artist.paymentUrl, artist.listWording, artist.features] : null);
  useEffect(() => { if (artist && !as.isBusy()) resetFrom(artist); }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!artist) return <p className="s">Loading…</p>;

  function editLinks(next: Links) {
    setLinks(next);
    if (Object.values(next).some((v) => !v?.trim())) return as.hold("each link needs a URL (or delete it)");
    as.patch({ links: next });
  }
  function editSignal(next: string) {
    setSignal(next);
    // Stored in one form however it was pasted (sgnl://, no https, stray spaces); the field shows the stored form once saved.
    const r = next.trim() ? normalizeSignalGroupUrl(next) : null;
    if (r && "error" in r) return as.hold("the Signal group needs its signal.group invite link (or delete it)");
    as.patch({ signalGroupUrl: r?.url ?? null });
  }
  function editPayment(next: string) {
    setPayment(next);
    const r = next.trim() ? normalizePaymentUrl(next) : null;
    if (r && "error" in r) return as.hold("the payment app needs a Venmo link (or delete it)");
    as.patch({ paymentUrl: r?.url ?? null });
  }
  function editWording(next: string) { setWording(next); as.patch({ listWording: next.trim() || null }); }
  function editFeature(k: "fans" | "merch", on: boolean) { const next = { ...features, [k]: on }; setFeatures(next); as.patch({ features: next }); }
  return (
    <div className="grid gap-5" onBlur={() => void as.flush()}>
      <PageTitle title="General Settings" sub="The band's name, web address and links." actions={<SaveStatus {...as.statusProps} />} />
      <ErrorBox error={error} />
      <ArtistCard artist={artist} />
      <LinksCard links={links} onChange={editLinks} />
      <BandChatCard url={signal} onChange={editSignal} />
      <FansMerchCard features={features} payment={payment} wording={wording} onFeature={editFeature} onPayment={editPayment} onWording={editWording} />
      <ChecklistTemplatesEditor artistId={artist.id} />
    </div>
  );
}
