import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../admin";
import type { AssistantAction, PageContext } from "@/schema/assistant";

// Chat transcripts are not business data: written with firebase-admin directly, so they never reach history/undo (like touchLastUsed in db.ts).
const threads = () => firestore().collection("assistantThreads");

export interface Turn { role: "user" | "assistant"; text: string }

/** The caller's own thread, or null when it is missing or belongs to someone else. */
export async function loadHistory(uid: string, threadId: string, limit = 20): Promise<Turn[] | null> {
  const ref = threads().doc(threadId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.ownerUid !== uid) return null;
  const msgs = await ref.collection("messages").orderBy("at", "desc").limit(limit).get();
  return msgs.docs.reverse().map((d) => ({ role: d.data().role, text: d.data().text }));
}

export const newThreadId = () => threads().doc().id;

/** Persist one exchange (user message + Roadie's reply) and bump the thread. Creates the thread on first use. */
export async function saveTurn(a: {
  uid: string; threadId: string; isNew: boolean; pageContext: PageContext;
  userText: string; replyText: string; actions: AssistantAction[]; userAt: Date;
}): Promise<{ assistantMessageId: string }> {
  const ref = threads().doc(a.threadId);
  const batch = firestore().batch();
  const now = Timestamp.now();
  if (a.isNew) batch.set(ref, { ownerUid: a.uid, startedAt: Timestamp.fromDate(a.userAt), lastActiveAt: now, startedOnRoute: a.pageContext.route });
  else batch.update(ref, { lastActiveAt: now });
  const user = ref.collection("messages").doc();
  const reply = ref.collection("messages").doc();
  batch.set(user, { role: "user", text: a.userText, actions: [], pageContext: a.pageContext, at: Timestamp.fromDate(a.userAt) });
  // Never earlier than the user's message, so ordering by `at` is stable.
  const replyAt = Timestamp.fromMillis(Math.max(now.toMillis(), a.userAt.getTime() + 1));
  batch.set(reply, { role: "assistant", text: a.replyText, actions: a.actions, pageContext: a.pageContext, at: replyAt });
  await batch.commit();
  return { assistantMessageId: reply.id };
}
