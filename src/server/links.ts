/**
 * Public links that name a record but not its artist (tenancy phase 10): an availability ask's answer link
 * (`/ask/{availabilityId}/{musicianId}/{token}`) and a stage plot's engineer link (`/plot/{plotId}/{token}`). Once artist data is nested
 * under `artists/{id}/…`, the record's path needs its artist, which the link doesn't carry. `artistLinks/{kind}_{id}` = {kind, id,
 * artistId} is that small top-level index: the Writer adds one when an ask or a plot is created, and scripts/migrate-nested.ts writes
 * one for every existing record (links sent before phase 4 included). Server-only, no client rule.
 */
import { firestore } from "./admin";

export const LINKED_KINDS = new Set(["availability", "stagePlots"]);
export const linkPath = (kind: string, id: string) => `artistLinks/${kind}_${id}`;

/** The artist an availability ask or stage plot belongs to, from the index; undefined when it has no entry. */
export async function linkedArtist(kind: "availability" | "stagePlots", id: string): Promise<string | undefined> {
  const d = (await firestore().doc(linkPath(kind, id)).get()).data();
  return typeof d?.artistId === "string" ? d.artistId : undefined;
}
