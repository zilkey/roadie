import { z } from "zod";
import { entity, serverMask, id, sourcesShape } from "./common";
import { ArtistLinks } from "./artists";

/**
 * Acts (issue #77): the bands on venue calendars' bills, tracked as peers or headliners to open for. Not `artists` (that is the
 * tenant band) and not contacts (an act's people are this band's contacts, linked from its actNotes). The same split as
 * promoters / promoterNotes:
 * - `acts/{id}`: public facts, one record for every band. Anyone can correct it, like a venue. Made from venue calendars at refresh
 *   (src/server/events/acts.ts) or added by hand; `lookedUpAt` and the about fields are Look up's (#78).
 * - `actNotes/{artistId}__{actId}`: what one band thinks of the act (src/schema/bandNotes.ts). Admins only.
 */
export const SpotifyCandidate = z.strictObject({
  id: z.string().min(1), name: z.string().min(1), url: z.string().url(), genres: z.array(z.string()), imageUrl: z.string().optional(),
});
export type SpotifyCandidate = z.infer<typeof SpotifyCandidate>;

export const ActDoc = entity({
  name: z.string().min(1),
  matchKey: z.string().min(1),
  links: ArtistLinks.optional(),
  genres: z.array(z.string().min(1)).optional(),
  description: z.string().optional(),
  hometown: z.string().optional(),
  imageUrl: z.string().optional(),
  lookedUpAt: z.string().optional(),
  /** Look up (#78) found several Spotify artists with exactly this name: the About card asks "same band?" until one is picked. */
  lookupCandidates: z.array(SpotifyCandidate).optional(),
  ...sourcesShape,
});
/** What db.ts validates for `acts`: the shared record. */
export const ActRecord = ActDoc.omit({ ...serverMask, matchKey: true });
export type ActDoc = z.infer<typeof ActDoc>;

export const ACT_RELATIONSHIPS = ["openFor", "peer", "notFit"] as const;
export type ActRelationship = (typeof ACT_RELATIONSHIPS)[number];
export const RELATIONSHIP_LABEL: Record<ActRelationship, string> = { openFor: "Want to open for them", peer: "Peer: trade shows", notFit: "Not a fit" };
export const RELATIONSHIP_HINT: Record<ActRelationship, string> = {
  openFor: "Bigger than us: pitch them for an opening slot.",
  peer: "About our size: we open for them, they open for us.",
  notFit: "Hidden from the Acts list unless you ask for it.",
};
export const actRelationship = z.enum(ACT_RELATIONSHIPS);

/** What the act commands accept: the shared fields plus this band's take, which goes to its actNotes. */
export const ActInput = ActRecord.omit({ lookupCandidates: true, lookedUpAt: true }).extend({
  shortlist: z.boolean().optional(), weKnow: z.boolean().optional(), relationship: actRelationship.optional(), note: z.string().optional(), contactIds: z.array(id).optional(),
});
