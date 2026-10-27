import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../admin";
import { AppError } from "../errors";
import type { AssistantAction, CardField, PageContext } from "@/schema/assistant";

// Chat transcripts are not business data: written with firebase-admin directly, so they never reach history/undo (like touchLastUsed in db.ts).
const threads = () => firestore().collection("assistantThreads");

export interface Turn { role: "user" | "assistant"; text: string }

/** The caller's own thread, or null when it is missing or belongs to someone else. */
export async function loadHistory(uid: string, threadId: string, limit = 20): Promise<Turn[] | null> {
  const ref = threads().doc(threadId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.ownerUid !== uid) return null;
  const msgs = await ref.collection("messages").orderBy("at", "desc").limit(limit).get();
  // A reply that only acted (a write, a navigate) is saved with no text; Gemini rejects an empty text part, which
  // broke every later message in the thread. Its action labels stand in for it, and anything still empty is left out.
  return msgs.docs.reverse().flatMap((d): Turn[] => {
    const m = d.data();
    const acts = (m.actions as { kind?: string; label?: string }[] | undefined) ?? [];
    const labels = acts.map((a) => a.label).filter(Boolean);
    const text = String(m.text ?? "").trim() || labels.join(". ");
    // A reply that failed: say so plainly, so the next message picks the request back up instead of thinking it's done.
    if (m.failed) {
      const changed = acts.filter((a) => a.kind === "readback").map((a) => a.label);
      return [{ role: m.role, text: `${text} [This reply failed partway. ${changed.length ? `Only these changes were made: ${changed.join("; ")}.` : "Nothing was changed."} The request before it is not done.]` }];
    }
    return text ? [{ role: m.role, text }] : [];
  });
}

export const newThreadId = () => threads().doc().id;

/** Make sure the thread doc exists before the flow runs, so runs and pending actions have somewhere to live. */
export async function ensureThread(a: { uid: string; threadId: string; pageContext: PageContext; at: Date }) {
  const ref = threads().doc(a.threadId);
  if ((await ref.get()).exists) return;
  await ref.set({ ownerUid: a.uid, startedAt: Timestamp.fromDate(a.at), lastActiveAt: Timestamp.now(), startedOnRoute: a.pageContext.route, runs: [] });
}

/** Persist one exchange (user message + Roadie's reply) and bump the thread. */
export async function saveTurn(a: {
  threadId: string; pageContext: PageContext; replyId?: string;
  userText: string; replyText: string; actions: AssistantAction[]; userAt: Date;
  /** The model call failed partway: replyText and actions are what happened before it did. */
  failed?: boolean;
}): Promise<{ assistantMessageId: string }> {
  const ref = threads().doc(a.threadId);
  const batch = firestore().batch();
  const now = Timestamp.now();
  batch.update(ref, { lastActiveAt: now });
  const user = ref.collection("messages").doc();
  const reply = ref.collection("messages").doc(a.replyId ?? threads().doc().id);
  batch.set(user, { role: "user", text: a.userText, actions: [], pageContext: a.pageContext, at: Timestamp.fromDate(a.userAt) });
  // Never earlier than the user's message, so ordering by `at` is stable.
  const replyAt = Timestamp.fromMillis(Math.max(now.toMillis(), a.userAt.getTime() + 1));
  batch.set(reply, { role: "assistant", text: a.replyText, actions: a.actions, pageContext: a.pageContext, at: replyAt, ...(a.failed ? { failed: true } : {}) });
  await batch.commit();
  return { assistantMessageId: reply.id };
}

export const newMessageId = () => threads().doc().id;

// ---------- runs (what Roadie changed in this thread; the only runs it may undo) ----------

export interface ThreadRun { runId: string; messageId: string; at: number; label: string; undone?: boolean; kind?: "write" | "undo" }

export async function getRuns(threadId: string): Promise<ThreadRun[]> {
  return ((await threads().doc(threadId).get()).data()?.runs as ThreadRun[] | undefined) ?? [];
}

/** Keep a run id on the thread doc. Atomic, so two steps in one message can't lose each other. */
export async function recordRun(threadId: string, run: ThreadRun) {
  await threads().doc(threadId).update({ runs: FieldValue.arrayUnion(run) });
}

