import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineCommand, type Command } from "./types";
import { idInput } from "./util";
import { run, type Doc, type Writer } from "../db";
import { AppError } from "../errors";
import { templateKind, type ChecklistItem, type ChecklistKind, type ChecklistLike } from "@/lib/shows";
import { checklistKind } from "@/schema";

// Checklists live on a show (shows/{id}.checklists), a release (releases/{id}.checklists) or the Social Media sidebar
// (socialChecklists/{artistId}.checklists, one per artist, made by its first list). The checklists.* commands take {kind, id};
// the older shows.* checklist commands are the same commands with kind "show". Members can tick, add, edit and remove items on
// shows only (they can't read releases or Social Media); lists themselves, pins and templates are admins'.

const newId = () => randomUUID().slice(0, 8);
const COLLECTION: Record<ChecklistKind, string> = { show: "shows", release: "releases", social: "socialChecklists" };
const NOUN: Record<ChecklistKind, string> = { show: "Show", release: "Release", social: "Social Media" };

interface Host { kind: ChecklistKind; id: string; artistId: string | undefined; lists: ChecklistLike[]; exists: boolean }

/** The show, release or Social Media sidebar a checklist call is for, checked against the caller's band. */
async function bandHost(w: Writer, kind: ChecklistKind, id: string): Promise<Host> {
  if (kind !== "show" && w.ctx.role === "member") throw new AppError("forbidden", `Only admins can change ${NOUN[kind]} checklists`, 403);
  if (kind === "social") {
    if (w.ctx.artistId && id !== w.ctx.artistId) throw new AppError("not_found", "Social Media checklists not found", 404);
    const d = await w.get(COLLECTION.social, id);
    return { kind, id, artistId: id, lists: ((d?.checklists ?? []) as ChecklistLike[]), exists: !!d };
  }
  const d = await w.get(COLLECTION[kind], id);
  if (!d || d.deletedAt || (w.ctx.artistId && d.artistId && d.artistId !== w.ctx.artistId)) throw new AppError("not_found", `${NOUN[kind]} not found`, 404);
  return { kind, id, artistId: d.artistId as string | undefined, lists: ((d.checklists ?? []) as ChecklistLike[]), exists: true };
}
function writeLists(w: Writer, h: Host, lists: ChecklistLike[]) {
  if (h.kind === "social" && !h.exists) return w.create(COLLECTION.social, { artistId: h.id, checklists: lists }, { id: h.id });
  return w.update(COLLECTION[h.kind], h.id, { checklists: lists });
}
function listOf(lists: ChecklistLike[], listId: string) {
  const l = lists.find((x) => x.id === listId);
  if (!l) throw new AppError("not_found", "No such checklist", 404);
  return l;
}
function itemOf(list: ChecklistLike, itemId: string) {
  const i = list.items.find((x) => x.id === itemId);
  if (!i) throw new AppError("not_found", "No such checklist item", 404);
  return i;
}
/** Change one list (by id) and write every list back. */
function editList(w: Writer, h: Host, listId: string, f: (l: ChecklistLike) => ChecklistLike | null) {
  listOf(h.lists, listId);
  return writeLists(w, h, h.lists.flatMap((l) => (l.id !== listId ? [l] : (f(l) ?? []))));
}
const editItem = (w: Writer, h: Host, listId: string, itemId: string, f: (i: ChecklistItem) => ChecklistItem | null) =>
  editList(w, h, listId, (l) => { itemOf(l, itemId); return { ...l, items: l.items.flatMap((i) => (i.id !== itemId ? [i] : (f(i) ?? []))) }; });
async function requireMusician(w: Writer, id: string) {
  const m = await w.get("musicians", id);
  if (!m || m.deletedAt) throw new AppError("not_found", "Musician not found", 404);
}
async function artistFor(w: Writer, artistId = w.ctx.artistId): Promise<Doc> {
  const a = artistId ? await w.get("artists", artistId) : (await w.query("artists", (q) => q.limit(1)))[0];
  if (!a || a.deletedAt) throw new AppError("not_found", "Set up the artist first", 404);
  return a;
}
/** A live template of the artist this call (or this show) is for. */
async function requireTemplate(w: Writer, id: string, artistId = w.ctx.artistId) {
  const t = await w.get("checklistTemplates", id);
  if (!t || t.deletedAt || (artistId && t.artistId !== artistId)) throw new AppError("not_found", "Checklist template not found", 404);
  return t;
}
const liveTemplates = async (w: Writer, artistId: string) =>
  (await w.query("checklistTemplates", (q) => q.where("artistId", "==", artistId))).sort((a, b) => (a.order as number) - (b.order as number));
