import { z } from "zod";
import { entity, serverMask, id } from "./common";
import { checklist } from "./shows";

/**
 * socialChecklists/{artistId}: the lists in the Social Media sidebar, one doc per artist (its id is the artist's). They belong to
 * Social Media as a whole, not to any post. Admins only. Made by the first list added.
 */
export const SocialChecklists = entity({
  artistId: id,
  checklists: z.array(checklist).default([]),
});
export const SocialChecklistsInput = SocialChecklists.omit(serverMask);
export type SocialChecklists = z.infer<typeof SocialChecklists>;
