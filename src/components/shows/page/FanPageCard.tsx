"use client";
import { useEffect, useRef, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { InlineValue } from "@/components/InlineValue";
import { useArtist } from "@/lib/artist";
import { money, parsePrice } from "@/lib/merch";
import { publicShowName } from "@/lib/shows";
import { FAN_PAGE_BUTTONS, type ShowFanPage } from "@/schema/shows";
import type { ShowRow } from "../common";
import { AdminOnlyBadge, ShowCard } from "./kit";

/** The Preview link for a show's fan page line: the public page with ?showId=, which shows the line whatever the time. */
export const fanPreviewHref = (slug: string, showId: string) => `/f/${slug}?showId=${encodeURIComponent(showId)}`;

/**
 * Fan Page (admins): whether this show gets a line on the public fan page, its name, amount and button (Ticket or Suggested
 * Donation). Fans tap + and − and pay on Venmo. Every change saves at once.
 */
export function FanPageCard({ show }: { show: ShowRow }) {
  const { call, error } = useCommand();
  const slug = useArtist().doc?.slug;
  const fp: ShowFanPage = show.fanPage ?? { on: false };
  // Each save sends the whole object, built on the last one sent: a second edit before the show's snapshot arrives must not undo the first.
  const latest = useRef<ShowFanPage>(fp);
  const snap = JSON.stringify(show.fanPage ?? null);
  useEffect(() => { latest.current = show.fanPage ?? { on: false }; }, [snap]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (patch: Partial<ShowFanPage>) => {
    const before = latest.current;
    const next = { ...before, ...patch };
    const clean: ShowFanPage = { on: next.on, ...(next.name?.trim() ? { name: next.name.trim() } : {}), ...(next.amountCents ? { amountCents: next.amountCents } : {}), ...(next.button ? { button: next.button } : {}) };
    latest.current = clean;
    const ok = !!(await call("shows.update", { id: show.id, patch: { fanPage: clean } }));
    if (!ok) latest.current = before;
    return ok;
  };
  // The checkbox and buttons flip at once; the show's snapshot brings back the saved value (or the old one if the save failed).
  const [on, setOn] = useState(fp.on);
  const [button, setButton] = useState(fp.button ?? "ticket");
  useEffect(() => { setOn(fp.on); setButton(fp.button ?? "ticket"); }, [fp.on, fp.button]);
  const flip = async (patch: Partial<ShowFanPage>) => {
    if (patch.on !== undefined) setOn(patch.on);
    if (patch.button) setButton(patch.button);
    if (!(await save(patch))) { setOn(latest.current.on); setButton(latest.current.button ?? "ticket"); }
  };

  return (
    <ShowCard title="Fan Page" testid="show-fan-page" badge={<AdminOnlyBadge />}>
      <div className="grid gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={on} onChange={(e) => void flip({ on: e.target.checked })} data-testid="show-fan-on" />Show on Fan Page
        </label>
        <div className="grid gap-1">
          <span className="lbl">Name</span>
          <InlineValue testid="show-fan-name" label="Name" kind="text" value={fp.name ?? ""} emptyLabel={publicShowName(show)} canEdit
            onSave={(v) => save({ name: v })} />
          <span className="s">What fans see, and the note on the Venmo payment.</span>
        </div>
        <div className="grid gap-1">
          <span className="lbl">Amount</span>
          <InlineValue testid="show-fan-amount" label="Amount" kind="text" inputMode="decimal" placeholder="20"
            value={fp.amountCents ? money(fp.amountCents).slice(1) : ""} display={fp.amountCents ? money(fp.amountCents) : undefined} canEdit
            validate={(v) => { if (!v.trim()) return null; const c = parsePrice(v); return c === null || c < 100 ? "Use a dollar amount of at least 1, like 20" : null; }}
            onSave={(v) => save({ amountCents: v.trim() ? parsePrice(v)! : undefined })} />
        </div>
        <div className="grid gap-1">
          <span className="lbl">Button text</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Button text">
            {(["ticket", "donation"] as const).map((k) => (
              <button key={k} type="button" className="pick" aria-pressed={button === k} onClick={() => void flip({ button: k })} data-testid={`show-fan-button-${k}`}>{FAN_PAGE_BUTTONS[k]}</button>
            ))}
          </div>
          <span className="s">Fans tap + and − for how many, then pay on Venmo.</span>
        </div>
        <p className="s" data-testid="show-fan-when">This will appear on the Fan Page 1 hour before the show and 3 hours after.</p>
        {slug && (
          fp.amountCents
            ? <a className="link justify-self-start text-sm" href={fanPreviewHref(slug, show.id)} target="_blank" rel="noopener noreferrer" data-testid="show-fan-preview">Preview on the Fan Page</a>
            : <span className="s" data-testid="show-fan-preview-none">Add an amount to preview it.</span>
        )}
        <ErrorBox error={error} />
      </div>
    </ShowCard>
  );
}
