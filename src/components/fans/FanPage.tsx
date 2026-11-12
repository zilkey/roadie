"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import Link, { useArtist, useArtistRouter } from "@/lib/artist";
import { ErrorBox, PageTitle } from "@/components/ui";
import { Icons } from "@/components/people/shared";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { useDragReorder } from "@/lib/drag-reorder";
import { useCollection } from "@/lib/firestore-hooks";
import { moved } from "@/components/shows/checklists/shared";
import { money, parsePrice } from "@/lib/merch";
import { fmtLong, publicShowName } from "@/lib/shows";
import { dateInBandZone } from "@/lib/timezone";
import { FanLink, MAX_LOGO_CHARS, paymentAppOf, type Artist, type FanPageStyle, type MerchItem } from "@/schema/artists";
import { FAN_PAGE_BUTTONS } from "@/schema/shows";
import { fanPreviewHref } from "@/components/shows/page/FanPageCard";
import type { Show } from "@/schema";
import { FansTab } from "./FansPage";

/** The Fan Page's tabs, in order: [?tab= value, label, admins only]. */
export const FAN_PAGE_TABS = [
  ["fans", "Fans", false], ["price", "Price list", true], ["links", "Links", true], ["donation", "Suggested donation", true],
  ["qr", "QR code", true], ["settings", "Settings", true],
] as const;
export type FanPageTab = (typeof FAN_PAGE_TABS)[number][0];

const newId = () => Math.random().toString(36).slice(2, 10);
const priceText = (cents: number) => money(cents).slice(1);

const Grip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);

/** One column of a ListEditor row: the text as typed, and whether it is good enough to save. */
interface Col { key: "a" | "b"; label: string; placeholder: string; className: string; prefix?: string; inputMode?: "decimal" | "url"; ok(v: string): boolean }
interface Line { id: string; a: string; b: string }

/**
 * A reorderable two-column list (the price list, the links): drag the grip, edit in place, delete with the bin. New lines need Add.
 * `onChange` gets every line; the caller decides whether it can be saved.
 */
function ListEditor({ testid, lines, cols, empty, onChange }: { testid: string; lines: Line[]; cols: [Col, Col]; empty: string; onChange(next: Line[]): void }) {
  const [fresh, setFresh] = useState<Line>({ id: "", a: "", b: "" });
  const dr = useDragReorder((from, to) => onChange(moved(lines, from, to)));
  const set = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const canAdd = cols.every((c) => c.ok(fresh[c.key]));
  const input = (c: Col, value: string, onValue: (v: string) => void, label: string, tid: string, bad = false) => (
    <span className={`flex items-center gap-1 ${c.className}`}>
      {c.prefix && <span className="text-muted">{c.prefix}</span>}
      <input className="input min-w-0 flex-1" aria-label={label} placeholder={c.placeholder} inputMode={c.inputMode} value={value} aria-invalid={bad || undefined}
        onChange={(e) => onValue(e.target.value)} data-testid={tid} />
    </span>
  );
  return (
    <div className="grid gap-2" data-testid={testid}>
      {lines.length ? (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {lines.map((l, i) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2" data-testid={`${testid}-item`} {...dr.row(i)}>
              <span className="flex w-6 shrink-0 cursor-grab select-none justify-center text-muted" {...dr.handle(i)} aria-hidden="true" data-testid={`${testid}-grip`}><Grip /></span>
              {cols.map((c) => input(c, l[c.key], (v) => set(i, { [c.key]: v }), `${c.label} of ${l.a || "item"}`, `${testid}-${c.key}`, !c.ok(l[c.key])))}
              <button type="button" className="icon-btn danger" aria-label={`Delete ${l.a}`} onClick={() => onChange(lines.filter((_, j) => j !== i))} data-testid={`${testid}-delete`}>{Icons.trash}</button>
            </li>
          ))}
        </ul>
      ) : <p className="s" data-testid={`${testid}-empty`}>{empty}</p>}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (canAdd) { onChange([...lines, { ...fresh, id: newId() }]); setFresh({ id: "", a: "", b: "" }); } }}>
        <span className="w-6 shrink-0" />
        {cols.map((c) => input(c, fresh[c.key], (v) => setFresh({ ...fresh, [c.key]: v }), `New ${c.label.toLowerCase()}`, `${testid}-new-${c.key}`))}
        <button type="submit" className="btn acc" disabled={!canAdd} data-testid={`${testid}-add`}>Add</button>
      </form>
    </div>
  );
}

