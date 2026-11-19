/**
 * "Add a pitch" on a thread's "This email covers" card (#82 S8b): which of the band's other active pitches this email most
 * likely covers too, so the picker can put them first instead of listing every pitch A to Z. A pitch is suggested when
 * someone on the email is one of its place's contacts, when it shares a promoter with the thread's place or a pitch already
 * on it, or when it is in the same campaign as a pitch already on it. Everything else is still findable by name.
 */

type Target = { kind: string; id: string; name: string };
export interface CoverPitch { id: string; status: string; target: Target; campaignId?: string | null }
export interface CoverData {
  venues: { id: string; contactIds?: string[]; promoterIds?: string[] }[];
  promoters: { id: string; name: string; contactIds?: string[]; venueIds?: string[] }[];
  festivals: { id: string; contactIds?: string[]; promoterId?: string | null }[];
  editions: { id: string; festivalId: string }[];
  contacts: { id: string; name: string; emails: string[] }[];
  campaigns: { id: string; name: string }[];
}
export interface CoverSuggestion { id: string; name: string; sub: string; rank: number }

export function coverSuggestions(
  thread: { target: Target; participants: string[] },
  on: CoverPitch[],
  candidates: CoverPitch[],
  d: CoverData,
  statusLabel: (status: string) => string,
): CoverSuggestion[] {
  const venues = new Map(d.venues.map((v) => [v.id, v]));
  const promoters = new Map(d.promoters.map((p) => [p.id, p]));
  const festivals = new Map(d.festivals.map((f) => [f.id, f]));
  const editions = new Map(d.editions.map((e) => [e.id, e]));
  const campaigns = new Map(d.campaigns.map((c) => [c.id, c]));

  /** A place's promoters: its own (a promoter is its own), plus promoters that list a venue in their venueIds. */
  function promotersOf(t: Target): string[] {
    if (t.kind === "promoter") return [t.id];
    if (t.kind === "venue") {
      const own = venues.get(t.id)?.promoterIds ?? [];
      return [...new Set([...own, ...d.promoters.filter((p) => p.venueIds?.includes(t.id)).map((p) => p.id)])];
    }
    const festivalId = t.kind === "edition" ? editions.get(t.id)?.festivalId : t.kind === "festival" ? t.id : undefined;
    const pid = festivalId ? festivals.get(festivalId)?.promoterId : undefined;
    return pid ? [pid] : [];
  }
  function contactsOf(t: Target): string[] {
    if (t.kind === "venue") return venues.get(t.id)?.contactIds ?? [];
    if (t.kind === "promoter") return promoters.get(t.id)?.contactIds ?? [];
    const festivalId = t.kind === "edition" ? editions.get(t.id)?.festivalId : t.kind === "festival" ? t.id : undefined;
    return festivalId ? festivals.get(festivalId)?.contactIds ?? [] : [];
  }

  const people = new Set(thread.participants.map((e) => e.toLowerCase()));
  const onEmail = new Map(d.contacts.filter((c) => c.emails.some((e) => people.has(e.toLowerCase()))).map((c) => [c.id, c]));
  const sharedPromoters = new Set([thread.target, ...on.map((p) => p.target)].flatMap(promotersOf));
  const sharedCampaigns = new Set(on.map((p) => p.campaignId).filter((c): c is string => !!c));

  return candidates.map((p) => {
    const person = contactsOf(p.target).map((id) => onEmail.get(id)).find(Boolean);
    const promoter = promotersOf(p.target).find((id) => sharedPromoters.has(id));
    const campaign = p.campaignId && sharedCampaigns.has(p.campaignId) ? campaigns.get(p.campaignId) : undefined;
    const why = [
      person && `${person.name} is on this email`,
      promoter && (p.target.kind === "promoter" ? "The promoter" : `Same promoter: ${promoters.get(promoter)?.name ?? "promoter"}`),
      campaign && `Same campaign: ${campaign.name}`,
    ].filter((x): x is string => !!x);
    // Someone on the email is the strongest sign, then the promoter, then the campaign.
    const rank = (person ? 4 : 0) + (promoter ? 2 : 0) + (campaign ? 1 : 0);
    return { id: p.id, name: p.target.name, sub: [...why, statusLabel(p.status)].join(" · "), rank };
  });
}
