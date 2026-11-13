"use client";
import { useEffect, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { useCampaigns } from "@/components/booking/useCampaigns";
import { runCommandFull } from "@/lib/commands";
import { useDragReorder } from "@/lib/drag-reorder";
import { applyOrder, buildBoard, columnCount, dismissedLists, movedOrder, type AddTarget, type BoardColumn, type BoardGroup, type BoardItem, type PitchLike, type ReleaseLike, type ShowLike, type TodoLike } from "@/lib/todos";
import type { ChecklistLike } from "@/lib/shows";
import type { Musician } from "@/schema";
import { PageTitle } from "@/components/ui";
import { toast, UNDO_MS } from "@/components/Toasts";
import { confetti } from "@/components/Celebrate";
import { PinIcon } from "@/components/shows/checklists/ChecklistItem";
import { activePeople, useChecklistTemplates } from "@/components/shows/checklists/shared";
import { Menu } from "@/components/Menu";
import { InlineValue } from "@/components/InlineValue";
import { templateKind } from "@/lib/shows";
import { nameOf } from "@/components/shows/common";

/** Run a command; say so in a toast (with Undo when `undo` is given), or say what went wrong. */
async function act(name: string, input: unknown, ok?: { text: string; undo?: boolean }) {
  try {
    const r = await runCommandFull(name, input);
    if (ok) toast({ key: `todos:${name}`, text: ok.text, ...(ok.undo ? { undoRunId: r.runId, ms: UNDO_MS } : {}) });
    return r;
  } catch (e) {
    toast({ key: `todos:${name}:err`, text: `Couldn't save: ${e instanceof Error ? e.message : "error"}`, ms: 6000 });
  }
}

/**
 * To Dos: everything open across shows, releases, the Social Media sidebar, booking and Our list, one column per source. Every list
 * but Booking adds to-dos at its bottom, and a column that holds checklists (a show, the releases, Social Media) ends in "+ Add list".
 * Each list in those columns folds open and shut; what's folded is this person's own, on this device (localStorage).
 * Order (of items and of the columns), Focus and Dismiss are this person's own (userPrefs, Focus just for the visit);
 * ticking, pinning and Our list are the band's.
 */
export function TodoBoard() {
  const { artistId } = useArtist();
  const p = useProfile();
  const mineOf = { where: [["artistId", "==", artistId] as [string, "==", string]] };
  const shows = useCollection<ShowLike>("shows", mineOf);
  const releases = useCollection<ReleaseLike>("releases", mineOf);
  const pitches = useCollection<PitchLike>("pitches", mineOf);
  const todos = useCollection<TodoLike>("todos", mineOf);
  const campaigns = [...useCampaigns().live.values()]; // admins only: a column per active campaign (#82)
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const social = useDoc<{ checklists?: ChecklistLike[] }>("socialChecklists", artistId).doc;
  const prefs = useDoc<{ todoOrder?: Record<string, string[]>; todoColumns?: string[]; todoDismissed?: string[] }>("userPrefs", p.uid).doc;

  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [openDismissed, setOpenDismissed] = useState(false);
  const [phoneCol, setPhoneCol] = useState("pinned");
  /** Orders just dragged, shown before userPrefs catches up. */
  const [moved, setMoved] = useState<Record<string, string[]>>({});
  /** Column order just dragged, shown before userPrefs catches up. */
  const [movedCols, setMovedCols] = useState<string[] | null>(null);
  /** The one column shown on its own, or null for all of them. */
  const [focus, setFocus] = useState<string | null>(null);

  const order = { ...(prefs?.todoOrder ?? {}), ...moved };
  const dismissed = prefs?.todoDismissed ?? [];
  const input = {
    artistId, shows: shows.rows ?? [], releases: releases.rows ?? [], social: social?.checklists ?? [], pitches: pitches.rows ?? [], campaigns, todos: todos.rows ?? [],
    order, dismissed, mine: mine ? { musicianId: p.musicianId, userId: p.userId } : null, showDone,
  };
  const cols = applyOrder(buildBoard(input), movedCols ?? prefs?.todoColumns);
  const focused = cols.find((c) => c.key === focus);
  const shown = focused ? [focused] : cols;
  const gone = dismissedLists(input);
  const loading = [shows, releases, pitches, todos].some((c) => c.loading);
  const at = cols.some((c) => c.key === phoneCol) ? phoneCol : "pinned";

  const setOrder = (col: BoardColumn, keys: string[]) => {
    setMoved((m) => ({ ...m, [col.key]: keys }));
    void act("todos.setOrder", { column: col.key, keys });
  };
  const moveCol = (from: number, to: number) => {
    const keys = cols.map((c) => c.key);
    keys.splice(to, 0, ...keys.splice(from, 1));
    setMovedCols(keys);
    void act("todos.setColumns", { keys });
  };
  const colDrag = useDragReorder(moveCol);
  const folds = useFolds(artistId);

  return (
    <div className="grid gap-4" data-testid="todos-page">
      <PageTitle title="To Dos" center
        actions={<>
          <label className="inline-flex min-h-10 items-center gap-2 font-semibold">
            <input type="checkbox" className="h-[18px] w-[18px]" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} data-testid="todos-show-done" />Show done
          </label>
          <button type="button" className="btn sm ghost" aria-expanded={openDismissed} onClick={() => setOpenDismissed((o) => !o)} data-testid="todos-dismissed">Dismissed ({gone.length})</button>
          {/* Everyone / Mine at the top right of the title row (Jeff, 2026-11-12). */}
          <div className="seg" role="radiogroup" aria-label="Whose">
            <label><input type="radio" name="todos-whose" checked={!mine} onChange={() => setMine(false)} data-testid="todos-everyone" />Everyone</label>
            <label><input type="radio" name="todos-whose" checked={mine} onChange={() => setMine(true)} data-testid="todos-mine" />Mine</label>
          </div>
        </>} />

      {openDismissed && (
        <div className="card grid gap-2" data-testid="todos-dismissed-list">
          {gone.length ? gone.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{d.title}</span>
              <button type="button" className="btn sm ghost" data-testid={`todos-undismiss-${d.key}`} onClick={() => act("todos.undismiss", { key: d.key })}>Show again</button>
            </div>
          )) : <p className="s m-0">Nothing dismissed. Dismiss a checklist to hide it from your To Dos; it stays on its show or release.</p>}
        </div>
      )}

      <div className="td-chips" role="group" aria-label="Columns">
        {cols.map((c) => (
          <button key={c.key} type="button" aria-pressed={c.key === at} onClick={() => setPhoneCol(c.key)} data-testid={`todos-chip-${c.key}`}>
            {c.chip} <span className="c">{columnCount(c)}</span>
          </button>
        ))}
      </div>

      {loading ? <p className="s">Loading…</p> : (
        <div className="td-board" data-focus={focused ? "" : undefined}>
          {shown.map((c) => {
            const i = cols.indexOf(c);
            return <Column key={c.key} col={c} on={c.key === at} musicians={musicians} onOrder={(keys) => setOrder(c, keys)} artistId={artistId} folds={folds}
              focused={!!focused} onFocus={() => setFocus(focused ? null : c.key)} drag={focused ? null : { row: colDrag.row(i), handle: colDrag.handle(i) }} />;
          })}
        </div>
      )}
    </div>
  );
}

