/**
 * Booking campaigns (#82): which pitches a campaign page lists, and the counts the sidebar and All campaigns show.
 * Every pitch is in one campaign. "Ongoing" is computed, never stored: a pitch with no campaignId, or an active pitch whose
 * campaign is closed (or gone). A closed campaign keeps every pitch that points at it, so its page is its history.
 */
import { ACTIVE_STATUSES, isActive, STATUSES, type Status } from "./booking";

export const ONGOING = "ongoing";
export type CampaignKey = typeof ONGOING | (string & {});

export interface CampaignLike { id: string; name: string; status: "active" | "closed"; deletedAt?: unknown }
export interface CampaignPitchLike { status: string; campaignId?: string | null }

/** The live campaigns of a band by id (archived ones are left out, as if gone). */
export const liveCampaigns = <C extends CampaignLike>(cs: readonly C[]) => new Map(cs.filter((c) => !c.deletedAt).map((c) => [c.id, c]));

/** True when the pitch shows on Ongoing: no campaign, or an active pitch whose campaign is closed or gone. */
export function inOngoing(p: CampaignPitchLike, live: ReadonlyMap<string, CampaignLike>): boolean {
  if (!p.campaignId) return true;
  return live.get(p.campaignId)?.status !== "active" && isActive(p.status);
}

/** Whether a pitch belongs on the page for `key` (Ongoing or a campaign id). */
export function inCampaign(p: CampaignPitchLike, key: CampaignKey, live: ReadonlyMap<string, CampaignLike>): boolean {
  return key === ONGOING ? inOngoing(p, live) : p.campaignId === key;
}

/** The campaign a pitch counts toward on the sidebar and All campaigns: its own while that is active, else Ongoing. */
export function homeOf(p: CampaignPitchLike, live: ReadonlyMap<string, CampaignLike>): CampaignKey {
  return inOngoing(p, live) ? ONGOING : p.campaignId!;
}

/** How many pitches are in each status, in STATUSES order, zero counts left out. */
export function statusCounts(ps: readonly CampaignPitchLike[]): { status: Status; n: number }[] {
  const by = new Map<string, number>();
  for (const p of ps) by.set(p.status, (by.get(p.status) ?? 0) + 1);
  return STATUSES.flatMap((s) => (by.get(s) ? [{ status: s, n: by.get(s)! }] : []));
}

export const activeCount = (ps: readonly CampaignPitchLike[]) => ps.filter((p) => (ACTIVE_STATUSES as string[]).includes(p.status)).length;

/** Active campaigns by name, then closed ones by name: the All campaigns page and the sidebar. */
export function sortCampaigns<C extends CampaignLike>(cs: Iterable<C>): { active: C[]; closed: C[] } {
  const all = [...cs].sort((a, b) => a.name.localeCompare(b.name));
  return { active: all.filter((c) => c.status === "active"), closed: all.filter((c) => c.status === "closed") };
}
