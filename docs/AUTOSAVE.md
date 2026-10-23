# Saving: autosave, drafts, history (how to convert a form)

Rule: **existing records autosave** (no Save button), **new records are drafts** (saved as you type, restored on any machine, created by an explicit button), and **anything typed but not yet submitted survives a closed tab** (one mechanism for both: `unsubmittedDrafts`, below), and **every change is in History with Undo**. The server side is done (`src/server/db.ts`, `src/server/commands/dispatch.ts`); a conversion only touches the page/form.

Pieces (all client code is `"use client"`):

| Piece | File | Use |
| --- | --- | --- |
| `useAutosave({command, id, rev, title?, onRestore?, onUseTheirs?})` | `src/lib/autosave.ts` | one existing record; `patch(p)`, `bind(key, serverValue)`, `hold(msg)`, `flush()`, `restored`, `statusProps`; unsent patches are kept as a draft at `<collection>/<id>` |
| `<SaveStatus {...as.statusProps} />` | `src/components/SaveStatus.tsx` | "Saving… / Saved / Offline · will save / Not saved: … / conflict + Keep mine / Use theirs" (`data-testid="save-status"`, `data-state`) |
| `useDraft(path, initial, {title})` | `src/lib/drafts.ts` | one new record; `{value, setValue, ready, restoredAt, status, settle(), clear({reset}), draftId}` (`draftId` is the path) |
| `draftPath.newIn / newUnder / edit` | `src/schema/drafts.ts` | build the path (below) |
| `<DraftNote .../>`, `<UnfinishedCard/>` | `src/components/drafts/UnfinishedCard.tsx` | draft status line / Home card (`draft-status`, `draft-restored`, `draft-start-over`, `unfinished`, `draft-<id>`) |
| `EntityForm autosave={...}` / `draft={...}` | `src/components/booking/common.tsx` | field-list forms (`Field[]` + `build`) with no custom layout |
| `<ToastHost/>`, `toast()` | `src/components/Toasts.tsx` | already mounted in `src/app/(app)/layout.tsx`; the "Saved … Undo" toast (`toast`, `undo-button`) is shown by `useAutosave` for 10 s |
| `useCommand().call(name, input, meta?)` | `src/components/ui.tsx` | `meta` = `{clientMutationId, baseRev, autosave, clearDraft: <path>}` (sent as `_meta`, stripped by dispatch) |

What the server does for you: `rev` +1 per write; `baseRev` conflict check (field changed by someone else since -> 409 `conflict` "<name> changed X to <value>"); `clientMutationId` dedupe (7 days); autosave patches by the same person within 2 min fold into one history entry; `Undo` = `history.undoRun` with the runId from the response and skips fields edited again since.

## Unsubmitted drafts (one mechanism for new forms and unsaved edits)

