import { z } from "zod";
import { entity, serverMask, id, dateStr, ts, sourcesShape } from "./common";

export const pitchStatus = z.enum(["idea", "toPitch", "pitched", "waiting", "talking", "booked", "declined", "dropped"]);
export type PitchStatus = z.infer<typeof pitchStatus>;

/** One possible date for a pitch: a day, or a run (endDate, for festivals and multi-night stands). Kept sorted by date. */
export const PitchDate = z.strictObject({ date: dateStr, endDate: dateStr.optional(), note: z.string().min(1).optional() })
  .refine((d) => !d.endDate || d.endDate >= d.date, { message: "endDate must not be before date" });
export type PitchDate = z.infer<typeof PitchDate>;

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
  dates: z.array(PitchDate).default([]),
  notes: z.string().optional(),
  ...sourcesShape,
});
export const PitchInput = Pitch.omit(serverMask);
export type Pitch = z.infer<typeof Pitch>;

/** pitches/{id}/comments/{id} */
export const Comment = entity({ authorId: id, body: z.string().min(1) });
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