function Column({ col, on, musicians, onOrder, artistId, folds, focused, onFocus, drag }: {
  col: BoardColumn; on: boolean; musicians: Row<Musician>[]; onOrder(keys: string[]): void; artistId: string; folds: Folds;
  focused: boolean; onFocus(): void; drag: { row: object; handle: object } | null;
}) {
  const empty = !col.groups.some((g) => g.items.length);
  const id = `td-${col.key.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <section className="td-col" aria-labelledby={id} data-on={on ? "" : undefined} data-testid={`todos-col-${col.key}`} {...drag?.row}>
      <div className="td-ch">
        {drag && <Grip {...{ ...drag.handle, title: "Drag to move this column", "data-testid": `todos-col-grip-${col.key}` }} />}
        <h2 id={id}>{col.href ? <Link href={col.href}>{col.title}</Link> : col.title}</h2>
        <button type="button" className="td-focus" aria-pressed={focused} aria-label={focused ? "Show all columns" : `Focus on ${col.title}`}
          data-testid={`todos-focus-${col.key}`} onClick={onFocus}>{focused ? "Show all" : "Focus"}</button>
      </div>
      {col.caption && <p className="td-cs">{col.caption}</p>}
      {empty && col.key !== "our" && <p className="td-none">{col.key === "pinned" ? "Nothing pinned. Pin an item on any checklist to see it here." : "Nothing to do here."}</p>}
      {col.groups.map((g, gi) => <Group key={g.key ?? gi} col={col} g={g} gi={gi} musicians={musicians} onOrder={onOrder} folds={folds} />)}
      {col.newList && <AddList newList={col.newList} artistId={artistId} testid={`todos-add-list-${col.key}`} />}
      {col.key === "booking" && <p className="td-tip">Ticking a next step marks it done on the pitch. Ticking a quiet pitch logs a follow up today, so it leaves until it goes quiet again.</p>}
      {col.key === "our" && <p className="td-tip">Click the text to edit it and pick who. Clear the text to remove it.</p>}
    </section>
  );
}

function Group({ col, g, gi, musicians, onOrder, folds }: { col: BoardColumn; g: BoardGroup; gi: number; musicians: Row<Musician>[]; onOrder(keys: string[]): void; folds: Folds }) {
  const move = (from: number, to: number) => onOrder(movedOrder(col, gi, from, to));
  const drag = useDragReorder(move);
  if (!g.items.length && !g.add) return null;
  // A titled list (a show's, a release's, Social Media's) folds shut with its chevron; Our list and Pinned don't.
  const shut = !!g.key && !!g.title && folds.shut.has(g.key);
  return (
    <>
      {g.title && (
        <div className="td-grp" data-testid={`todos-group-${g.key}`}>
          {g.key && <button type="button" className="td-fold" aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} ${g.title}`} data-testid={`todos-fold-${g.key}`}
            onClick={() => folds.toggle(g.key!)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: shut ? "rotate(-90deg)" : undefined }}><path d="M6 9l6 6 6-6" /></svg></button>}
          <h3>{g.titleLink ? <><Link href={g.titleLink.href}>{g.titleLink.text}</Link> › {g.title}</> : g.title}</h3>
          <span className="td-cnt">{g.done} of {g.total}</span>
          {g.key && <button type="button" className="td-dis" aria-label={`Dismiss ${g.title}`} data-testid={`todos-dismiss-${g.key}`}
            onClick={() => act("todos.dismiss", { key: g.key }, { text: `${g.title} dismissed. Find it under Dismissed to show it again.` })}>Dismiss</button>}
        </div>
      )}
      {!shut && <ul className="td-list">
        {g.items.map((item, i) => (
          <li key={item.key} {...drag.row(i)}>
            <Card item={item} musicians={musicians} grip={drag.handle(i)}
              onUp={i > 0 ? () => move(i, i - 1) : undefined} onDown={i < g.items.length - 1 ? () => move(i, i + 1) : undefined} />
          </li>
        ))}
      </ul>}
      {g.add && !shut && <AddItem target={g.add} testid={`todos-additem-${g.key ?? col.key}`} />}
    </>
  );
}

