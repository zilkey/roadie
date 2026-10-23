/**
 * Drafts of "new X" forms, per user, at users/{uid}/drafts/{draftId}. Written with firebase-admin directly, NOT through db.ts:
 * a draft is a scratch copy of what someone is typing, not business data, so it gets no history entry and no undo.
 * Owner-only read by rules; client writes are denied. Drafts untouched for 30 days are ignored and deleted on the next save.
 */
import { Timestamp } from "firebase-admin/firestore";
import { DRAFT_TTL_MS, draftId, type DraftSaveInput } from "@/schema/drafts";
import { firestore } from "./admin";

const col = (uid: string) => firestore().collection("users").doc(uid).collection("drafts");

export async function saveDraft(uid: string, input: DraftSaveInput, now = new Date()): Promise<{ draftId: string; updatedAt: number }> {
  const id = draftId(input.kind, input.contextKey);
  const ref = col(uid).doc(id);
  const prev = await ref.get();
  const cutoff = Timestamp.fromMillis(now.getTime() - DRAFT_TTL_MS);
  const live = prev.exists && (prev.data()!.updatedAt as Timestamp).toMillis() >= cutoff.toMillis();
  await ref.set({
    kind: input.kind, contextKey: input.contextKey, values: input.values, route: input.route, title: input.title,
    createdAt: live ? prev.data()!.createdAt : Timestamp.fromDate(now), updatedAt: Timestamp.fromDate(now),
  });
  const old = await col(uid).where("updatedAt", "<", cutoff).limit(50).get();
  await Promise.all(old.docs.filter((d) => d.id !== id).map((d) => d.ref.delete()));
  return { draftId: id, updatedAt: now.getTime() };
}

export async function discardDraft(uid: string, id: string): Promise<void> {
  await col(uid).doc(id).delete();
}

/** Newest first; drafts older than 30 days are not returned. */
export async function listDrafts(uid: string, now = new Date()) {
  const snap = await col(uid).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { kind: string; contextKey: string; values: Record<string, unknown>; route: string; title: string; updatedAt: Timestamp; createdAt: Timestamp }) }))
    .filter((d) => now.getTime() - d.updatedAt.toMillis() <= DRAFT_TTL_MS)
    .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis());
}
