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
  closedAt: ts.optional(),
});
export const AvailabilityInput = Availability.omit(serverMask);
export type Availability = z.infer<typeof Availability>;