const Grip = (props: object) => (
  <span className="td-grip" aria-hidden {...props}>
    <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor"><circle cx="4" cy="4" r="1.5" /><circle cx="10" cy="4" r="1.5" /><circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="4" cy="16" r="1.5" /><circle cx="10" cy="16" r="1.5" /></svg>
  </span>
);
const Arrow = ({ d }: { d: string }) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;

/** The phone's way to move a card: up and down buttons (drag needs a mouse). */
function MoveButtons({ label, onUp, onDown }: { label: string; onUp?(): void; onDown?(): void }) {
  return (
    <span className="td-mv">
      <button type="button" aria-label={`Move ${label} up`} disabled={!onUp} onClick={onUp}><Arrow d="M6 15l6-6 6 6" /></button>
      <button type="button" aria-label={`Move ${label} down`} disabled={!onDown} onClick={onDown}><Arrow d="M6 9l6 6 6-6" /></button>
    </span>
  );
}

function tick(item: BoardItem, done: boolean) {
  const a = item.action;
  if (done) confetti();
  if (a.type === "checklist") return act("checklists.check", { kind: a.kind, id: a.id, listId: a.listId, itemId: a.itemId, done }, done ? { text: `Done: ${item.label}`, undo: true } : undefined);
  if (a.type === "todo") return act("todos.check", { id: a.id, done }, done ? { text: `Done: ${item.label}`, undo: true } : undefined);
  if (!done) return;
  // A due next step is done: clear it on the pitch. A quiet pitch: log a follow up today, so it leaves until it goes quiet again.
  if (a.due) return act("pitches.update", { id: a.id, patch: { nextStep: null } }, { text: `Next step done: ${item.label}`, undo: true });
  return act("pitches.log", { id: a.id, type: "email", text: "Followed up (ticked on To Dos)" }, { text: "Logged a follow up today", undo: true });
}

