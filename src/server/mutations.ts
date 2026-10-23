/**
 * Idempotency for double taps and retries. A command may carry `_meta.clientMutationId`; the first call claims
 * `mutations/{id}`, runs, and stores its result. A repeat returns that stored result instead of writing twice.
 * Bookkeeping, not business data: written with firebase-admin directly (no history). `expiresAt` is 7 days out; set a
 * Firestore TTL policy on mutations.expiresAt (see firestore.indexes.json) to have old ones deleted.
 */
import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "./admin";
import { AppError } from "./errors";

export const MUTATION_TTL_MS = 7 * 86_400_000;
export const MUTATION_ID = /^[A-Za-z0-9_-]{8,100}$/;

export interface StoredMutation { result: unknown; runId: string; revs: Record<string, number> }
const ref = (id: string) => firestore().collection("mutations").doc(id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `null` = you own it, go ahead and run. Otherwise the stored outcome of the first call. */
export async function claimMutation(uid: string, id: string, command: string, now = new Date()): Promise<StoredMutation | null> {
  const doc = { uid, command, status: "pending", createdAt: Timestamp.fromDate(now), expiresAt: Timestamp.fromMillis(now.getTime() + MUTATION_TTL_MS) };
  for (let tries = 0; tries < 40; tries++) {
    try {
      await ref(id).create(doc);
      return null;
    } catch (e) {
      if ((e as { code?: number }).code !== 6) throw e; // 6 = ALREADY_EXISTS
    }
    const snap = await ref(id).get();
    const d = snap.data();
    if (!d) continue; // released between our create and get
    if (d.uid !== uid || d.command !== command) throw new AppError("mutation_id_in_use", "That clientMutationId was used for something else", 409);
    if ((d.expiresAt as Timestamp).toMillis() < now.getTime()) { await ref(id).delete(); continue; }
    if (d.status === "done") return { result: d.result, runId: d.runId, revs: d.revs ?? {} };
    await sleep(250); // the first call is still running
  }
  throw new AppError("in_progress", "That change is still being saved", 409);
}

export async function completeMutation(id: string, out: StoredMutation): Promise<void> {
  await ref(id).update({ status: "done", result: JSON.parse(JSON.stringify(out.result ?? null)), runId: out.runId, revs: out.revs });
}
/** The call failed: let a retry run it again. */
export async function releaseMutation(id: string): Promise<void> {
  await ref(id).delete().catch(() => undefined);
}
