/**
 * The email columns on a campaign page (#82 S7): Initial email, Follow-up and the New reply mark, built from the band's
 * emailThreads (one query) plus the pitch. No activity reads.
 *
 * A pitch's threads: those that name it (`pitchIds ?? [pitchId]`, S8), else the threads on its place started since the pitch
 * was (an old pitch's mail stays with the old pitch). The initial email is the first of them; a follow-up is the latest
 * email after it: a reply we sent in the same thread (Roadie only knows the last message, so a sent last message in a
 * thread of 2+ counts), or a later thread of its own, which is marked "new thread". When the last message in came from
 * them, no follow-up is needed. When none was sent, the follow-up is due by followUpFor's rule (the To Dos one).
 */
import { followUpFor, type FollowUpPitchLike } from "./booking";

export interface ThreadLike {
  id: string; subject: string; lastDate: string; lastDirection: "sent" | "received" | string; messageCount: number;
  target: { kind: string; id: string }; pitchId?: string; pitchIds?: string[];
  createdAt?: { toMillis(): number }; lastSeenAt?: { toMillis(): number } | null;
}
export interface CellPitch extends FollowUpPitchLike {
  id: string; target: { kind: string; id: string };
}

export const pitchIdsOf = (t: Pick<ThreadLike, "pitchId" | "pitchIds">): string[] => t.pitchIds ?? (t.pitchId ? [t.pitchId] : []);

export interface EmailCells {
  initial?: { threadId: string; subject: string; date: string };
  followUp?:
    | { kind: "sent"; threadId: string; subject: string; date: string; newThread: boolean; more: number }
    | { kind: "replied"; date: string; threadId: string }
    | { kind: "due"; due: boolean; quiet: boolean; days?: number; /** The thread to reply in; none when the first email isn't in Roadie (sent before, or by hand). */ threadId?: string };
  newReply: boolean;
  /** Every thread the cells were built from, oldest first. */
  threads: string[];
}

const ms = (t: ThreadLike) => t.createdAt?.toMillis() ?? Date.parse(t.lastDate);
const newReplyOn = (t: ThreadLike) => t.lastDirection === "received" && (!t.lastSeenAt || t.lastSeenAt.toMillis() < Date.parse(t.lastDate));

/** `placeId`: where the pitch's threads live (an edition's are on its festival). */
export function emailCells(p: CellPitch, threads: readonly ThreadLike[], placeId: string, today: string): EmailCells {
  const named = threads.filter((t) => pitchIdsOf(t).includes(p.id));
  const since = p.createdAt?.toMillis?.() ?? 0;
  const mine = (named.length ? named : threads.filter((t) => t.target.id === placeId && pitchIdsOf(t).length === 0 && ms(t) >= since)).slice().sort((a, b) => ms(a) - ms(b));
  const out: EmailCells = { newReply: mine.some(newReplyOn), threads: mine.map((t) => t.id) };
  if (!mine.length) {
    // No thread in Roadie, yet the pitch may have been pitched by hand or before Roadie: the To Dos rule still says when it's owed.
    const f = followUpFor(p, today);
    if (f && p.status !== "idea" && p.status !== "toPitch") out.followUp = { kind: "due", due: f.due, quiet: f.quiet, days: f.daysSinceContact };
    return out;
  }
  const first = mine[0];
  out.initial = { threadId: first.id, subject: first.subject, date: new Date(ms(first)).toISOString().slice(0, 10) };
  const later = mine.slice(1);
  const latest = mine[mine.length - 1];
  if (latest.lastDirection === "received") { out.followUp = { kind: "replied", date: latest.lastDate.slice(0, 10), threadId: latest.id }; return out; }
  if (later.length) {
    const t = later[later.length - 1];
    out.followUp = { kind: "sent", threadId: t.id, subject: t.subject, date: t.lastDate.slice(0, 10), newThread: true, more: later.length - 1 };
    return out;
  }
  if (first.messageCount > 1) {
    out.followUp = { kind: "sent", threadId: first.id, subject: first.subject, date: first.lastDate.slice(0, 10), newThread: false, more: 0 };
    return out;
  }
  const f = followUpFor(p, today);
  if (f) out.followUp = { kind: "due", due: f.due, quiet: f.quiet, days: f.daysSinceContact, threadId: first.id };
  return out;
}