function Card({ item, musicians, grip, onUp, onDown }: { item: BoardItem; musicians: Row<Musician>[]; grip: object; onUp?(): void; onDown?(): void }) {
  const a = item.action;
  const testid = `todos-item-${item.key}`;
  if (a.type === "todo") {
    // An Our list to-do looks like every other card (Jeff, 2026-11-12): the text full width (click to edit; clearing it removes it),
    // who's on it underneath (click to pick), the × and the pin on the right.
    const people = activePeople(musicians);
    const cid = `td-c-${item.key.replace(/[^a-z0-9]/gi, "-")}`;
    const remove = () => act("todos.remove", { id: a.id }, { text: `Removed: ${item.label}`, undo: true });
    return (
      <div className={`td-it${item.done ? " done" : ""}`} data-testid={testid}>
        <Grip {...grip} />
        <TickBox id={cid} item={item} />
        <div className="td-tx">
          <InlineValue testid={`todos-text-${a.id}`} label="To do" kind="text" value={item.label} canEdit enterSaves className="td-label"
            onSave={async (v) => { const t = v.trim(); if (t === item.label) return true; if (!t) return !!(await remove()); return !!(await act("todos.edit", { id: a.id, label: t })); }} />
          <div className="td-meta">
            {item.source && <span data-testid="todos-source">{item.source.text}</span>}
            <InlineValue testid={`todos-who-${a.id}`} label="Who" kind="select" value={item.ownerId ?? ""} canEdit emptyLabel="Unassigned"
              display={item.ownerId ? <span className="td-who">{nameOf(musicians, item.ownerId)}</span> : "Unassigned"}
              options={[["", "Unassigned"], ...people.map((m) => [m.id, m.name] as const)]}
              onSave={async (v) => v === (item.ownerId ?? "") || !!(await act("todos.edit", { id: a.id, ownerId: v || null }))} />
          </div>
        </div>
        <button type="button" className="td-pin" aria-label={`Remove ${item.label}`} title="Remove" data-testid={`todos-remove-${a.id}`} onClick={() => void remove()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
        {!item.done && <PinButton item={item} onPin={(pinned) => act("todos.pin", { id: a.id, pinned })} />}
        <MoveButtons label={item.label} onUp={onUp} onDown={onDown} />
      </div>
    );
  }
  const cid = `td-c-${item.key.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <div className={`td-it${item.done ? " done" : ""}`} data-testid={testid}>
      <Grip {...grip} />
      <TickBox id={cid} item={item} />
      <div className="td-tx">
        <label className="td-label" htmlFor={cid}>{item.label}</label>
        <div className="td-meta">
          {item.source && (item.source.href ? <Link href={item.source.href} data-testid="todos-source">{item.source.text}</Link> : <span data-testid="todos-source">{item.source.text}</span>)}
          {a.type === "checklist" && (item.ownerId ? <span className="td-who">{nameOf(musicians, item.ownerId)}</span> : <span>Unassigned</span>)}
          {item.chip && <span className={`chip ${item.chip.tone}`}>{item.chip.text}</span>}
          {item.note && <span>{item.note}</span>}
        </div>
      </div>
      {a.type === "checklist" && !item.done && <PinButton item={item} onPin={(pinned) => act("checklists.pin", { kind: a.kind, id: a.id, listId: a.listId, itemId: a.itemId, pinned })} />}
      <MoveButtons label={item.label} onUp={onUp} onDown={onDown} />
    </div>
  );
}

/** The card's checkbox: flips at once, then follows the record (a failed save puts it back). */
function TickBox({ id, item }: { id: string; item: BoardItem }) {
  const [want, setWant] = useState<boolean | null>(null);
  useEffect(() => { setWant(null); }, [item.done]);
  return (
    <input type="checkbox" id={id} checked={want ?? item.done} data-testid={`todos-check-${item.key}`}
      onChange={async (e) => { const d = e.target.checked; setWant(d); if (!(await tick(item, d))) setWant(null); }} />
  );
}

function PinButton({ item, onPin }: { item: BoardItem; onPin(pinned: boolean): void }) {
  return (
    <button type="button" className="td-pin" aria-pressed={!!item.pinned} aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.label}`} title={item.pinned ? "Unpin" : "Pin to the top"}
      data-testid={`todos-pin-${item.key}`} onClick={() => onPin(!item.pinned)}>
      <PinIcon on={item.pinned} />
    </button>
  );
}

/**
 * A "+" button that opens a one-line form: nothing is made until Add is pressed, and Cancel (or Escape) throws the draft away.
 * After an Add the form stays open and empty, ready for the next one.
 */
