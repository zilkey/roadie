/**
 * Answering a confirm card, and the Undo on a read-back line. Both run server-side from what the server stored:
 * the pending action's command and input come from the thread, never from the request.
 */
import { authenticate } from "../commands/dispatch";
import { db } from "../db";
import { AppError, invalid } from "../errors";
import { newRunId, type Role } from "../ctx";
import { ConfirmRequest, UndoRequest } from "@/schema/assistant";
import { isEligible } from "./policy";
import { modelLabel } from "./ai";
import type { Session } from "./run";
import { runCommandTool, undoInThread } from "./tools";
import { addAssistantMessage, claimPending, getPending, newMessageId, ownerOf, patchMessageAction, setPending } from "./threads";

export interface Who { uid: string; role: Role; musicianId?: string; name: string }

/** The session for a write outside the chat stream (a confirmed card, an Undo tap). */
export function sessionFor(who: Who, threadId: string, replyId = newMessageId(), now?: Date): Session {
  return { ...who, threadId, runId: newRunId(), replyId, model: modelLabel(), now };
}

const HERE = { route: "home" };

async function requireOwner(who: Who, threadId: string) {
  if (who.role !== "admin") throw new AppError("forbidden", "Roadie is for admins", 403);
  if ((await ownerOf(threadId)) !== who.uid) throw new AppError("not_found", "No such conversation", 404);
}

export type Answer = { status: "done"; runId?: string; label?: string } | { status: "canceled" } | { status: "failed"; message: string };

/** Yes runs the stored command with the stored input as Roadie (`via: "assistant"`). Cancel discards it. Expired or answered cards refuse. */
export async function answerPending(who: Who, req: ConfirmRequest, now = new Date()): Promise<Answer> {
  await requireOwner(who, req.threadId);
  const card = (a: { kind: string; pendingId?: string }) => a.kind === "confirm" && a.pendingId === req.pendingId;
  const pending = await getPending(req.threadId, req.pendingId);
  if (!pending) throw new AppError("not_found", "No such ask", 404);

  if (req.decision === "cancel") {
    if (pending.status !== "pending") throw new AppError("already_answered", `That ask was already ${pending.status}`, 409);
    await setPending(req.threadId, req.pendingId, { status: "canceled" });
    await patchMessageAction(req.threadId, pending.messageId, card, { status: "canceled" });
    await addAssistantMessage({ threadId: req.threadId, text: "Okay. I left it alone.", actions: [], pageContext: HERE });
    return { status: "canceled" };
  }

  try {
    await claimPending(req.threadId, req.pendingId, now);
  } catch (e) {
    if (e instanceof AppError && e.code === "expired") await patchMessageAction(req.threadId, pending.messageId, card, { status: "expired" });
    throw e;
  }
  const resultId = newMessageId();
  const s = sessionFor(who, req.threadId, resultId, now);
  try {
    if (!isEligible(pending.command, who.role)) throw new AppError("not_allowed", `Roadie can't use ${pending.command}`, 403);
    const r = await runCommandTool(s, pending.command, pending.input, new Set());
    await setPending(req.threadId, req.pendingId, { status: "done", runId: r.runId });
    await patchMessageAction(req.threadId, pending.messageId, card, { status: "done" });
    await addAssistantMessage({
      id: resultId, threadId: req.threadId, text: "Done.", pageContext: HERE,
      actions: r.wrote ? [{ kind: "readback", label: r.label!, runId: r.runId }] : [],
    });
    return { status: "done", runId: r.wrote ? r.runId : undefined, label: r.label };
  } catch (e) {
    const message = e instanceof AppError ? e.message : "Something went wrong";
    if (!(e instanceof AppError)) console.error(e);
    await setPending(req.threadId, req.pendingId, { status: "failed" });
    await patchMessageAction(req.threadId, pending.messageId, card, { status: "failed" });
    await addAssistantMessage({ threadId: req.threadId, text: `Couldn't do that: ${message}`, actions: [], pageContext: HERE });
    return { status: "failed", message };
  }
}

/** Undo one of this conversation's runs. Anything else is refused. */
export async function undoRunOf(who: Who, req: UndoRequest): Promise<{ undone: number }> {
  await requireOwner(who, req.threadId);
  const u = await undoInThread(sessionFor(who, req.threadId), { runId: req.runId }, "app");
  return { undone: u.undone.length };
}

async function who(authHeader: string | null): Promise<Who> {
  const ctx = await authenticate(authHeader);
  if (ctx.role !== "admin") throw new AppError("forbidden", "Roadie is for admins", 403);
  const u = await db.get("users", ctx.uid);
  return { uid: ctx.uid, role: ctx.role, musicianId: ctx.musicianId, name: (u?.name as string | undefined) ?? "Someone" };
}

async function respond(f: () => Promise<unknown>): Promise<Response> {
  try { return Response.json(await f()); } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}

/** POST /api/assistant/confirm: admins only. */
export const handleConfirm = (authHeader: string | null, body: unknown) => respond(async () => {
  const w = await who(authHeader);
  const p = ConfirmRequest.safeParse(body ?? {}); // strict: there is no place to put input
  if (!p.success) throw invalid(p.error);
  return answerPending(w, p.data);
});

/** POST /api/assistant/undo: admins only. */
export const handleUndo = (authHeader: string | null, body: unknown) => respond(async () => {
  const w = await who(authHeader);
  const p = UndoRequest.safeParse(body ?? {});
  if (!p.success) throw invalid(p.error);
  return undoRunOf(w, p.data);
});