Top-level collection `unsubmittedDrafts`, one doc per **(user, path)**: id = `${uid}__${path with "/" as "~"}` (reversible, no segment contains `~`). Fields: `uid`, `path`, `values`, `title`, `route` (where Home's link goes), `rev` (edits only), `updatedAt`, `expiresAt` (+30 days, TTL policy in `firestore.indexes.json`).

**Path = where the thing lives in Firestore** (`draftPath` helpers, `src/schema/drafts.ts`):

| Case | Path | Helper |
| --- | --- | --- |
| new record | its collection: `expenses`, `venues`, `songs` | `draftPath.newIn("expenses")` |
| new record under a parent | the parent's path + child: `venues/{id}/contacts`, `shows/{id}/checklist`, `pitches/{id}/comments`, `festivals/{id}/editions`, `shows/{id}/expenses` | `draftPath.newUnder("venues", id, "contacts")` |
| unsaved edits to an existing record | its doc path: `shows/{id}`, `venues/{id}` | `draftPath.edit("shows", id)` (`useAutosave` does this itself from `command` + `id`) |

Single band today, so paths start at the collection; with multi-band they become `artists/{a}/...`. One-shot actions (after-show, settlement, availability ask) use a made-up child name under the show/pitch (`shows/{id}/after`).

- **Last in wins.** Every change writes the whole current form state (new) or the unsaved field patches (edit) to the doc. No merge, no timestamp comparison; the server doc is the source of truth. Written through `drafts.save` (`src/server/drafts.ts`, firebase-admin, not db.ts: no history). `drafts.clear`, `drafts.list` are the others; own drafts only, path shape and ~100KB checked.
- **How it is sent** (`src/lib/draftSync.ts`, `DraftChannel`): each change goes to localStorage at once, to the server after 500 ms. On `pagehide` / tab hidden the pending write is sent with `fetch(..., {keepalive: true})`. Offline: it stays in localStorage and is pushed on `online`, on the next open, or from Home. Limits: keepalive bodies are capped (~64KB, so a larger draft stays on this device), and a tab the OS kills without `pagehide` can lose up to the last 500 ms of typing from the server (the local copy still brings it back on this machine).
- **Populate on open.** A new form (`useDraft`) starts from the stored values. An existing record's `useAutosave` finds the stored patches, shows them (`bind` fields and `onRestore(patch)`; other state forms catch up when the save lands) and sends them through the normal autosave right away ("Saving..." then "Saved"). They go out with the `baseRev` they were typed against, so a record that changed since shows the usual conflict UI.
- **Saving clears it.** New: the create command succeeding clears the doc server-side (`clearDraft: draft.draftId`, the path, in the `_meta`). Existing: when every patch for the record is saved the draft is cleared; not while one is waiting, failed, offline or in conflict.
- Home's **Unfinished** card (`UnfinishedCard`) lists both kinds ("New expense - ...", "Unsaved changes to <record>").

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
const draft = useDraft(pitchId ? draftPath.newUnder("pitches", pitchId, "shows") : draftPath.newIn("shows"), blank, { title: (v) => `New show · ${venueName(v)} · ${v.date}` });
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

The path separates starting points (`shows` vs `pitches/<id>/shows`): one draft per (user, path). Pick a `title` that is useful on Home. Values must be JSON. For a plain field-list form: `<EntityForm draft={{ path: draftPath.newIn("venues"), title: (v) => ... }} onSubmit={async (d, meta) => { const r = await call("venues.create", d, meta); return !!r; }} .../>`; `meta` already carries `clientMutationId` and `clearDraft`; resolve `true` to clear the form. Add a collection or child name to `NOUN` in `UnfinishedCard.tsx` for a nicer label.

## 3. List with an inline "add"

Before: a toggle opens an `EntityForm` (or a `<form>` with one input and an Add button).
After (`ContactsPanel` in `booking/common.tsx`): same form with `draft`, and the toggle opens by itself when a draft exists (`useHasDraft`):

```tsx
const hasDraft = useHasDraft(draftPath.newUnder(kind, parentId, "contacts"));
const [explicit, setAdding] = useState<boolean | null>(null);
const adding = explicit ?? hasDraft;
<EntityForm testid="contact-form" fields={contactForm.fields} initial={contactForm.blank} build={contactForm.build} submitLabel="Add contact"
  draft={{ path: draftPath.newUnder(kind, parentId, "contacts"), title: (v) => `New contact${v.name ? ` · ${v.name}` : ""}` }}
  onSubmit={async (d, meta) => { const r = await call("contacts.create", { ...d, attachTo: { kind, id: parentId } }, meta); if (r) setAdding(false); return !!r; }} />
```

Rows already in the list are existing records: convert each one by section 1. One-field adds (a new checklist item, a comment) are actions, not forms: keep the button, but send `{ clientMutationId }` so a double tap adds once.

## Tests to copy

Edit: `tests/e2e/shows.spec.ts` ("autosave: ...") and `booking.spec.ts` (venue): no `*-submit`/`show-save` button, `expect(save-status).toHaveText("Saved")`, reload, value persisted, `undo-button` reverts. Create: "a new show is a draft": reload, a second browser context signed in as the same person restores it, `unfinished` on Home, creating clears it. Unit: `tests/unit/saving.test.ts`.

## Gotchas

- `useAutosave` waits ~800 ms after the last keystroke, or until blur; wait for `save-status` "Saved" in e2e instead of a Save click.
- Fields that the server derives (e.g. `billedAs` -> `personnel`) are patched explicitly by the form (`showPatch`), the server does not guess.
- Draft values are the raw form state, so keep `blank` stable and let `useDraft` merge it under the stored values (`{...initial, ...stored}`) when fields are added later.
- `useAutosave` patches must be JSON (they are stored as the draft). Pass `title` (the record's name) for Home's card.
- `useInstantSave` (whole-list commands) has no draft: each change is one request sent with keepalive, so a closing tab doesn't drop it. Offline, it is not kept.
- Not covered: typo guards on money.
