import { z } from "zod";
import { id, ts } from "./common";

/** Where the user was when they spoke. `route` is a named route (src/lib/routes.ts) or the raw pathname when unnamed. */
export const PageContext = z.strictObject({
  route: z.string().min(1).max(200),
  recordKind: z.string().max(60).optional(),
  recordId: z.string().max(200).optional(),
});
export type PageContext = z.infer<typeof PageContext>;

/** One tool step shown in the chat: a plain action line, or a page Roadie opened. */
export const AssistantAction = z.strictObject({
  kind: z.enum(["action", "navigate"]),
  label: z.string(),
  route: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
});
export type AssistantAction = z.infer<typeof AssistantAction>;

/** Chat transcripts are not business data: written by src/server/assistant/threads.ts, outside db.ts and history/undo. */
export const AssistantThread = z.strictObject({
  ownerUid: id,
  startedAt: ts,
  lastActiveAt: ts,
  startedOnRoute: z.string(),
});
export type AssistantThread = z.infer<typeof AssistantThread>;

export const AssistantMessage = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  actions: z.array(AssistantAction),
  pageContext: PageContext,
  at: ts,
});
export type AssistantMessage = z.infer<typeof AssistantMessage>;

export const ChatRequest = z.strictObject({
  threadId: id.optional(),
  message: z.string().trim().min(1).max(4000),
  pageContext: PageContext,
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/** Server-sent events from POST /api/assistant/chat. */
export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "action"; label: string }
  | { type: "navigate"; route: string; params: Record<string, string>; label: string }
  | { type: "done"; threadId: string; messageId?: string }
  | { type: "error"; message: string };

export const AssistantWidth = z.enum(["full", "narrow"]);
export const AssistantPrefs = z.strictObject({ width: AssistantWidth.optional(), threadId: id.optional() });
