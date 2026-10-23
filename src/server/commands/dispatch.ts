import { z } from "zod";
import { adminAuth } from "../admin";
import { newRunId, type Ctx } from "../ctx";
import { db } from "../db";
import { AppError, invalid } from "../errors";
import { completeMutation, claimMutation, releaseMutation, MUTATION_ID } from "../mutations";
import { DraftPath } from "@/schema/drafts";
import { clearDraft } from "../drafts";
import { registry } from "./registry";

/** Optional envelope next to a command's own input: `{...input, _meta: {...}}`. Stripped before the command's schema sees it. */
const Meta = z.strictObject({
  /** Repeats with the same id return the first call's result instead of writing again. */
  clientMutationId: z.string().regex(MUTATION_ID).optional(),
  /** The rev of document `input.id` the caller last saw; refuse to overwrite fields changed since. */
  baseRev: z.number().int().min(0).optional(),
  /** Autosave patch: may fold into the previous history entry (see Writer.update). */
  autosave: z.boolean().optional(),
  /** Path of the unsubmitted draft to delete after the command succeeds (create forms): "expenses", "venues/{id}/contacts". */
  clearDraft: DraftPath.optional(),
});

/** Verify the Bearer ID token and build the request context. The users doc must still be live. */
export async function authenticate(authHeader: string | null): Promise<Ctx> {
  const m = /^Bearer (.+)$/.exec(authHeader ?? "");
  if (!m) throw new AppError("unauthenticated", "Missing bearer token", 401);
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(m[1]);
  } catch {
    throw new AppError("unauthenticated", "Invalid or expired token", 401);
  }
  const role = decoded.role;
  if (role !== "admin" && role !== "member") throw new AppError("forbidden", "No role on this account", 403);
  const user = await db.get("users", decoded.uid);
  if (!user || user.deletedAt || user.role !== role) throw new AppError("forbidden", "Account is not active", 403);
  return { uid: decoded.uid, role, musicianId: decoded.musicianId as string | undefined, via: "app", runId: newRunId() };
}

export interface Executed { result: unknown; runId: string; revs: Record<string, number>; repeated?: boolean }

/**
 * The one way into the command layer once the caller is known: role check, `_meta`, validation, idempotency, run,
 * draft clearing. The HTTP route and Roadie (`src/server/assistant/run.ts`) both use it. Throws AppError.
 */
export async function execute(ctx: Ctx, name: string, body: unknown): Promise<Executed> {
  const cmd = registry[name];
  if (!cmd) throw new AppError("unknown_command", `No command named ${name}`, 404);
  if (!cmd.roles.includes(ctx.role)) throw new AppError("forbidden", `Role ${ctx.role} may not run ${name}`, 403);
  const { _meta, ...input } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const meta = Meta.safeParse(_meta ?? {});
  if (!meta.success) throw invalid(meta.error);
  const parsed = cmd.input.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error);
  const m = meta.data;
  if (m.autosave) ctx.autosave = true;
  if (m.baseRev !== undefined && typeof input.id === "string") ctx.baseRev = { id: input.id, rev: m.baseRev };
  ctx.touched = {};
  if (m.clientMutationId) {
    const prior = await claimMutation(ctx.uid, m.clientMutationId, name);
    if (prior) return { ...(prior as Executed), repeated: true };
  }
  let out: Executed;
  try {
    const result = await cmd.run(ctx, parsed.data);
    out = { result, runId: ctx.runId, revs: ctx.touched as Record<string, number> };
  } catch (e) {
    if (m.clientMutationId) await releaseMutation(m.clientMutationId);
    throw e;
  }
  if (m.clientMutationId) await completeMutation(m.clientMutationId, out);
  if (m.clearDraft) await clearDraft(ctx.uid, m.clearDraft).catch(() => undefined);
  return out;
}

export async function dispatch(name: string, authHeader: string | null, body: unknown): Promise<{ status: number; json: unknown }> {
  try {
    const ctx = await authenticate(authHeader);
    return { status: 200, json: await execute(ctx, name, body) };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: e.toJSON() };
    console.error(e);
    return { status: 500, json: { error: { code: "internal", message: "Something went wrong" } } };
  }
}
