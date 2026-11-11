import { z } from "zod";
import { entity, serverMask, id, email, ts } from "./common";

/**
 * One Gmail thread the band linked or sent: `emailThreads/{artistId}__{threadId}`. A thread belongs to the place
 * (venue, promoter or festival; an edition's threads go on its festival), so it stays when a pitch closes. Only that
 * artist's admins read it (firestore.rules). Message bodies are never stored: this is the summary, bodies come from Gmail.
 */
export const EmailThread = entity({
  artistId: id,
  /** The admin's mailbox the thread is in (whose token reads it). */
  account: email,
  threadId: z.string().min(1),
  target: z.strictObject({ kind: z.enum(["venue", "promoter", "festival"]), id, name: z.string().min(1) }),
  /** The pitch it was sent from or linked to, if any. */
  pitchId: id.optional(),
  subject: z.string(),
  /** First ~160 characters of the last message's text, quoted part stripped. */
  snippet: z.string(),
  /** Date of the last message (ISO). */
  lastDate: z.string(),
  lastFrom: email,
  lastDirection: z.enum(["sent", "received"]),
  messageCount: z.number().int(),
  /** Everyone on the thread except `account`, lowercase, unique. */
  participants: z.array(email),
  /** Set when someone opens the thread in Roadie. */
  lastSeenAt: ts.optional(),
  /** Set every time Roadie re-reads the thread, even when nothing changed ("Checked <relative>"). */
  syncedAt: ts.optional(),
});
export const EmailThreadInput = EmailThread.omit(serverMask);
export type EmailThread = z.infer<typeof EmailThread>;
export const emailThreadId = (artistId: string, threadId: string) => `${artistId}__${threadId}`;

/** "New reply": the last message came in and nobody has opened the thread since. */
export function hasNewReply(t: { lastDirection: string; lastDate: string; lastSeenAt?: { toMillis(): number } | Date | null }): boolean {
  if (t.lastDirection !== "received") return false;
  if (!t.lastSeenAt) return true;
  const seen = t.lastSeenAt instanceof Date ? t.lastSeenAt.getTime() : t.lastSeenAt.toMillis();
  return seen < new Date(t.lastDate).getTime();
}