/** The fan page's QR code with Copy, Download, Print and Copy link. */
function QrTab({ url, name }: { url: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => { if (canvas.current && url) void QRCode.toCanvas(canvas.current, url, { width: 480, margin: 2 }); }, [url]);
  const flash = (t: string) => { setNote(t); window.setTimeout(() => setNote(""), 2500); };
  async function copyImage() {
    const c = canvas.current;
    if (!c) return;
    try {
      const blob = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("QR code copied. Paste it into your flyer or doc.");
    } catch { flash("This browser can't copy images. Use Download instead."); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(url); flash("Link copied."); } catch { flash("Couldn't copy the link."); }
  }
  function print() {
    const img = canvas.current?.toDataURL("image/png");
    const w = window.open("", "_blank", "width=600,height=800");
    if (!img || !w) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
    w.document.write(`<!doctype html><title>${esc(name)}</title><style>body{font-family:system-ui,sans-serif;text-align:center;margin:40px}img{width:4in;height:4in}h1{font-size:32px;margin:0 0 8px;text-transform:uppercase}p{font-size:20px;margin:8px 0}</style>
<h1>${esc(name)}</h1><p>Scan to join the list &amp; buy merch</p><img src="${img}" alt=""><p style="font-size:14px;color:#555">${esc(url)}</p>
<script>window.onload=()=>{window.print()}</script>`);
    w.document.close();
  }
  return (
    <section className="card" data-testid="merch-qr">
      <p className="s">Scanning it opens the fan page. Put it on the merch table.</p>
      <div className="flex flex-wrap items-start gap-4">
        <canvas ref={canvas} className="h-44 w-44 rounded-lg border border-divider bg-white" aria-label={`QR code for ${url}`} data-testid="merch-qr-canvas" />
        <div className="grid min-w-0 gap-2">
          <a className="link break-all text-sm" href={url} target="_blank" rel="noopener noreferrer" data-testid="merch-fan-url">{url}</a>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn acc" onClick={() => void copyImage()} data-testid="merch-qr-copy">Copy QR code</button>
            <a className="btn outline" href="#" download="fan-page-qr.png"
              onClick={(e) => { const c = canvas.current; if (c) e.currentTarget.href = c.toDataURL("image/png"); }} data-testid="merch-qr-download">Download</a>
            <button type="button" className="btn outline" onClick={print} data-testid="merch-qr-print">Print</button>
            <button type="button" className="btn outline" onClick={() => void copyLink()} data-testid="merch-link-copy">Copy link</button>
          </div>
          {note && <span className="s" role="status" data-testid="merch-qr-note">{note}</span>}
        </div>
      </div>
    </section>
  );
}

/**
 * An uploaded image as a data URL small enough for the artist document: drawn at most 800px wide (then 600, 400, 300) as WebP
 * (PNG where the browser can't make WebP), keeping transparency. Null when the file isn't an image or no size fits.
 */
