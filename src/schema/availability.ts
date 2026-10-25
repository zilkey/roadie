import { z } from "zod";
import { entity, serverMask, id, dateStr, ts } from "./common";

export const Availability = entity({
  date: dateStr,
  label: z.string(),
  pitchId: id.optional(),
  showId: id.optional(),
  askedMusicianIds: z.array(id),
  responses: z.record(id, z.strictObject({
    answer: z.enum(["yes", "no", "maybe"]), note: z.string().optional(), by: z.enum(["self", "admin"]), at: ts,
  })),
  linkTokens: z.record(id, z.string()),
  sentAt: ts.optional(),
  /** How the last ask went out: everyone emailed their own link, or an admin's post to the band's Signal group. */
  channel: z.enum(["email", "signal"]).optional(),
  closedAt: ts.optional(),
});
export const AvailabilityInput = Availability.omit(serverMask);
export type Availability = z.infer<typeof Availability>;
