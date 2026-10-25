import { z } from "zod";
import { id, ts } from "./common";

/** Where the user was when they spoke. `route` is a named route (src/lib/routes.ts) or the raw pathname when unnamed. */
export const PageContext = z.strictObject({
  route: z.string().min(1).max(200),
  recordKind: z.string().max(60).optional(),
  recordId: z.string().max(200).optional(),
  /** The tab in view when the page has tabs in its URL: the Shows page's #played, a show's ?tab=setlist. */
  tab: z.string().max(40).optional(),
});
export type PageContext = z.infer<typeof PageContext>;

/** One tool step shown in the chat: a plain action line, or a page Roadie opened. */
export const AssistantAction = z.strictObject({
  /** link: a button the person taps to open a page (nothing opens by itself). */
  kind: z.enum(["action", "navigate", "link", "readback", "confirm"]),
  label: z.string(),
  route: z.string().optional(),
  params: z.record(z.string(), z.string()).optional(),
  /** readback: the run this line is about (Undo reverses it). */
  runId: z.string().optional(),
  /** readback: set once the run was undone. */
  undone: z.boolean().optional(),
  /** confirm: the stored pending action. The input itself never leaves the server. */
  pendingId: z.string().optional(),
  command: z.string().optional(),
  /** confirm: pending until the person answers. */
  status: z.enum(["pending", "done", "canceled", "expired", "failed"]).optional(),
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
  | { type: "link"; route: string; params: Record<string, string>; label: string }
  | { type: "readback"; label: string; runId: string }
  | { type: "confirm"; pendingId: string; command: string; summary: string }
  | { type: "done"; threadId: string; messageId?: string }
  | { type: "error"; message: string };

/** POST /api/assistant/confirm: answer a confirm card. The server runs the stored input, never anything sent here. */
export const ConfirmRequest = z.strictObject({ threadId: id, pendingId: id, decision: z.enum(["yes", "cancel"]) });
export type ConfirmRequest = z.infer<typeof ConfirmRequest>;
/** POST /api/assistant/undo: the Undo on a read-back line. Only runs this thread made. */
export const UndoRequest = z.strictObject({ threadId: id, runId: z.string().min(1).max(100) });
export type UndoRequest = z.infer<typeof UndoRequest>;

export const AssistantWidth = z.enum(["full", "narrow"]);
export const AssistantPrefs = z.strictObject({ width: AssistantWidth.optional(), threadId: id.optional() });