function AddForm({ open: openLabel, placeholder, testid, className, onAdd, startOpen = false, onCancel }: { open: string; placeholder: string; testid: string; className?: string; onAdd(text: string): Promise<unknown>; startOpen?: boolean; onCancel?(): void }) {
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const cancel = () => { setText(""); setOpen(false); onCancel?.(); };
  async function add() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await onAdd(t);
    setBusy(false);
    if (r) setText("");
  }
  if (!open) return (
    <button type="button" className={`td-addbtn ${className ?? ""}`} onClick={() => setOpen(true)} data-testid={testid}>
      <span aria-hidden>+</span> {openLabel}
    </button>
  );
  return (
    <form className={`td-addform ${className ?? ""}`} data-testid={`${testid}-form`} onSubmit={(e) => { e.preventDefault(); void add(); }}
      onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}>
      <input className="input" autoFocus placeholder={placeholder} aria-label={placeholder} value={text} onChange={(e) => setText(e.target.value)} data-testid={`${testid}-input`} />
      <div className="flex gap-2">
        <button type="submit" className="btn sm" disabled={busy || !text.trim()} data-testid={`${testid}-add`}>Add</button>
        <button type="button" className="btn sm ghost" onClick={cancel} data-testid={`${testid}-cancel`}>Cancel</button>
      </div>
    </form>
  );
}

/** "+ Add a to do" at the bottom of a list: onto its checklist, or Our list (Pinned's go in pinned). */
function AddItem({ target, testid }: { target: AddTarget; testid: string }) {
  const add = (label: string) => target.type === "checklist"
    ? act("checklists.addItem", { kind: target.kind, id: target.id, listId: target.listId, label })
    : act("todos.add", { label, ...(target.pinned ? { pinned: true } : {}) });
  return <AddForm open="Add a to do" placeholder="New to do" testid={testid} onAdd={add} />;
}

/**
 * "+ Add list" at the bottom of a column that holds checklists (Jeff, 2026-11-12): the record page's "New list", a template for that
 * kind or a blank list (named, then Add). The releases column asks which release first.
 */
function AddList({ newList, artistId, testid }: { newList: NonNullable<BoardColumn["newList"]>; artistId: string; testid: string }) {
  const { templates: all } = useChecklistTemplates(artistId, true);
  const templates = all.filter((t) => templateKind(t) === newList.kind);
  const [target, setTarget] = useState(newList.targets.length === 1 ? newList.targets[0].id : "");
  const [naming, setNaming] = useState(false);
  const at = { kind: newList.kind, id: target };
  const label = newList.targets.find((t) => t.id === target)?.label ?? "";
  if (!newList.targets.length) return null;
  if (naming) return <AddForm startOpen open="Add list" placeholder="List name" testid={`${testid}-blank`}
    onAdd={async (name) => { const r = await act("checklists.add", { ...at, name }, { text: `Added ${name} to ${label}` }); if (r) setNaming(false); return r; }} onCancel={() => setNaming(false)} />;
  return (
    <div className="td-addlist" data-testid={testid}>
      {newList.targets.length > 1 && (
        <select className="select !w-auto max-w-full" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Add a list to which one" data-testid={`${testid}-target`}>
          <option value="">Add a list to…</option>
          {newList.targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      )}
      {target && <Menu label="Add list" testid={`${testid}-menu`} triggerClass="td-addbtn" trigger={<><span aria-hidden>+</span> Add list</>} items={[
        ...templates.map((t) => ({ key: `template-${t.id}`, label: t.name, onSelect: () => void act("checklists.add", { ...at, templateId: t.id }, { text: `Added ${t.name} to ${label}` }) })),
        { key: "blank", label: "Blank list", divider: templates.length > 0, onSelect: () => setNaming(true) },
      ]} />}
    </div>
  );
}

/** Which lists this person has folded shut on To Dos: on this device (localStorage), per artist. */
interface Folds { shut: Set<string>; toggle(key: string): void }
function useFolds(artistId: string): Folds {
  const storeKey = `todos:folded:${artistId}`;
  const [shut, setShut] = useState<Set<string>>(new Set());
  useEffect(() => {
    try { setShut(new Set(JSON.parse(localStorage.getItem(storeKey) ?? "[]") as string[])); } catch { /* no storage: everything open */ }
  }, [storeKey]);
  const toggle = (key: string) => setShut((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    try { localStorage.setItem(storeKey, JSON.stringify([...next])); } catch { /* not remembered */ }
    return next;
  });
  return { shut, toggle };
}
