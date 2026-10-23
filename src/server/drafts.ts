/**
 * Unsubmitted drafts, top level at unsubmittedDrafts/{uid}__{path}. Written with firebase-admin directly, NOT through db.ts:
 * a draft is scratch (what someone has typed but not submitted), so it gets no history entry and no undo. Last write wins:
 * no merge, no timestamp check. Owner-only read by rules; client writes are denied. `expiresAt` is a TTL field (30 days).
 */
import { Timestamp } from "firebase-admin/firestore";
import { DRAFT_TTL_MS, draftDocId, type DraftSaveInput } from "@/schema/drafts";
import { firestore } from "./admin";

const col = () => firestore().collection("unsubmittedDrafts");

export async function saveDraft(uid: string, input: DraftSaveInput, now = new Date()): Promise<{ path: string; updatedAt: number }> {
  await col().doc(draftDocId(uid, input.path)).set({
    uid, path: input.path, values: input.values, route: input.route, title: input.title, ...(input.rev !== undefined && { rev: input.rev }),
    updatedAt: Timestamp.fromDate(now), expiresAt: Timestamp.fromMillis(now.getTime() + DRAFT_TTL_MS),
  });
  return { path: input.path, updatedAt: now.getTime() };
}

export async function clearDraft(uid: string, path: string): Promise<void> {
  await col().doc(draftDocId(uid, path)).delete();
}

/** Newest first. Expired ones (TTL deletes lag by up to a day) are not returned. */
export async function listDrafts(uid: string, now = new Date()) {
  const snap = await col().where("uid", "==", uid).get();
  return snap.docs
    .map((d) => d.data() as { path: string; values: Record<string, unknown>; route: string; title: string; updatedAt: Timestamp; expiresAt: Timestamp })
    .filter((d) => d.expiresAt.toMillis() > now.getTime())
    .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis());
}
