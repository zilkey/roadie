import { authenticate } from "../commands/dispatch";
import { db } from "../db";
import { newRunId } from "../ctx";
import { AppError, invalid } from "../errors";
import { ChatRequest, type AssistantAction, type AssistantEvent, type ToolTrace } from "@/schema/assistant";
import { getChatFlow } from "./flow";
import type { Session } from "./run";
import { ensureThread, loadHistory, newMessageId, newThreadId, saveTurn } from "./threads";

const sse = (e: AssistantEvent) => `data: ${JSON.stringify(e)}\n\n`;
export const DROPPED = "Roadie dropped a cable. Try again.";

/** POST /api/assistant/chat: admins only. Errors before the stream starts are plain JSON; later ones are `error` events. */
export async function handleChat(authHeader: string | null, body: unknown, artistHeader?: string | null): Promise<Response> {
  try {
    const ctx = await authenticate(authHeader, artistHeader);
    if (ctx.role !== "admin") throw new AppError("forbidden", "Roadie is for admins", 403);
    const parsed = ChatRequest.safeParse(body ?? {});
    if (!parsed.success) throw invalid(parsed.error);
    const req = parsed.data;

    // A missing or foreign thread id just starts a fresh thread.
    const history = req.threadId ? await loadHistory(ctx.uid, req.threadId) : null;
    const threadId = history ? req.threadId! : newThreadId();
    const userAt = new Date();
    const enc = new TextEncoder();
    const user = await db.get("users", ctx.uid);
    await ensureThread({ uid: ctx.uid, threadId, pageContext: req.pageContext, at: userAt });
    // One run id per user message: every write Roadie makes for it shares it, so one Undo reverses the message.
    const session: Omit<Session, "model"> = {
      uid: ctx.uid, role: ctx.role, ...(ctx.artistId ? { artistId: ctx.artistId } : {}), musicianId: ctx.musicianId, name: (user?.name as string | undefined) ?? "Someone",
      threadId, runId: newRunId(), replyId: newMessageId(),
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        const send = (e: AssistantEvent) => c.enqueue(enc.encode(sse(e)));
        // A failed reply is saved too, with the person's message, so a retry knows what they asked for.
        const save = (text: string, actions: AssistantAction[], failed: boolean, trace: ToolTrace[] = []) => saveTurn({
          threadId, replyId: session.replyId, pageContext: req.pageContext,
          userText: req.message, replyText: failed ? [text, DROPPED].filter(Boolean).join(" ") : text, actions, userAt, failed, trace,
        });
        try {
          const flow = await getChatFlow();
          const { stream: chunks, output } = flow.stream({ message: req.message, history: history ?? [], pageContext: req.pageContext, session });
          for await (const e of chunks as AsyncIterable<AssistantEvent>) send(e);
          const out = (await output) as { text: string; actions: AssistantAction[]; failed?: boolean; trace?: ToolTrace[] };
          const { assistantMessageId } = await save(out.text, out.actions, !!out.failed, out.trace);
          send(out.failed ? { type: "error", message: DROPPED, threadId, messageId: assistantMessageId } : { type: "done", threadId, messageId: assistantMessageId });
        } catch (e) {
          console.error(e);
          const saved = await save("", [], true).catch((err) => { console.error(err); return null; });
          send({ type: "error", message: DROPPED, threadId, ...(saved ? { messageId: saved.assistantMessageId } : {}) });
        } finally {
          c.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store, no-transform" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json(e.toJSON(), { status: e.status });
    console.error(e);
    return Response.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
  }
}
