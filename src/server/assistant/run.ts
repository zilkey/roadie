/**
 * Roadie's way into the command layer: dispatch's `execute`, the same gate the HTTP route uses, as the person typing:
 * the command must exist, the caller's role must be on it, the input must validate. Then the command runs with a Ctx
 * signed `via: "assistant"`, so history records who, which assistant, which model and which conversation.
 */
import { execute } from "../commands/dispatch";
import type { Ctx, Role } from "../ctx";
import { newRunId } from "../ctx";

export interface Session {
  uid: string; role: Role; musicianId?: string; name: string;
  /** The artist the conversation is about (the page the admin is on). Becomes `ctx.artistId`. */
  artistId?: string;
  /** The conversation. Becomes `ctx.sessionId`. */
  threadId: string;
  /** One per user message. Every write in the message shares it, so one Undo reverses the message. */
  runId: string;
  /** The assistant message this turn will be saved as (confirm cards and read-backs point at it). */
  replyId: string;
  model: string;
  /** Injectable clock (tests). */
  now?: Date;
  pageContext?: { route: string; recordKind?: string; recordId?: string; tab?: string };
}

export const ROADIE = "Roadie";

/** A Ctx for a Roadie write. `via` is "app" only for a button the person tapped (Undo) rather than something Roadie decided. */
export function makeCtx(s: Session, over: { runId?: string; via?: "assistant" | "app" } = {}): Ctx {
  const via = over.via ?? "assistant";
  return {
    uid: s.uid, role: s.role, ...(s.artistId ? { artistId: s.artistId } : {}), musicianId: s.musicianId, via, runId: over.runId ?? s.runId, now: s.now,
    ...(via === "assistant" ? { sessionId: s.threadId, client: { name: ROADIE, model: s.model } } : {}),
  };
}

export const newRun = newRunId;

/** Run a registry command through dispatch's `execute`, as this ctx. `wrote` is true when the command changed any document. */
export async function runAs(ctx: Ctx, name: string, input: unknown): Promise<{ result: unknown; runId: string; wrote: boolean }> {
  const out = await execute(ctx, name, input ?? {});
  return { result: out.result, runId: out.runId, wrote: Object.keys(out.revs ?? {}).length > 0 };
}