const nextOrder = (ts: Doc[]) => Math.max(-1, ...ts.map((t) => t.order as number)) + 1;

const kindIn = { kind: checklistKind, id: z.string().min(1) };
const listIn = { ...kindIn, listId: z.string().min(1) };
const itemIn = { ...listIn, itemId: z.string().min(1) };
const ownerIn = z.string().min(1).nullable().optional();
const checklistItemIn = z.strictObject({ id: z.string().min(1).optional(), label: z.string().trim().min(1), done: z.boolean().default(false), ownerId: z.string().min(1).optional() });
const checklistIn = z.strictObject({ id: z.string().min(1).optional(), name: z.string().trim().min(1), templateId: z.string().min(1).nullable().optional(), items: z.array(checklistItemIn) });
/** The checklists.* names are the app's (not Roadie's yet: it keeps the shows.* ones). */
const ITEM_ROLES: Command["roles"] = ["admin", "member"];

export const checklistsSet = defineCommand({
  name: "checklists.set", roles: ["admin"],
  description: "Replaces every list on a show, release or the Social Media sidebar (kind show|release|social; for social, id is the artist's): prefer the per-list and per-item commands. In order: [{id?, name, templateId? (null = none), items: [{id?, label, done, ownerId? (musician; none = unassigned)}]}]. Lists and items without an id get one. Pins on items that are kept stay.",
  input: z.strictObject({ ...kindIn, checklists: z.array(checklistIn) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const h = await bandHost(w, i.kind, i.id);
    const was = new Map(h.lists.flatMap((l) => l.items.map((c) => [c.id, c] as const)));
    const keep = (c: z.infer<typeof checklistItemIn>) => {
      const old = c.id ? was.get(c.id) : undefined;
      const pin = old?.pinnedAt ? { pinnedAt: old.pinnedAt, pinnedBy: old.pinnedBy } : {};
      if (!c.done) return pin;
      return { ...pin, ...(old?.done && old.doneAt ? { doneAt: old.doneAt, doneBy: old.doneBy } : { doneAt: w.now.toDate().toISOString(), doneBy: ctx.uid }) };
    };
    const lists = i.checklists.map((l) => ({ ...l, id: l.id ?? newId(), templateId: l.templateId ?? null, items: l.items.map((c) => ({ ...c, id: c.id ?? newId(), ...keep(c) })) }));
    return writeLists(w, h, lists as ChecklistLike[]);
  }),
});

export const checklistsAdd = defineCommand({
  name: "checklists.add", roles: ["admin"],
  description: "Add a list at the end of a show's, release's or the Social Media sidebar's checklists: from a template that applies to that kind (its name and items, not done, unassigned; templateId set), or a blank list by name.",
  input: z.union([
    z.strictObject({ ...kindIn, templateId: z.string().min(1) }),
    z.strictObject({ ...kindIn, name: z.string().trim().min(1) }),
  ]),
  run: (ctx, i) => run(ctx, async (w) => {
    const h = await bandHost(w, i.kind, i.id);
    const listId = newId();
    let list: ChecklistLike = { id: listId, name: "", templateId: null, items: [] };
    if ("templateId" in i) {
      const t = await requireTemplate(w, i.templateId, h.artistId);
      if (templateKind(t as { appliesTo?: ChecklistKind }) !== i.kind) throw new AppError("invalid_input", `That template isn't a ${NOUN[i.kind]} template`, 400);
      list = { ...list, name: t.name as string, templateId: t.id, items: (t.items as { label: string }[]).map((x) => ({ id: newId(), label: x.label, done: false })) };
    } else list = { ...list, name: i.name };
    await writeLists(w, h, [...h.lists, list]);
    return { id: i.id, listId };
  }),
});

