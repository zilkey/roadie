# Saving: autosave, drafts, history (how to convert a form)

Rule: **existing records autosave** (no Save button), **new records are drafts** (saved as you type, restored on any machine, created by an explicit button), and **every change is in History with Undo**. The server side is done (`src/server/db.ts`, `src/server/commands/dispatch.ts`); a conversion only touches the page/form.

Pieces (all client code is `"use client"`):

| Piece | File | Use |
| --- | --- | --- |
| `useAutosave({command, id, rev, onUseTheirs?})` | `src/lib/autosave.ts` | one existing record; `patch(p)`, `bind(key, serverValue)`, `hold(msg)`, `flush()`, `statusProps` |
| `<SaveStatus {...as.statusProps} />` | `src/components/SaveStatus.tsx` | "Saving… / Saved / Offline · will save / Not saved: … / conflict + Keep mine / Use theirs" (`data-testid="save-status"`, `data-state`) |
| `useDraft(kind, contextKey, initial, {title})` | `src/lib/drafts.ts` | one new record; `{value, setValue, ready, restoredAt, status, settle(), clear({reset}), draftId}` |
| `<DraftNote .../>`, `<UnfinishedCard/>` | `src/components/drafts/UnfinishedCard.tsx` | draft status line / Home card (`draft-status`, `draft-restored`, `draft-start-over`, `unfinished`, `draft-<id>`) |
| `EntityForm autosave={...}` / `draft={...}` | `src/components/booking/common.tsx` | field-list forms (`Field[]` + `build`) with no custom layout |
| `<ToastHost/>`, `toast()` | `src/components/Toasts.tsx` | already mounted in `src/app/(app)/layout.tsx`; the "Saved … Undo" toast (`toast`, `undo-button`) is shown by `useAutosave` for 10 s |
| `useCommand().call(name, input, meta?)` | `src/components/ui.tsx` | `meta` = `{clientMutationId, baseRev, autosave, clearDraft}` (sent as `_meta`, stripped by dispatch) |

What the server does for you: `rev` +1 per write; `baseRev` conflict check (field changed by someone else since -> 409 `conflict` "<name> changed X to <value>"); `clientMutationId` dedupe (7 days); autosave patches by the same person within 2 min fold into one history entry; `Undo` = `history.undoRun` with the runId from the response and skips fields edited again since.

## 1. Edit form (existing record)

Before (Save button, whole-form diff):

```tsx
<EntityForm testid="venue-edit" fields={venueForm.fields} initial={venueForm.initial(v)} build={venueForm.build} submitLabel="Save"
  onSubmit={async (d) => { const r = await call("venues.update", { id, patch: toPatch(d) }); if (r) setEdit(false); }} />
```

After (`src/app/(app)/booking/venues/[id]/page.tsx`):

```tsx
<EntityForm testid="venue-edit" fields={venueForm.fields} initial={venueForm.initial(v)} build={venueForm.build}
  autosave={{ command: "venues.update", id, rev: v.rev }} />
```

Also rename the page's toggle from "Close" to "Done" if it has one. The form shows its own `<SaveStatus>`. Required fields that are empty are not sent ("Not saved: City is required").

Custom layout (`src/app/(app)/shows/[id]/page.tsx` + `ShowForm`): call the hook once on the page, turn each edit into a **patch between the previous and next form state** (never "form vs. the live doc": that breaks A -> B -> A while the snapshot lags), and flush on blur:

```tsx
const as = useAutosave({ command: "shows.update", id: show.id, rev: show.rev, onUseTheirs: () => setForm(formOf(show)) });
const edit = (next: ShowFormState) => { as.patch(showPatch(form, next)); setForm(next); };
<SaveStatus {...as.statusProps} />
<ShowForm mode="edit" value={form} onChange={edit} onBlur={() => void as.flush()} ... />   {/* no onSubmit = no Save button */}
```

A single text field that saves on its own (was `useState` + `onBlur` + `call`):

```tsx
<textarea className="input" data-testid="notes-input" {...as.bind("bandNotes", show.bandNotes ?? "", { toPatch: (t) => t.trim() || null })} />
```

