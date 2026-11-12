/**
 * Write emails (#82 S9): a campaign page hands the compose page a queue of pitches in the URL, one at a time. An item is a
 * pitch id, or `pitchId~threadDocId` for a follow-up that replies in that thread. After Send (or Skip) the compose page opens
 * the next one; after the last it goes back to the campaign.
 */
export interface QueueItem { pitchId: string; threadId?: string }

const SAFE = /^[\w-]+$/;
export const encodeQueue = (items: readonly QueueItem[]) => items.map((i) => (i.threadId ? `${i.pitchId}~${i.threadId}` : i.pitchId)).join(",");
export function decodeQueue(s: string | null | undefined): QueueItem[] {
  return (s ?? "").split(",").flatMap((part) => {
    const [pitchId, threadId] = part.split("~");
    if (!pitchId || !SAFE.test(pitchId) || (threadId !== undefined && !SAFE.test(threadId))) return [];
    return [{ pitchId, ...(threadId ? { threadId } : {}) }];
  });
}
/** The compose page for item `at` of the queue; null past the end. `back` is where the queue started (a campaign page). */
export function queueHref(items: readonly QueueItem[], at: number, back: string): string | null {
  const it = items[at];
  if (!it) return null;
  const q = new URLSearchParams({ ...(it.threadId ? { thread: it.threadId } : {}), pitch: it.pitchId, queue: encodeQueue(items), at: String(at), back });
  return `/booking/email/new?${q.toString()}`;
}