async function shrinkImage(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    for (const max of [800, 600, 400, 300]) {
      const scale = Math.min(1, max / img.naturalWidth, max / img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL("image/webp", 0.88);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
      if (out.length <= MAX_LOGO_CHARS) return out;
    }
    return null;
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

/** Accent swatches offered on the Settings tab, besides any color picked by hand. */
const SWATCHES = ["#5561e8", "#e8590c", "#d6336c", "#2f9e44", "#f0b400", "#111111"];

/** The Fan Page (/fans): Fans for everyone; for admins also the price list, links, suggested donation, QR code and settings of /f/{slug}. */
export function FanPage() {
  const ctx = useArtist();
  const artist = ctx.doc ?? undefined;
  const admin = ctx.role === "admin";
  const router = useArtistRouter();
  const asked = useSearchParams().get("tab");
  const tabs = FAN_PAGE_TABS.filter(([, , adminOnly]) => admin || !adminOnly);
  const tab: FanPageTab = tabs.find(([k]) => k === asked)?.[0] ?? "fans";

  // Everything but the Fans tab is one autosaving edit of the artist.
  const [items, setItems] = useState<Line[]>([]);
  const [links, setLinks] = useState<Line[]>([]);
  const [publicName, setPublicName] = useState("");
  const [style, setStyle] = useState<FanPageStyle>({});
  const [logo, setLogo] = useState<string | null>(null);
  const [logoError, setLogoError] = useState("");
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const resetFrom = (a: Artist) => {
    setItems((a.merchItems ?? []).map((i) => ({ id: i.id, a: i.name, b: priceText(i.priceCents) })));
    setLinks((a.fanLinks ?? []).map((l) => ({ id: l.id, a: l.name, b: l.url })));
    setPublicName(a.publicName ?? ""); setStyle(a.fanPageStyle ?? {}); setLogo(a.logo?.dataUrl ?? null);
  };
  const as = useAutosave({ command: "artists.update", id: admin ? artist?.id ?? "" : "", rev: artist?.rev, scope: "fan-page", title: "Fan Page", onUseTheirs: () => artist && resetFrom(artist) });
  const liveKey = JSON.stringify(artist ? [artist.merchItems, artist.fanLinks, artist.publicName, artist.fanPageStyle, artist.logo?.dataUrl.length] : null);
  useEffect(() => { if (artist && !as.isBusy()) resetFrom(artist); }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const shows = useCollection<Show>("shows", { where: [["artistId", "==", ctx.artistId]], skip: !admin });
  /** Upcoming shows with their fan page line on (the Fan Page card on each show), soonest first. */
  const onPage = useMemo(() => {
    const today = dateInBandZone();
    return (shows.rows ?? []).filter((s) => s.fanPage?.on && s.date >= today && s.status !== "canceled" && s.status !== "dropped").sort((a, b) => a.date.localeCompare(b.date));
  }, [shows.rows]);

  if (!artist) return null;
  const venmo = artist.paymentUrl ? paymentAppOf(artist.paymentUrl) : null;
  const fanUrl = origin ? `${origin}/f/${artist.slug}` : "";
  const general = <Link href="/admin/artist" className="link">General Settings</Link>;

  function editItems(next: Line[]) {
    setItems(next);
    const out: MerchItem[] = [];
    for (const l of next) {
      const cents = parsePrice(l.b);
      if (!l.a.trim()) return as.hold("each item needs a name (or delete it)");
      if (cents === null) return as.hold(`the price of ${l.a.trim()} needs to be a dollar amount like 25 or 4.50`);
      out.push({ id: l.id, name: l.a.trim(), priceCents: cents });
    }
    as.patch({ merchItems: out });
  }
  function editLinks(next: Line[]) {
    setLinks(next);
    const out = next.map((l) => ({ id: l.id, name: l.a.trim(), url: l.b.trim() }));
    const bad = out.find((l) => !FanLink.safeParse(l).success);
    if (bad) return as.hold(bad.name ? `the link ${bad.name} needs a full web address (https://...)` : "each link needs a name (or delete it)");
    as.patch({ fanLinks: out });
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setLogoError("");
    const dataUrl = await shrinkImage(file);
    if (!dataUrl) return setLogoError("Couldn't use that file. Try a PNG or JPEG image.");
    setLogo(dataUrl); as.patch({ logo: { dataUrl } });
  }
  function editStyle(next: FanPageStyle) { setStyle(next); as.patch({ fanPageStyle: next }); }

  const priceCols: [Col, Col] = [
    { key: "a", label: "Name", placeholder: "New item, like T-Shirt", className: "min-w-40 flex-1", ok: (v) => !!v.trim() },
    { key: "b", label: "Price", placeholder: "25", prefix: "$", className: "w-28", inputMode: "decimal", ok: (v) => parsePrice(v) !== null },
  ];
  const linkCols: [Col, Col] = [
    { key: "a", label: "Name", placeholder: "Link name, like New single", className: "min-w-40 flex-1", ok: (v) => !!v.trim() },
    { key: "b", label: "URL", placeholder: "https://...", className: "min-w-56 flex-[2]", inputMode: "url", ok: (v) => FanLink.shape.url.safeParse(v.trim()).success },
  ];

  return (
    <div className="grid gap-5" data-testid="fan-page" onBlur={() => admin && void as.flush()}>
      <PageTitle title="Fan Page" sub="The page fans open from the QR code: the email list, merch and links." actions={(
        <>
          {admin && tab !== "fans" && <SaveStatus {...as.statusProps} />}
          <a className="btn outline" href={`/f/${artist.slug}`} target="_blank" rel="noopener noreferrer" data-testid="fan-page-preview">Preview fan page</a>
        </>
      )} />
      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Fan Page" data-testid="fan-page-tabs">
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={k === tab} data-testid={`fan-page-tab-${k}`}
              onClick={() => router.replace(`/fans?tab=${k}`, { scroll: false })}>{label}</button>
          ))}
        </div>
      )}
      {tab !== "fans" && <ErrorBox error={as.error ?? null} />}

      {tab === "fans" && <FansTab />}

      {tab === "price" && (
        <section className="card" data-testid="merch-price-list">
          <p className="s">Drag to reorder. Fans tap + and − and Venmo opens with the total and what they picked.</p>
          {!artist.features?.merch && <p className="s" data-testid="merch-off">Merch is off, so the fan page hides this list. Turn it on in {general}.</p>}
          {!venmo && <p className="s" data-testid="merch-no-venmo">Add your Venmo link (Payment app) in {general} so the list gets a Pay button.</p>}
          <ListEditor testid="merch-item" lines={items} cols={priceCols} empty="No items yet." onChange={editItems} />
        </section>
      )}

      {tab === "links" && (
        <section className="card" data-testid="fan-links">
          <p className="s">Buttons under merch on the fan page, in this order. Your Instagram, Spotify, website and other links from {general} always sit at the bottom.</p>
          <ListEditor testid="fan-link" lines={links} cols={linkCols} empty="No links yet." onChange={editLinks} />
        </section>
      )}

      {tab === "donation" && (
        <section className="card" data-testid="fan-donation">
          <p className="s">Shows with “Show on Fan Page” checked, from today on. Each one appears on the fan page 1 hour before the show and 3 hours after, with + and − and a Venmo button. Set it up in the Fan Page section of the show&apos;s Promotion tab.</p>
          {!venmo && <p className="s" data-testid="donation-no-venmo">Add your Venmo link (Payment app) in {general}: the fan page needs it to show these.</p>}
          {shows.rows === null ? null : onPage.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {onPage.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="donation-show" data-show-id={s.id}>
                  <span className="grid min-w-0">
                    <Link href={`/shows/${s.id}?tab=promotion`} className="link font-semibold" data-testid="donation-show-link">{s.fanPage?.name?.trim() || publicShowName(s)}</Link>
                    <span className="s">{fmtLong(s.date)} · {s.fanPage?.amountCents ? money(s.fanPage.amountCents) : "No amount yet"} · {FAN_PAGE_BUTTONS[s.fanPage?.button ?? "ticket"]}</span>
                  </span>
                  {s.fanPage?.amountCents
                    ? <a className="btn outline sm" href={fanPreviewHref(artist.slug, s.id)} target="_blank" rel="noopener noreferrer" data-testid="donation-show-preview">Preview</a>
                    : <span className="s">Add an amount to show it</span>}
                </li>
              ))}
            </ul>
          ) : <p className="s" data-testid="donation-none">No upcoming shows are on the fan page.</p>}
        </section>
      )}

      {tab === "qr" && <QrTab url={fanUrl} name={publicName.trim() || artist.name} />}

      {tab === "settings" && (
        <section className="card" data-testid="merch-style">
          {!artist.features?.fans && <p className="s" data-testid="fans-page-off">The fan page is off, so its link shows “Not found”. Turn on Fans in {general}.</p>}
          <div className="grid gap-1"><span className="lbl">Logo</span>
            <span className="s">Shown instead of the name at the top of the page.</span>
            {logo && <img src={logo} alt="Logo" className="max-h-28 w-fit max-w-full rounded-lg border border-divider bg-[var(--surface)] object-contain p-2" data-testid="logo-preview" />}
            <div className="flex flex-wrap gap-2">
              <label className="btn outline cursor-pointer">{logo ? "Replace logo" : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="sr-only" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} data-testid="logo-upload" /></label>
              {logo && <button type="button" className="btn text" onClick={() => { setLogo(null); as.patch({ logo: null }); }} data-testid="logo-remove">Remove logo</button>}
            </div>
            {logoError && <span className="err" data-testid="logo-error">{logoError}</span>}
          </div>
          <label className="grid gap-1"><span className="lbl">Name on the page</span>
            <input className="input" value={publicName} placeholder={artist.name} onChange={(e) => { setPublicName(e.target.value); as.patch({ publicName: e.target.value.trim() || null }); }} data-testid="merch-public-name" />
            <span className="s">{logo ? "With a logo, this is its alt text." : "Leave blank to use the artist name."}</span>
          </label>
          <div className="grid gap-1"><span className="lbl">Light or dark</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Light or dark">
              {(["auto", "light", "dark"] as const).map((t) => (
                <button key={t} type="button" className="pick" aria-pressed={(style.theme ?? "auto") === t} onClick={() => editStyle({ ...style, theme: t })} data-testid={`merch-theme-${t}`}>
                  {t === "auto" ? "Match the phone" : t === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1"><span className="lbl">Button color</span>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Button color">
              <button type="button" className="pick" aria-pressed={!style.accent} onClick={() => { const { accent: _, ...rest } = style; editStyle(rest); }} data-testid="merch-accent-default">Roadie blue</button>
              {SWATCHES.map((c) => (
                <button key={c} type="button" className="h-9 w-9 rounded-full border-2" style={{ background: c, borderColor: style.accent === c ? "var(--ink)" : "var(--border)" }}
                  aria-label={`Color ${c}`} aria-pressed={style.accent === c} onClick={() => editStyle({ ...style, accent: c })} data-testid="merch-accent-swatch" />
              ))}
              <label className="flex items-center gap-2 text-sm">Other
                <input type="color" value={style.accent ?? "#5561e8"} onChange={(e) => editStyle({ ...style, accent: e.target.value })} data-testid="merch-accent-custom" /></label>
            </div>
          </div>
          <p className="s">Merch and donations are paid on Venmo{venmo ? <> to @{venmo.handle}</> : null}: Roadie doesn&apos;t see or record them yet.</p>
        </section>
      )}
    </div>
  );
}
