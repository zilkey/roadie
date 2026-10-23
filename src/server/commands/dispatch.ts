import { z } from "zod";
import { adminAuth } from "../admin";
import { newRunId, type Ctx } from "../ctx";
import { db } from "../db";
import { AppError, invalid } from "../errors";
import { completeMutation, claimMutation, releaseMutation, MUTATION_ID } from "../mutations";
import { discardDraft } from "../drafts";
import { registry } from "./registry";

/** Optional envelope next to a command's own input: `{...input, _meta: {...}}`. Stripped before the command's schema sees it. */
const Meta = z.strictObject({
  /** Repeats with the same id return the first call's result instead of writing again. */
  clientMutationId: z.string().regex(MUTATION_ID).optional(),
  /** The rev of document `input.id` the caller last saw; refuse to overwrite fields changed since. */
  baseRev: z.number().int().min(0).optional(),
  /** Autosave patch: may fold into the previous history entry (see Writer.update). */
  autosave: z.boolean().optional(),
  /** Delete this draft after the command succeeds (create forms). */
  clearDraft: z.string().min(1).max(150).optional(),
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

export async function dispatch(name: string, authHeader: string | null, body: unknown): Promise<{ status: number; json: unknown }> {
  try {
    const cmd = registry[name];
    const ctx = await authenticate(authHeader);
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
      if (prior) return { status: 200, json: { ...prior, repeated: true } };
    }
    let out;
    try {
      const result = await cmd.run(ctx, parsed.data);
      out = { result, runId: ctx.runId, revs: ctx.touched };
    } catch (e) {
      if (m.clientMutationId) await releaseMutation(m.clientMutationId);
      throw e;
    }
    if (m.clientMutationId) await completeMutation(m.clientMutationId, out);
    if (m.clearDraft) await discardDraft(ctx.uid, m.clearDraft).catch(() => undefined);
    return { status: 200, json: out };
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: e.toJSON() };
    console.error(e);
    return { status: 500, json: { error: { code: "internal", message: "Something went wrong" } } };
  }
}