export async function markRunUndone(threadId: string, runId: string) {
  const ref = threads().doc(threadId);
  await firestore().runTransaction(async (t) => {
    const runs = ((await t.get(ref)).data()?.runs as ThreadRun[] | undefined) ?? [];
    t.update(ref, { runs: runs.map((r) => (r.runId === runId ? { ...r, undone: true } : r)) });
  });
}

// ---------- pending actions (confirm cards) ----------

/** A confirm card that nobody answered stops working after this long. */
export const PENDING_TTL_MS = 10 * 60 * 1000;
export type PendingStatus = "pending" | "done" | "canceled" | "expired" | "failed";
export interface Pending {
  id: string; command: string; input: unknown; summary: string; messageId: string; status: PendingStatus; createdAt: number; expiresAt: number; runId?: string;
  /** The card's rows. */
  fields?: CardField[];
  /** Dropdowns the person must answer before Yes runs: the input path and the values it may take. */
  picks?: { path: string; options: string[] }[];
}
const pendings = (threadId: string) => threads().doc(threadId).collection("pending");

export async function createPending(threadId: string, p: Omit<Pending, "id" | "status" | "createdAt" | "expiresAt">, now = new Date()): Promise<Pending> {
  const ref = pendings(threadId).doc();
  const doc: Pending = { ...p, id: ref.id, status: "pending", createdAt: now.getTime(), expiresAt: now.getTime() + PENDING_TTL_MS };
  await ref.set(doc);
  return doc;
}
export async function getPending(threadId: string, id: string): Promise<Pending | null> {
  const snap = await pendings(threadId).doc(id).get();
  return snap.exists ? (snap.data() as Pending) : null;
}
export async function setPending(threadId: string, id: string, patch: Partial<Pending>) {
  await pendings(threadId).doc(id).update(patch);
}
/** A live pending action for the same command and input in this thread (the model asking twice gets the same card). */
export async function findOpenPending(threadId: string, command: string, input: unknown, now = new Date()): Promise<Pending | null> {
  const snap = await pendings(threadId).where("status", "==", "pending").get();
  const key = JSON.stringify(input);
  return snap.docs.map((d) => d.data() as Pending).find((p) => p.command === command && p.expiresAt > now.getTime() && JSON.stringify(p.input) === key) ?? null;
}

/** Change one entry of a saved message's actions (a confirm card's status, a read-back's undone flag). */
export async function patchMessageAction(threadId: string, messageId: string, match: (a: AssistantAction) => boolean, patch: Partial<AssistantAction>) {
  const ref = threads().doc(threadId).collection("messages").doc(messageId);
  await firestore().runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return;
    const actions = (snap.data()!.actions as AssistantAction[]).map((a) => (match(a) ? { ...a, ...patch } : a));
    t.update(ref, { actions });
  });
}

/** Add a Roadie message to the thread (the answer to a confirm card or an Undo tap). */
export async function addAssistantMessage(a: { threadId: string; text: string; actions: AssistantAction[]; pageContext: PageContext; id?: string }): Promise<string> {
  const ref = threads().doc(a.threadId).collection("messages").doc(a.id ?? newMessageId());
  await ref.set({ role: "assistant", text: a.text, actions: a.actions, pageContext: a.pageContext, at: Timestamp.now() });
  await threads().doc(a.threadId).update({ lastActiveAt: Timestamp.now() });
  return ref.id;
}
export async function ownerOf(threadId: string): Promise<string | null> {
  const snap = await threads().doc(threadId).get();
  return snap.exists ? (snap.data()!.ownerUid as string) : null;
}

/** Claim a pending action for running: only the first caller gets it, and only while it is live. Throws AppError otherwise. */
export async function claimPending(threadId: string, id: string, now = new Date()): Promise<Pending> {
  const ref = pendings(threadId).doc(id);
  const got = await firestore().runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new AppError("not_found", "No such ask", 404);
    const p = snap.data() as Pending;
    if (p.status !== "pending") throw new AppError("already_answered", `That ask was already ${p.status}`, 409);
    if (p.expiresAt <= now.getTime()) { t.update(ref, { status: "expired" }); return { p, expired: true }; }
    t.update(ref, { status: "done" });
    return { p, expired: false };
  });
  if (got.expired) throw new AppError("expired", "That ask expired. Ask me again.", 410, undefined, { pendingId: id, messageId: got.p.messageId });
  return got.p;
}
