import { z } from "zod";
import { entity, serverMask, id, dateStr, ts, sourcesShape } from "./common";

export const pitchStatus = z.enum(["idea", "toPitch", "pitched", "waiting", "talking", "booked", "declined", "dropped"]);
export type PitchStatus = z.infer<typeof pitchStatus>;

export const Pitch = entity({
  target: z.strictObject({ kind: z.enum(["venue", "promoter", "edition"]), id, name: z.string().min(1) }),
  status: pitchStatus,
  artistId: id,
  pitchedAs: id.optional(),
  personnel: z.array(id),
  assigneeId: id.optional(),
  nextStep: z.strictObject({ text: z.string().min(1), due: dateStr }).optional(),
  lastContactAt: ts.optional(),
  showIds: z.array(id),
  /** Possible dates for the gig: plain days, kept sorted and unique by the commands. */
  dates: z.array(dateStr).default([]),
  notes: z.string().optional(),
  ...sourcesShape,
});
export const PitchInput = Pitch.omit(serverMask);
export type Pitch = z.infer<typeof Pitch>;

/**
 * pitches/{id}/comments/{id}. Also shows/{id}/comments/{id}: the pitch's comments copied over when it is booked (same author, same time),
 * and the band's own comments on the show (audience "band", written by shows.comment). Missing audience = admins only.
 */
export const Comment = entity({ authorId: id, body: z.string().min(1), audience: z.literal("band").optional() });
export const CommentInput = Comment.omit(serverMask);
export type Comment = z.infer<typeof Comment>;

/** pitches/{id}/activity/{id}. Append only. */
export const Activity = entity({
  type: z.enum(["status", "emailSent", "emailReply", "call", "note"]),
  fromStatus: pitchStatus.optional(),
  toStatus: pitchStatus.optional(),
  gmail: z.strictObject({ messageId: z.string(), threadId: z.string(), to: z.string(), subject: z.string() }).optional(),
  text: z.string().optional(),
});
export const ActivityInput = Activity.omit(serverMask);
export type Activity = z.infer<typeof Activity>;
