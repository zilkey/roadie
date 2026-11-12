"use client";
/**
 * Which campaign a flag puts a new pitch in (#82 S6). Asked on the first flag of a page ("Which campaign?"), then kept for
 * that page until you leave it. `?campaign=` (from a campaign's "Add pitches from") answers it up front; so does the quiet
 * "Flags go to" menu on Venues, Festivals & series and Venue calendars. No active campaign: nothing to ask, new pitches go
 * to Ongoing. Every flag path asks through here: the Booking tables' PitchModal, the detail pages' flag (useFlag) and
 * ShowActions ("Pitch this" on Venue calendars and a venue's Events tab), which also asks, every time, whether a show at a
 * venue whose pitch is in another campaign keeps that pitch there or moves it (Q2).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog } from "@/components/ui";
import Link from "@/lib/artist";
import { ROUTES } from "@/lib/routes";
import { useCampaigns } from "@/components/booking/useCampaigns";
import { homeOf, ONGOING, type CampaignKey } from "@/lib/campaigns";
import { isActive } from "@/lib/booking";
import type { Campaign } from "@/schema";

interface Api {
  /** The page's choice, if made (ONGOING or a campaign id). */
  chosen?: CampaignKey;
  choose(k: CampaignKey | undefined): void;
  /** The choice, asking first when there is none and a campaign is active. null = the person backed out. */
  ask(): Promise<CampaignKey | null>;
  /** Q2: a pitch already in another campaign (or Ongoing) than the chosen one: keep it there or move it. null = backed out. */
  keepOrMove(pitch: { campaignId?: string | null; status: string }, into: CampaignKey, place: string): Promise<"keep" | "move" | null>;
  active: Campaign[];
  live: ReadonlyMap<string, Campaign>;
  /** A campaign key as words: "Ongoing" or its name. */
  label(k: CampaignKey): string;
}

const NONE: Api = {
  choose: () => {}, ask: async () => ONGOING, keepOrMove: async () => "keep", active: [], live: new Map(), label: () => "Ongoing",
};
const FlagCampaignContext = createContext<Api>(NONE);
export const useFlagCampaign = () => useContext(FlagCampaignContext);

/** The new pitch's campaignId for a command: nothing for Ongoing. */
export const campaignArg = (k: CampaignKey | null | undefined) => (k && k !== ONGOING ? { campaignId: k } : {});

type Asking = { kind: "which"; resolve(k: CampaignKey | null): void } | { kind: "move"; from: CampaignKey; into: CampaignKey; place: string; resolve(v: "keep" | "move" | null): void };

export function FlagCampaignProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { active, live } = useCampaigns();
  const [picked, setPicked] = useState<{ path: string; key: CampaignKey | undefined } | null>(null);
  const [fromUrl, setFromUrl] = useState<{ path: string; key?: string }>({ path: "" });
  // ?campaign= answers the question for the page it opens (read once per page; the pages carry it through their URL rebuilds).
  useEffect(() => { setFromUrl({ path, key: new URLSearchParams(window.location.search).get("campaign") ?? undefined }); }, [path]);
  const valid = (k?: string): k is CampaignKey => !!k && (k === ONGOING || live.get(k)?.status === "active");
  const chosen = picked?.path === path ? (valid(picked.key) ? picked.key : undefined) : fromUrl.path === path && valid(fromUrl.key) ? fromUrl.key : undefined;
  const [asking, setAsking] = useState<Asking | null>(null);
  const chosenRef = useRef(chosen);
  chosenRef.current = chosen;
  const label = useCallback((k: CampaignKey) => (k === ONGOING ? "Ongoing" : live.get(k)?.name ?? "that campaign"), [live]);

  const api = useMemo<Api>(() => ({
    chosen, active, live, label,
    choose: (k) => setPicked({ path, key: k }),
    ask: () => {
      if (chosenRef.current) return Promise.resolve(chosenRef.current);
      if (!active.length) return Promise.resolve(ONGOING);
      return new Promise((resolve) => setAsking({ kind: "which", resolve }));
    },
    keepOrMove: (pitch, into, place) => {
      if (!isActive(pitch.status)) return Promise.resolve("keep");
      const from = homeOf(pitch, live);
      if (from === into) return Promise.resolve("keep");
      return new Promise((resolve) => setAsking({ kind: "move", from, into, place, resolve }));
    },
  }), [chosen, active, live, label, path]);

  const settle = (fn: () => void) => { fn(); setAsking(null); };
  return (
    <FlagCampaignContext.Provider value={api}>
      {children}
      {asking?.kind === "which" && (
        <Dialog open onClose={() => settle(() => asking.resolve(null))} title="Which campaign?" testid="which-campaign">
          <span className="s -mt-2">New pitches from this page go there until you leave it. A place already on a pitch keeps its campaign.</span>
          <div className="hit-list" data-testid="which-campaign-list">
            {[{ key: ONGOING, name: "Ongoing", sub: "No campaign" }, ...active.map((c) => ({ key: c.id, name: c.name, sub: "" }))].map((c) => (
              <button key={c.key} type="button" className="hit-row" data-testid={`which-campaign-${c.key}`}
                onClick={() => settle(() => { setPicked({ path, key: c.key }); asking.resolve(c.key); })}>
                <span className="grid min-w-0 gap-px"><b>{c.name}</b>{c.sub && <span className="s">{c.sub}</span>}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end"><button type="button" className="btn" onClick={() => settle(() => asking.resolve(null))} data-testid="which-campaign-cancel">Cancel</button></div>
        </Dialog>
      )}
      {asking?.kind === "move" && (
        <Dialog open onClose={() => settle(() => asking.resolve(null))} title={`${asking.place} is already in ${label(asking.from)}`} testid="keep-or-move">
          <span className="s -mt-2">Its pitch is in {label(asking.from)}. Add the show to it there, or move the pitch to {label(asking.into)}?</span>
          <div className="grid gap-2">
            <button type="button" className="btn ghost justify-start" onClick={() => settle(() => asking.resolve("keep"))} data-testid="keep-campaign">Keep it in {label(asking.from)}</button>
            <button type="button" className="btn ghost justify-start" onClick={() => settle(() => asking.resolve("move"))} data-testid="move-campaign">Move it to {label(asking.into)}</button>
          </div>
          <div className="flex justify-end"><button type="button" className="btn" onClick={() => settle(() => asking.resolve(null))} data-testid="keep-or-move-cancel">Cancel</button></div>
        </Dialog>
      )}
    </FlagCampaignContext.Provider>
  );
}

/** The quiet "Flags go to" menu on Venues, Festivals & series and Venue calendars. Hidden when no campaign is active. */
export function FlagCampaignSelect() {
  const f = useFlagCampaign();
  if (!f.active.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
    <label className="flex items-center gap-2 text-sm" data-testid="flag-campaign">
      <span className="s font-semibold whitespace-nowrap">Flags go to</span>
      <select className="select !w-auto max-w-[16rem]" value={f.chosen ?? ""} aria-label="Campaign new pitches go to" data-testid="flag-campaign-select"
        onChange={(e) => f.choose((e.target.value || undefined) as CampaignKey | undefined)}>
        <option value="">Ask on the first flag</option>
        <option value={ONGOING}>Ongoing</option>
        {f.active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    {/* Back to the campaign the flags fill (Jeff, 2026-11-12). */}
    {f.chosen && <Link href={f.chosen === ONGOING ? ROUTES.bookingPitches.path : `/booking/campaigns/${f.chosen}`} className="link text-sm font-semibold" data-testid="flag-campaign-view">View campaign</Link>}
    </span>
  );
}