export const checklistsRename = defineCommand({
  name: "checklists.rename", roles: ["admin"], description: "Rename one checklist.",
  input: z.strictObject({ ...listIn, name: z.string().trim().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => editList(w, await bandHost(w, i.kind, i.id), i.listId, (l) => ({ ...l, name: i.name }))),
});

export const checklistsRemove = defineCommand({
  name: "checklists.remove", roles: ["admin"], description: "Delete one checklist and its items (Undo puts it back).",
  input: z.strictObject(listIn),
  run: (ctx, i) => run(ctx, async (w) => editList(w, await bandHost(w, i.kind, i.id), i.listId, () => null)),
});

export const checklistsReorder = defineCommand({
  name: "checklists.reorder", roles: ["admin"], description: "Put the checklists in this order: listIds is every list's id, once.",
  input: z.strictObject({ ...kindIn, listIds: z.array(z.string().min(1)) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const h = await bandHost(w, i.kind, i.id);
    const same = i.listIds.length === h.lists.length && new Set(i.listIds).size === h.lists.length && h.lists.every((l) => i.listIds.includes(l.id));
    if (!same) throw new AppError("invalid_input", "Give every list once (someone may have just added or deleted one)", 409);
    return writeLists(w, h, i.listIds.map((lid) => listOf(h.lists, lid)));
  }),
});

export const checklistsAddItem = defineCommand({
  name: "checklists.addItem", roles: ITEM_ROLES, description: "Add a to-do at the end of one checklist, optionally assigned to a musician.",
  input: z.strictObject({ ...listIn, label: z.string().trim().min(1), ownerId: ownerIn }),
  run: (ctx, i) => run(ctx, async (w) => {
    const h = await bandHost(w, i.kind, i.id);
    if (i.ownerId) await requireMusician(w, i.ownerId);
    const itemId = newId();
    await editList(w, h, i.listId, (l) => ({ ...l, items: [...l.items, { id: itemId, label: i.label, done: false, ...(i.ownerId ? { ownerId: i.ownerId } : {}) }] }));
    return { id: i.id, listId: i.listId, itemId };
  }),
});

export const checklistsEditItem = defineCommand({
  name: "checklists.editItem", roles: ITEM_ROLES, description: "Change a to-do's text and who it's assigned to. Always send both label and ownerId: ownerId is required, a musician id assigns and null unassigns (omitting it is refused, so resend the current owner to keep it).",
  input: z.strictObject({ ...itemIn, label: z.string().trim().min(1), ownerId: z.string().min(1).nullable() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const h = await bandHost(w, i.kind, i.id);
    if (i.ownerId) await requireMusician(w, i.ownerId);
    return editItem(w, h, i.listId, i.itemId, ({ ownerId: _o, ...c }) => ({ ...c, label: i.label, ...(i.ownerId ? { ownerId: i.ownerId } : {}) }));
  }),
});

export const checklistsRemoveItem = defineCommand({
  name: "checklists.removeItem", roles: ITEM_ROLES, description: "Remove one to-do from a checklist.",
  input: z.strictObject(itemIn),
  run: (ctx, i) => run(ctx, async (w) => editItem(w, await bandHost(w, i.kind, i.id), i.listId, i.itemId, () => null)),
});

export const checklistsCheck = defineCommand({
  name: "checklists.check", roles: ITEM_ROLES, description: "Tick one checklist item done or not. Ticking records who and when.",
  input: z.strictObject({ ...itemIn, done: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => editItem(w, await bandHost(w, i.kind, i.id), i.listId, i.itemId, ({ doneAt: _a, doneBy: _b, ...c }) => (
    i.done ? { ...c, done: true, doneAt: w.now.toDate().toISOString(), doneBy: ctx.uid } : { ...c, done: false }
  ))),
});

export const checklistsPin = defineCommand({
  name: "checklists.pin", roles: ["admin"],
  description: "Pin a checklist item to To Dos (pinned: true) or unpin it. Pins are shared by every admin; the item stays on its list either way.",
  input: z.strictObject({ ...itemIn, pinned: z.boolean() }),
  run: (ctx, i) => run(ctx, async (w) => editItem(w, await bandHost(w, i.kind, i.id), i.listId, i.itemId, ({ pinnedAt, pinnedBy, ...c }) => (
    i.pinned ? { ...c, pinnedAt: pinnedAt ?? w.now.toDate().toISOString(), pinnedBy: pinnedBy ?? ctx.uid } : c
  ))),
});

export const checklistsSaveAsTemplate = defineCommand({
  name: "checklists.saveAsTemplate", roles: ["admin"],
  description: "Make a new checklist template (last in order, applying to this list's kind) from one checklist: its name and item text (no assignees, nothing done). The list is linked to it (templateId).",
  input: z.strictObject(listIn),
  run: (ctx, i) => run(ctx, async (w) => {
    const h = await bandHost(w, i.kind, i.id);
    const list = listOf(h.lists, i.listId);
    const artistId = (await artistFor(w, h.artistId)).id;
    const t = await w.create("checklistTemplates", { artistId, name: list.name, appliesTo: i.kind, order: nextOrder(await liveTemplates(w, artistId)), items: list.items.map((c) => ({ id: newId(), label: c.label })) });
    await editList(w, h, i.listId, (l) => ({ ...l, templateId: t.id }));
    return { id: i.id, listId: i.listId, templateId: t.id };
  }),
});

export const checklistsUpdateTemplate = defineCommand({
  name: "checklists.updateTemplate", roles: ["admin"],
  description: "Overwrite the template a checklist came from with that list's name and item text (no assignees, nothing done). Other lists made from it are not touched.",
  input: z.strictObject(listIn),
  run: (ctx, i) => run(ctx, async (w) => {
    const h = await bandHost(w, i.kind, i.id);
    const list = listOf(h.lists, i.listId);
    if (!list.templateId) throw new AppError("invalid_state", "This list isn't from a template: save it as one instead", 409);
    const t = await requireTemplate(w, list.templateId, h.artistId);
    await w.update("checklistTemplates", t.id, { name: list.name, items: list.items.map((c) => ({ id: newId(), label: c.label })) });
    return { id: i.id, listId: i.listId, templateId: t.id };
  }),
});

// ---------- the older shows.* names: the same commands with kind "show" ----------

/** A checklists.* command as a shows.* one: same run with kind "show", input without kind. */
function forShows<S extends z.ZodObject>(cmd: Command<S>, name: string, roles: Command["roles"], description: string) {
  const input = (cmd.input as z.ZodObject).omit({ kind: true }) as z.ZodObject;
  return defineCommand({ name, roles, description, input, run: (ctx, i) => cmd.run(ctx, { ...(i as object), kind: "show" } as z.infer<S>) });
}

export const showsSetChecklists = forShows(checklistsSet, "shows.setChecklists", ["admin", "mcp"],
  "Replaces every list on the show: prefer the per-list and per-item commands (shows.addChecklist, addChecklistItem, editChecklistItem, checkItem...). In order: [{id?, name, templateId? (the checklist template it came from; null = none), items: [{id?, label, done, ownerId? (musician; none = unassigned)}]}]. Lists and items without an id get one.");
export const showsAddChecklist = defineCommand({
  name: "shows.addChecklist", roles: ["admin"],
  description: "Add a list at the end of a show's checklists: from a show template (its name and items, not done, unassigned; templateId set), or a blank list by name. The same template can be added more than once.",
  input: z.union([
    z.strictObject({ id: z.string().min(1), templateId: z.string().min(1) }),
    z.strictObject({ id: z.string().min(1), name: z.string().trim().min(1) }),
  ]),
  run: (ctx, i) => checklistsAdd.run(ctx, { ...i, kind: "show" }),
});
export const showsRenameChecklist = forShows(checklistsRename, "shows.renameChecklist", ["admin"], "Rename one of a show's checklists.");
export const showsRemoveChecklist = forShows(checklistsRemove, "shows.removeChecklist", ["admin"], "Delete one of a show's checklists and its items (Undo puts it back).");
export const showsReorderChecklists = forShows(checklistsReorder, "shows.reorderChecklists", ["admin"], "Put a show's checklists in this order: listIds is every list's id, once.");
export const showsAddChecklistItem = forShows(checklistsAddItem, "shows.addChecklistItem", ["admin", "member"], "Add a to-do at the end of one of a show's checklists, optionally assigned to a musician.");
export const showsEditChecklistItem = forShows(checklistsEditItem, "shows.editChecklistItem", ["admin", "member"], "Change a to-do's text and who it's assigned to. Always send both label and ownerId: ownerId is required, a musician id assigns and null unassigns (omitting it is refused, so resend the current owner to keep it).");
export const showsRemoveChecklistItem = forShows(checklistsRemoveItem, "shows.removeChecklistItem", ["admin", "member"], "Remove one to-do from a show's checklist.");
export const showsCheckItem = forShows(checklistsCheck, "shows.checkItem", ["admin", "member", "mcp"], "Tick one checklist item done or not. Anyone in the band can tick any item; ticking records who and when.");
export const showsSaveChecklistAsTemplate = forShows(checklistsSaveAsTemplate, "shows.saveChecklistAsTemplate", ["admin"], "Make a new show checklist template (last in order) from one of a show's lists: its name and item text (no assignees, nothing done). The list is linked to it (templateId).");
export const showsUpdateTemplateFromChecklist = forShows(checklistsUpdateTemplate, "shows.updateTemplateFromChecklist", ["admin"], "Overwrite the template a show's list came from with that list's name and item text (no assignees, nothing done). Other shows' lists are not touched.");

// ---------- checklist templates (admins of the artist) ----------

const templateItems = z.array(z.strictObject({ id: z.string().min(1).optional(), label: z.string().trim().min(1) }));
const withItemIds = (items: z.infer<typeof templateItems>) => items.map((x) => ({ id: x.id ?? newId(), label: x.label }));

export const checklistTemplatesList = defineCommand({
  name: "checklistTemplates.list", roles: ["admin", "mcp"], input: z.strictObject({}),
  description: "This artist's checklist templates in order: [{id, name, appliesTo (show|release|social: where 'New list' offers it), order, items: [{id, label}]}].",
  run: (ctx) => run(ctx, async (w) => {
    const ts = await liveTemplates(w, (await artistFor(w)).id);
    return { templates: ts.map((t) => ({ id: t.id, name: t.name, appliesTo: templateKind(t as { appliesTo?: ChecklistKind }), order: t.order, items: t.items })) };
  }),
});
export const checklistTemplatesCreate = defineCommand({
  name: "checklistTemplates.create", roles: ["admin", "mcp"],
  description: "Add a checklist template (last in order): name, appliesTo (show, release or social; default show) and items [{label}]. Lists of that kind can then add it.",
  input: z.strictObject({ name: z.string().trim().min(1), appliesTo: checklistKind.default("show"), items: templateItems.default([]) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const artistId = (await artistFor(w)).id;
    return w.create("checklistTemplates", { artistId, name: i.name, appliesTo: i.appliesTo, order: nextOrder(await liveTemplates(w, artistId)), items: withItemIds(i.items) });
  }),
});
export const checklistTemplatesUpdate = defineCommand({
  name: "checklistTemplates.update", roles: ["admin", "mcp"],
  description: "Edit a checklist template: name, appliesTo (show|release|social: moves it to that kind), items (the whole list, in order: [{id?, label}]). Call checklistTemplates.list first and keep each existing item's id, or the item is recreated with a new one. Lists already made from it are not touched.",
  input: z.strictObject({ id: z.string().min(1), patch: z.strictObject({ name: z.string().trim().min(1).optional(), appliesTo: checklistKind.optional(), items: templateItems.optional() }) }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    await requireTemplate(w, id);
    return w.update("checklistTemplates", id, { ...(patch.name ? { name: patch.name } : {}), ...(patch.appliesTo ? { appliesTo: patch.appliesTo } : {}), ...(patch.items ? { items: withItemIds(patch.items) } : {}) });
  }),
});
export const checklistTemplatesReorder = defineCommand({
  name: "checklistTemplates.reorder", roles: ["admin", "mcp"], description: "Put this artist's checklist templates in this order: ids is every template's id, once.",
  input: z.strictObject({ ids: z.array(z.string().min(1)) }),
  run: (ctx, i) => run(ctx, async (w) => {
    const ts = await liveTemplates(w, (await artistFor(w)).id);
    const same = i.ids.length === ts.length && new Set(i.ids).size === ts.length && ts.every((t) => i.ids.includes(t.id));
    if (!same) throw new AppError("invalid_input", "Give every template once (someone may have just added or deleted one)", 409);
    for (const [n, tid] of i.ids.entries()) if (ts.find((t) => t.id === tid)!.order !== n) await w.update("checklistTemplates", tid, { order: n });
    return { ids: i.ids };
  }),
});
export const checklistTemplatesRemove = defineCommand({
  name: "checklistTemplates.remove", roles: ["admin", "mcp"], input: idInput, description: "Delete a checklist template. Lists already made from it stay where they are.",
  run: (ctx, { id }) => run(ctx, async (w) => { await requireTemplate(w, id); return w.softDelete("checklistTemplates", id); }),
});

export const checklistCommands = [
  checklistsSet, checklistsAdd, checklistsRename, checklistsRemove, checklistsReorder, checklistsAddItem, checklistsEditItem, checklistsRemoveItem,
  checklistsCheck, checklistsPin, checklistsSaveAsTemplate, checklistsUpdateTemplate,
  showsSetChecklists, showsAddChecklist, showsRenameChecklist, showsRemoveChecklist, showsReorderChecklists,
  showsAddChecklistItem, showsEditChecklistItem, showsRemoveChecklistItem, showsCheckItem, showsSaveChecklistAsTemplate, showsUpdateTemplateFromChecklist,
  checklistTemplatesList, checklistTemplatesCreate, checklistTemplatesUpdate, checklistTemplatesReorder, checklistTemplatesRemove,
];