Rules: patch values are what the `<kind>.update` command accepts (`null` clears); give the hook the doc's `rev` from the live snapshot; one hook per record. Checkboxes/selects/toggles that already call a command directly can stay, or use `as.patch({ public: true })`. Keep real action buttons (Cancel show, Archive, Send) as buttons.

## 2. Create form (new record)

Before: `useState(blank)` + `[Save]` -> `call("shows.create", ...)`.
After (`src/app/(app)/shows/new/page.tsx`): the state comes from `useDraft`, the button stays and says "Add ..." (side effects such as calendar invites must not fire on their own):

```tsx
const draft = useDraft("show", pitchId ? `pitch:${pitchId}` : "new", blank, { title: (v) => `New show · ${venueName(v)} · ${v.date}` });
const mutationId = useRef(newMutationId());
async function save() {
  await draft.settle();                                    // a late draft save must not resurrect it
  const r = await call("shows.create", input, { clientMutationId: mutationId.current, clearDraft: draft.draftId });
  if (r) { await draft.clear(); router.push(`/shows/${r.id}`); }
}
{!draft.ready ? <span className="s">Loading…</span> : <>
  <DraftNote restoredAt={draft.restoredAt} status={draft.status} onStartOver={() => void draft.clear({ reset: true })} />
  <ShowForm mode="create" value={draft.value} onChange={draft.setValue} submitLabel="Add show" onSubmit={save} ... />
</>}
```

`kind` is the thing ("show"), camelCase only (`^[a-z][A-Za-z0-9]{0,40}$`; `"pitch-comment"` is rejected and the draft silently stays device-only); `contextKey` separates starting points (`"new"`, `"pitch:<id>"`, `"venues:<id>"`): one draft per (kind, contextKey). Pick a `title` that is useful on Home. Values must be JSON. For a plain field-list form: `<EntityForm draft={{ kind: "venue", title: (v) => ... }} onSubmit={async (d, meta) => { const r = await call("venues.create", d, meta); return !!r; }} .../>`; `meta` already carries `clientMutationId` and `clearDraft`; resolve `true` to clear the form. Add `draft` kinds to `KIND` in `UnfinishedCard.tsx` for a nicer label.

## 3. List with an inline "add"

Before: a toggle opens an `EntityForm` (or a `<form>` with one input and an Add button).
After (`ContactsPanel` in `booking/common.tsx`): same form with `draft`, and the toggle opens by itself when a draft exists (`useHasDraft`):

```tsx
const hasDraft = useHasDraft("contact", `${kind}:${parentId}`);
const [explicit, setAdding] = useState<boolean | null>(null);
const adding = explicit ?? hasDraft;
<EntityForm testid="contact-form" fields={contactForm.fields} initial={contactForm.blank} build={contactForm.build} submitLabel="Add contact"
  draft={{ kind: "contact", contextKey: `${kind}:${parentId}`, title: (v) => `New contact${v.name ? ` · ${v.name}` : ""}` }}
  onSubmit={async (d, meta) => { const r = await call("contacts.create", { ...d, attachTo: { kind, id: parentId } }, meta); if (r) setAdding(false); return !!r; }} />
```

Rows already in the list are existing records: convert each one by section 1. One-field adds (a new checklist item, a comment) are actions, not forms: keep the button, but send `{ clientMutationId }` so a double tap adds once.

## Tests to copy

Edit: `tests/e2e/shows.spec.ts` ("autosave: ...") and `booking.spec.ts` (venue): no `*-submit`/`show-save` button, `expect(save-status).toHaveText("Saved")`, reload, value persisted, `undo-button` reverts. Create: "a new show is a draft": reload, a second browser context signed in as the same person restores it, `unfinished` on Home, creating clears it. Unit: `tests/unit/saving.test.ts`.

## Gotchas

- `useAutosave` waits ~800 ms after the last keystroke, or until blur; wait for `save-status` "Saved" in e2e instead of a Save click.
- Fields that the server derives (e.g. `billedAs` -> `personnel`) are patched explicitly by the form (`showPatch`), the server does not guess.
- Draft values are the raw form state, so keep `blank` stable and let `useDraft` merge it under the stored values (`{...initial, ...stored}`) when fields are added later.
- Not covered: offline write queue (a failed autosave is retried while the page is open; a closed tab loses it), typo guards on money, per-document history subcollections.
