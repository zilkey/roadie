import { z } from "zod";
import { entity, serverMask, id } from "./common";

export const campaignStatus = z.enum(["active", "closed"]);
export type CampaignStatus = z.infer<typeof campaignStatus>;

/**
 * campaigns/{id}: a booking push (#82). A tag like a tour: pitches point at it with campaignId. Closing sets status only;
 * pitches keep their campaignId. "Ongoing" is computed, never stored: active pitches with no campaignId or a closed campaign.
 * That artist's admins read; writes go through the server.
 */
export const Campaign = entity({
  artistId: id,
  name: z.string().min(1),
  status: campaignStatus,
});
export const CampaignInput = Campaign.omit(serverMask);
export type Campaign = z.infer<typeof Campaign>;
