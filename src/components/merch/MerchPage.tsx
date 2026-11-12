"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Link, { useArtist } from "@/lib/artist";
import { ErrorBox, PageTitle } from "@/components/ui";
import { Icons } from "@/components/people/shared";
import { SaveStatus } from "@/components/SaveStatus";
import { useAutosave } from "@/lib/autosave";
import { useDragReorder } from "@/lib/drag-reorder";
import { moved } from "@/components/shows/checklists/shared";
import { money, parsePrice } from "@/lib/merch";
import { paymentAppOf, type Artist, type FanPageStyle, type MerchItem } from "@/schema/artists";

/** A price list row being edited: the price as typed, so "4." doesn't jump back. */
interface Row { id: string; name: string; price: string }
const priceText = (cents: number) => money(cents).slice(1);
const rowsOf = (items: readonly MerchItem[] | undefined): Row[] => (items ?? []).map((i) => ({ id: i.id, name: i.name, price: priceText(i.priceCents) }));
const newId = () => Math.random().toString(36).slice(2, 10);

/** Accent swatches offered on the Style card, besides any color picked by hand. */
const SWATCHES = ["#5561e8", "#e8590c", "#d6336c", "#2f9e44", "#f0b400", "#111111"];

const Grip = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);

/** The fan page's QR code with Copy, Download and Print. */
function QrCard({ url, name }: { url: string; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => { if (canvas.current) void QRCode.toCanvas(canvas.current, url, { width: 480, margin: 2 }); }, [url]);
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
    <section className="card" aria-labelledby="qr-title" data-testid="merch-qr">
      <div><h2 id="qr-title" className="text-lg font-bold">QR code</h2><p className="s">Scanning it opens the fan page. Put it on the merch table.</p></div>
      <div className="flex flex-wrap items-start gap-4">
        <canvas ref={canvas} className="h-44 w-44 rounded-lg border border-divider bg-white" aria-label={`QR code for ${url}`} data-testid="merch-qr-canvas" />
        <div className="grid min-w-0 gap-2">
          <a className="link break-all text-sm" href={url} target="_blank" rel="noopener noreferrer" data-testid="merch-fan-url">{url}</a>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn acc" onClick={() => void copyImage()} data-testid="merch-qr-copy">Copy QR code</button>
            <a className="btn outline" href={canvas.current?.toDataURL("image/png") ?? "#"} download="fan-page-qr.png"
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

/** Merch (#34, first cut): the price list on the fan page, the page's name and look, its preview link and QR code. Admins only. */
export function MerchPage() {
  const ctx = useArtist();
  const artist = ctx.doc ?? undefined;
  const [rows, setRows] = useState<Row[]>([]);
  const [publicName, setPublicName] = useState("");
  const [style, setStyle] = useState<FanPageStyle>({});
  const [fresh, setFresh] = useState({ name: "", price: "" });
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const resetFrom = (a: Artist) => { setRows(rowsOf(a.merchItems)); setPublicName(a.publicName ?? ""); setStyle(a.fanPageStyle ?? {}); };
  const as = useAutosave({ command: "artists.update", id: artist?.id ?? "", rev: artist?.rev, scope: "merch", title: "Merch", onUseTheirs: () => artist && resetFrom(artist) });
  const liveKey = JSON.stringify(artist ? [artist.merchItems, artist.publicName, artist.fanPageStyle] : null);
  useEffect(() => { if (artist && !as.isBusy()) resetFrom(artist); }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dr = useDragReorder((from, to) => editRows(moved(rows, from, to)));

  if (!artist) return null;
  const merchOn = !!artist.features?.merch, fansOn = !!artist.features?.fans;
  const venmo = artist.paymentUrl ? paymentAppOf(artist.paymentUrl) : null;
  const fanUrl = `${origin}/f/${artist.slug}`;

  function editRows(next: Row[]) {
    setRows(next);
    const items: MerchItem[] = [];
    for (const r of next) {
      const cents = parsePrice(r.price);
      if (!r.name.trim()) return as.hold("each item needs a name (or delete it)");
      if (cents === null) return as.hold(`the price of ${r.name.trim()} needs to be a dollar amount like 25 or 4.50`);
      items.push({ id: r.id, name: r.name.trim(), priceCents: cents });
    }
    as.patch({ merchItems: items });
  }
  const setRow = (i: number, patch: Partial<Row>) => editRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const freshCents = parsePrice(fresh.price);
  function add() {
    if (!fresh.name.trim() || freshCents === null) return;
    editRows([...rows, { id: newId(), name: fresh.name.trim(), price: priceText(freshCents) }]);
    setFresh({ name: "", price: "" });
  }
  function editName(v: string) { setPublicName(v); as.patch({ publicName: v.trim() || null }); }
  function editStyle(next: FanPageStyle) { setStyle(next); as.patch({ fanPageStyle: next }); }

  return (
    <div className="grid gap-5" onBlur={() => void as.flush()} data-testid="merch-page">
      <PageTitle title="Merch" sub="The price list and look of your fan page." actions={(
        <>
          <SaveStatus {...as.statusProps} />
          <a className="btn outline" href={`/f/${artist.slug}`} target="_blank" rel="noopener noreferrer" data-testid="merch-preview">Preview fan page</a>
        </>
      )} />
      <ErrorBox error={as.error ?? null} />
      {(!merchOn || !fansOn || !venmo) && (
        <div className="card" data-testid="merch-setup">
          {!fansOn && <span className="s">The fan page is off, so its link shows “Not found”. Turn on Fans in <Link href="/admin/artist" className="link">General Settings</Link>.</span>}
          {!merchOn && <span className="s">Merch is off, so the fan page hides the price list. Turn it on in <Link href="/admin/artist" className="link">General Settings</Link>.</span>}
          {!venmo && <span className="s">Add your Venmo link (Payment app) in <Link href="/admin/artist" className="link">General Settings</Link>: the price list shows with a Venmo button.</span>}
        </div>
      )}

      <section className="card" aria-labelledby="price-title" data-testid="merch-price-list">
        <div><h2 id="price-title" className="text-lg font-bold">Price list</h2><p className="s">Drag to reorder. Fans tap + and − and Venmo opens with the total.</p></div>
        {rows.length ? (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {rows.map((r, i) => {
              const badPrice = parsePrice(r.price) === null;
              return (
                <li key={r.id} className="flex items-center gap-2" data-testid="merch-item" {...dr.row(i)}>
                  <span className="flex w-6 shrink-0 cursor-grab select-none justify-center text-muted" {...dr.handle(i)} aria-hidden="true" data-testid="merch-item-grip"><Grip /></span>
                  <input className="input min-w-0 flex-1" aria-label="Item name" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} data-testid="merch-item-name" />
                  <span className="flex items-center gap-1"><span className="text-muted">$</span>
                    <input className="input w-24" aria-label={`Price of ${r.name}`} inputMode="decimal" value={r.price} aria-invalid={badPrice || undefined}
                      onChange={(e) => setRow(i, { price: e.target.value })} data-testid="merch-item-price" /></span>
                  <button type="button" className="icon-btn danger" aria-label={`Delete ${r.name}`} onClick={() => editRows(rows.filter((_, j) => j !== i))} data-testid="merch-item-delete">{Icons.trash}</button>
                </li>
              );
            })}
          </ul>
        ) : <p className="s" data-testid="merch-empty">No items yet.</p>}
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <span className="w-6 shrink-0" />
          <input className="input min-w-0 flex-1" placeholder="New item, like T-Shirt" aria-label="New item name" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} data-testid="merch-new-name" />
          <span className="flex items-center gap-1"><span className="text-muted">$</span>
            <input className="input w-24" placeholder="25" aria-label="New item price" inputMode="decimal" value={fresh.price} onChange={(e) => setFresh({ ...fresh, price: e.target.value })} data-testid="merch-new-price" /></span>
          <button type="submit" className="btn acc" disabled={!fresh.name.trim() || freshCents === null} data-testid="merch-add">Add</button>
        </form>
      </section>

      <QrCard url={fanUrl} name={publicName.trim() || artist.name} />

      <section className="card" aria-labelledby="style-title" data-testid="merch-style">
        <div><h2 id="style-title" className="text-lg font-bold">Fan page</h2><p className="s">How the page looks to fans.</p></div>
        <label className="grid gap-1"><span className="lbl">Name on the page</span>
          <input className="input" value={publicName} placeholder={artist.name} onChange={(e) => editName(e.target.value)} data-testid="merch-public-name" />
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
      </section>
      <p className="s">Paying is on Venmo: Roadie doesn&apos;t see or record merch sales yet.{venmo ? <> Payments go to @{venmo.handle}.</> : null}</p>
    </div>
  );
}
