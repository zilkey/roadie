import { spend } from "../usage";
import { assertWritable } from "../layout";
import { authenticate } from "../commands/dispatch";
import { setOpenThread } from "../commands/assistant";
import { db } from "../db";
import { newRunId } from "../ctx";
import { AppError, invalid } from "../errors";
import { ChatRequest, StopRequest, type AssistantAction, type AssistantEvent, type ToolTrace } from "@/schema/assistant";
import { getChatFlow } from "./flow";
import type { Session } from "./run";
import { clearStop, ensureThread, replyIdFor, requestStop, saveTurn, stopRequested, threadFor, threadOf } from "./threads";

const sse = (e: AssistantEvent) => `data: ${JSON.stringify(e)}\n\n`;
export const DROPPED = "Roadie dropped a cable. Try again.";

/**
 * POST /api/assistant/chat: admins only. Errors before the stream starts are plain JSON; later ones are `error` events.
 * `signal` is the request's: when the person taps Stop the browser drops the stream, the flow stops after the step it is
 * on, and the turn is saved as stopped with whatever was already done.
 */
/** How often a running turn looks for a Stop sent as its own request. */
const STOP_POLL_MS = 750;

export async function handleChat(authHeader: string | null, body: unknown, artistHeader?: string | null, signal?: AbortSignal): Promise<Response> {
  try {
    const ctx = await authenticate(authHeader, artistHeader);
    if (ctx.role !== "admin") throw new AppError("forbidden", "Roadie is for admins", 403);
    const parsed = ChatRequest.safeParse(body ?? {});
    if (!parsed.success) throw invalid(parsed.error);
    // Phase 10's copy window: no new turn (its transcript and anything it would change can't be written).
    await assertWritable();
    // One Roadie message a day's limit counts (tenancy phase 9): before any write, so a refused message leaves nothing behind.
    await spend(ctx, "roadieMessages");
    const req = parsed.data;

    // The caller's own thread, a new one under the id the browser picked, or (missing or foreign) a fresh one.
    const { threadId, history } = await threadFor(ctx.uid, req.threadId, ctx.artistId);
    const userAt = new Date();
    const enc = new TextEncoder();
    const user = await db.get(ctx, "users", ctx.uid);
    await ensureThread({ uid: ctx.uid, threadId, pageContext: req.pageContext, at: userAt, artistId: ctx.artistId, via: ctx.via });
    // A new conversation is the one the panel opens from now on. Recorded here, by the request that started it, so a
    // reload straight after sending (or a Stop) still finds it, whatever became of the browser's own save.
    if (!history) await setOpenThread(ctx, threadId, req.sentAt ?? userAt.getTime()).catch((e) => console.error(e));
    // One run id per user message: every write Roadie makes for it shares it, so one Undo reverses the message.
    const session: Omit<Session, "model"> = {
      uid: ctx.uid, role: ctx.role, artistId: ctx.artistId, musicianId: ctx.musicianId, name: (user?.name as string | undefined) ?? "Someone",
      threadId, runId: newRunId(), replyId: await replyIdFor(threadId, req.replyId), ...(req.voice ? { voice: true } : {}),
    };

    const stop = new AbortController();
    if (signal?.aborted) stop.abort();
    signal?.addEventListener("abort", () => stop.abort(), { once: true });
    // Stop also comes as its own request (POST /api/assistant/stop), which can even arrive first: a dropped stream
    // doesn't always reach the server (a dev server still compiling, a proxy in front of it). Checked now and while it runs.
    if (await stopRequested(ctx.uid, session.replyId)) stop.abort();
    const watch = setInterval(() => {
      void stopRequested(ctx.uid, session.replyId).then((s) => { if (s) stop.abort(); }).catch(() => undefined);
    }, STOP_POLL_MS);
    const done = () => { clearInterval(watch); void clearStop(session.replyId); };
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        // Once the person has stopped (the stream is gone), events have nowhere to go; the turn is still saved.
        const send = (e: AssistantEvent) => { if (!closed) try { c.enqueue(enc.encode(sse(e))); } catch { closed = true; } };
        // A failed reply is saved too, with the person's message, so a retry knows what they asked for.
        const save = (text: string, actions: AssistantAction[], how: { failed?: boolean; stopped?: boolean }, trace: ToolTrace[] = []) => saveTurn({
          threadId, replyId: session.replyId, pageContext: req.pageContext,
          userText: req.message, replyText: how.failed ? [text, DROPPED].filter(Boolean).join(" ") : text, actions, userAt, ...how, trace,
        });
        // First, where this turn will be saved: a Stop before anything else arrives still lands in the right conversation.
        send({ type: "start", threadId, messageId: session.replyId });
        try {
          const flow = await getChatFlow();
          const { stream: chunks, output } = flow.stream({ message: req.message, history: history ?? [], pageContext: req.pageContext, session }, { abortSignal: stop.signal });
          for await (const e of chunks as AsyncIterable<AssistantEvent>) send(e);
          const out = (await output) as { text: string; actions: AssistantAction[]; failed?: boolean; stopped?: boolean; trace?: ToolTrace[] };
          const { assistantMessageId } = await save(out.text, out.actions, { ...(out.failed ? { failed: true } : {}), ...(out.stopped ? { stopped: true } : {}) }, out.trace);
          send(out.failed ? { type: "error", message: DROPPED, threadId, messageId: assistantMessageId } : { type: "done", threadId, messageId: assistantMessageId });
        } catch (e) {
          // Stopped before the flow could say what it did (it rejects on abort): nothing is known to have changed.
          if (stop.signal.aborted) { await save("", [], { stopped: true }).catch((err) => console.error(err)); return; }
          console.error(e);
          const saved = await save("", [], { failed: true }).catch((err) => { console.error(err); return null; });
          send({ type: "error", message: DROPPED, threadId, ...(saved ? { messageId: saved.assistantMessageId } : {}) });
        } finally {
          done();
          if (!closed) { closed = true; try { c.close(); } catch { /* already gone */ } }
        }
      },
      cancel() { closed = true; stop.abort(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}

/** POST /api/assistant/stop: the person tapped Stop. The turn (running, or not started yet) ends and is saved as stopped. */
export async function handleStop(authHeader: string | null, body: unknown, artistHeader?: string | null): Promise<Response> {
  try {
    const ctx = await authenticate(authHeader, artistHeader);
    if (ctx.role !== "admin") throw new AppError("forbidden", "Roadie is for admins", 403);
    const parsed = StopRequest.safeParse(body ?? {});
    if (!parsed.success) throw invalid(parsed.error);
    // A stop can arrive before the thread exists; once it does, it must be in this artist.
    const t = await threadOf(parsed.data.threadId);
    if (t && (t.ownerUid !== ctx.uid || t.artistId !== ctx.artistId)) throw new AppError("not_found", "No such conversation", 404);
    await requestStop(ctx.uid, parsed.data.threadId, parsed.data.replyId);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
