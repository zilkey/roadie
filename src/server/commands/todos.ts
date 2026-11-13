import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { run, type Writer } from "../db";
import { AppError } from "../errors";
import { setTodoColumns, setTodoDismissed, setTodoOrder } from "../prefs";
import { TODO_CHECKLIST_KEY, TODO_COLUMN_KEY } from "@/lib/todos";

// To Dos › Our list (todos/{id}) and each admin's own view of the To Dos page (userPrefs/{uid}: todoOrder, todoColumns, todoDismissed).
// Admin-only for now, and not Roadie's (no "mcp").

const ROLES = ["admin"] as const;
const owner = z.string().min(1).nullable();

async function requireTodo(w: Writer, id: string) {
  const t = await w.get("todos", id);
  if (!t || t.deletedAt || (w.ctx.artistId && t.artistId !== w.ctx.artistId)) throw new AppError("not_found", "To do not found", 404);
  return t;
}
async function requireMusician(w: Writer, id: string) {
  const m = await w.get("musicians", id);
  if (!m || m.deletedAt) throw new AppError("not_found", "Musician not found", 404);
}
function artistOf(w: Writer) {
  if (!w.ctx.artistId) throw new AppError("invalid_input", "Which artist? Open one first", 400);
  return w.ctx.artistId;
}

export const todosAdd = defineCommand({
  name: "todos.add", roles: [...ROLES], description: "Add a to-do to To Dos › Our list (the band's own, not tied to a show or release), optionally assigned to a musician. pinned: true pins it (it shows in Pinned).",
  input: z.strictObject({ label: z.string().trim().min(1), ownerId: owner.optional(), pinned: z.boolean().optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    if (i.ownerId) await requireMusician(w, i.ownerId);
    const pin = i.pinned ? { pinnedAt: w.now.toDate().toISOString(), pinnedBy: ctx.uid } : {};
    return w.create("todos", { artistId: artistOf(w), label: i.label, done: false, ...(i.ownerId ? { ownerId: i.ownerId } : {}), ...pin });
  }),
});

export const todosEdit = defineCommand({
  name: "todos.edit", roles: [...ROLES], description: "Change an Our list to-do's text and/or who it's assigned to: ownerId a musician id, or null for unassigned. A field left out stays as it is.",
  // Each field is optional so the page's two inline edits (text, who) can't undo each other with a stale copy of the other.
  input: z.strictObject({ id: z.string().min(1), label: z.string().trim().min(1).optional(), ownerId: owner.optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireTodo(w, i.id);
    if (i.ownerId) await requireMusician(w, i.ownerId);
    return w.update("todos", i.id, { ...(i.label !== undefined ? { label: i.label } : {}), ...(i.ownerId !== undefined ? { ownerId: i.ownerId } : {}) });
  }),
});

export const todosCheck = defineCommand({
  name: "todos.check", roles: [...ROLES], description: "Tick an Our list to-do done or not. Ticking records who and when.",
  input: z.strictObject({ id: z.string().min(1), done: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requireTodo(w, i.id);
    return w.update("todos", i.id, i.done ? { done: true, doneAt: w.now.toDate().toISOString(), doneBy: ctx.uid } : { done: false, doneAt: null, doneBy: null });
  }),
});

export const todosPin = defineCommand({
  name: "todos.pin", roles: [...ROLES], description: "Pin an Our list to-do to To Dos › Pinned (pinned: true) or unpin it back to Our list. Pins are shared by every admin.",
  input: z.strictObject({ id: z.string().min(1), pinned: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const t = await requireTodo(w, i.id);
    if (i.pinned) return t.pinnedAt ? t : w.update("todos", i.id, { pinnedAt: w.now.toDate().toISOString(), pinnedBy: ctx.uid });
    return w.update("todos", i.id, { pinnedAt: null, pinnedBy: null });
  }),
});

export const todosRemove = defineCommand({
  name: "todos.remove", roles: [...ROLES], input: idInput, description: "Remove an Our list to-do (Undo puts it back).",
  run: (ctx, { id }) => run(ctx, async (w) => { await requireTodo(w, id); return w.softDelete("todos", id); }),
});

export const todosSetOrder = defineCommand({
  name: "todos.setOrder", roles: [...ROLES],
  description: "Save the caller's order of one To Dos column (pinned, booking, campaign:{campaignId}, show:{showId}, releases, social, our): keys are item keys, top first. Personal: it changes only this page, only for the caller.",
  input: z.strictObject({ column: z.string().regex(TODO_COLUMN_KEY, "Not a To Dos column"), keys: z.array(z.string().min(1).max(200)).max(1000) }),
  async run(ctx, i) { return { column: i.column, keys: await setTodoOrder(ctx.uid, i.column, i.keys) }; },
});

export const todosSetColumns = defineCommand({
  name: "todos.setColumns", roles: [...ROLES],
  description: "Save the caller's order of the To Dos columns themselves (pinned, booking, campaign:{campaignId}, show:{showId}, releases, social, our), left first. Personal: it changes only this page, only for the caller.",
  input: z.strictObject({ keys: z.array(z.string().regex(TODO_COLUMN_KEY, "Not a To Dos column")).max(500) }),
  async run(ctx, i) { return { columns: await setTodoColumns(ctx.uid, i.keys) }; },
});

const checklistKey = z.strictObject({ key: z.string().regex(TODO_CHECKLIST_KEY, "Not a checklist key") });
export const todosDismiss = defineCommand({
  name: "todos.dismiss", roles: [...ROLES],
  description: "Hide one checklist (key {kind}:{id}:{listId}) from the caller's To Dos. Personal: the checklist itself is untouched.",
  input: checklistKey,
  async run(ctx, i) { return { dismissed: await setTodoDismissed(ctx.uid, i.key, true) }; },
});
export const todosUndismiss = defineCommand({
  name: "todos.undismiss", roles: [...ROLES], description: "Show a dismissed checklist on the caller's To Dos again.",
  input: checklistKey,
  async run(ctx, i) { return { dismissed: await setTodoDismissed(ctx.uid, i.key, false) }; },
});

export const todoCommands = [todosAdd, todosEdit, todosCheck, todosPin, todosRemove, todosSetOrder, todosSetColumns, todosDismiss, todosUndismiss];
