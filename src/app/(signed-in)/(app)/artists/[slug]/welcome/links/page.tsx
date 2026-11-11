"use client";
import { useState } from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { ErrorBox, PageTitle, useCommand } from "@/components/ui";
import { useArtist } from "@/lib/artist";
import { artistPath } from "@/lib/routes";
import { withScheme } from "@/lib/links";
import { ARTIST_LINKS, SIGNAL_GROUP_PREFIX, normalizeInstagramUrl, normalizeSignalGroupUrl, type Artist, type ArtistLinkKey } from "@/schema";

const MAIN: readonly ArtistLinkKey[] = ["website", "spotify", "instagram", "bandsintown"];
const PLACEHOLDER: Partial<Record<ArtistLinkKey, string>> = { instagram: "@yourband", website: "https://", spotify: "https://open.spotify.com/artist/…", bandsintown: "https://bandsintown.com/…" };

export default function WelcomeLinksPage() { return <AdminOnly><LinksForm /></AdminOnly>; }

/** Optional links and the Signal group, saved together with one Save. Nothing is written (or remembered) until then. */
function LinksForm() {
  const artist = useArtist();
  const router = useRouter();
  const { call, error, busy, setError } = useCommand();
  const [values, setValues] = useState<Partial<Record<ArtistLinkKey, string>>>({});
  const [signal, setSignal] = useState("");
  const [more, setMore] = useState(false);
  const ready = artistPath(artist.slug, "/welcome");
  const set = (k: ArtistLinkKey, v: string) => { setValues((p) => ({ ...p, [k]: v })); setError(null); };
  const label = (k: ArtistLinkKey) => ARTIST_LINKS.find(([key]) => key === k)![1];
  const rest = ARTIST_LINKS.filter(([k]) => !MAIN.includes(k));

  const instagram = values.instagram?.trim() ? normalizeInstagramUrl(values.instagram) : null;
  const instagramBad = !!instagram && "error" in instagram;
  const sig = signal.trim() ? normalizeSignalGroupUrl(signal) : null;
  const signalBad = !!sig && "error" in sig;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (instagramBad || signalBad || !artist.doc) return;
    // links replaces the whole map, so keep what the band already has and add what was filled.
    const links: Artist["links"] = { ...(artist.doc.links ?? {}) };
    for (const [k] of ARTIST_LINKS) {
      const v = values[k]?.trim();
      if (!v) continue;
      links[k] = k === "instagram" ? (instagram && "url" in instagram ? instagram.url : v) : withScheme(v);
    }
    const patch: Record<string, unknown> = {};
    if (Object.keys(links).length) patch.links = links;
    if (sig && "url" in sig) patch.signalGroupUrl = sig.url;
    if (Object.keys(patch).length && !(await call("artists.update", { id: artist.doc.id, patch }))) return;
    router.push(ready);
  }

  const field = (k: ArtistLinkKey) => (
    <div className="grid gap-1.5" key={k}>
      <label htmlFor={`wl-${k}`} className="lbl">{label(k)}</label>
      <input id={`wl-${k}`} className="input" type="text" inputMode="url" value={values[k] ?? ""} placeholder={PLACEHOLDER[k] ?? "https://"}
        spellCheck={false} autoCapitalize="none" aria-invalid={k === "instagram" && instagramBad} data-testid={`wl-${k}`} onChange={(e) => set(k, e.target.value)} />
      {k === "instagram" && instagram && "error" in instagram && <span className="err" data-testid="wl-instagram-hint">{instagram.error}</span>}
    </div>
  );

  return (
    <form className="mx-auto grid max-w-xl gap-5" onSubmit={save} data-testid="welcome-links">
      <PageTitle title="Add your links" sub="Where people can find the band online. All optional." />
      <section className="card grid gap-4" aria-label="Links">
        {MAIN.map(field)}
        <button type="button" className="btn text" aria-expanded={more} onClick={() => setMore((m) => !m)} data-testid="wl-more">{more ? "Fewer links" : "More links"}</button>
        {more && <div className="grid gap-4" data-testid="wl-more-fields">{rest.map(([k]) => field(k))}</div>}
      </section>
      <section className="card grid gap-1.5" aria-label="Band chat">
        <label htmlFor="wl-signal" className="lbl">Signal group</label>
        <input id="wl-signal" className="input" type="text" inputMode="url" value={signal} placeholder={`${SIGNAL_GROUP_PREFIX}…`} spellCheck={false} autoCapitalize="none"
          aria-invalid={signalBad} data-testid="wl-signal" onChange={(e) => { setSignal(e.target.value); setError(null); }} />
        {sig && "error" in sig ? <span className="err" data-testid="wl-signal-hint">{sig.error}</span>
          : <span className="s">Only band members see this. In Signal: the group&apos;s settings, Group link, Share.</span>}
      </section>
      <ErrorBox error={error} />
      <div className="flex items-center justify-end gap-2">
        <NextLink href={ready} className="btn text" data-testid="wl-skip">Skip</NextLink>
        <button className="btn acc" disabled={busy || instagramBad || signalBad} data-testid="wl-save">Save</button>
      </div>
    </form>
  );
}
