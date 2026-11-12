"use client";
import { useEffect, useState } from "react";
import Link, { useArtist } from "@/lib/artist";
import { useProfile } from "@/lib/auth";
import { useCollection, useDoc, type Row } from "@/lib/firestore-hooks";
import { runCommandFull } from "@/lib/commands";
import { useDragReorder } from "@/lib/drag-reorder";
import { buildBoard, columnCount, dismissedLists, movedOrder, type BoardColumn, type BoardGroup, type BoardItem, type PitchLike, type ReleaseLike, type ShowLike, type TodoLike } from "@/lib/todos";
import type { ChecklistLike } from "@/lib/shows";
import type { Musician } from "@/schema";
import { PageTitle } from "@/components/ui";
import { toast, UNDO_MS } from "@/components/Toasts";
import { ChecklistItem, PinIcon } from "@/components/shows/checklists/ChecklistItem";
import { activePeople } from "@/components/shows/checklists/shared";
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
 * To Dos: everything open across shows, releases, the Social Media sidebar, booking and Our list, one column per source.
 * Order and Dismiss are this person's own (userPrefs); ticking, pinning and Our list are the band's.
 */
export function TodoBoard() {
  const { artistId } = useArtist();
  const p = useProfile();
  const mineOf = { where: [["artistId", "==", artistId] as [string, "==", string]] };
  const shows = useCollection<ShowLike>("shows", mineOf);
  const releases = useCollection<ReleaseLike>("releases", mineOf);
  const pitches = useCollection<PitchLike>("pitches", mineOf);
  const todos = useCollection<TodoLike>("todos", mineOf);
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const social = useDoc<{ checklists?: ChecklistLike[] }>("socialChecklists", artistId).doc;
  const prefs = useDoc<{ todoOrder?: Record<string, string[]>; todoDismissed?: string[] }>("userPrefs", p.uid).doc;

  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [openDismissed, setOpenDismissed] = useState(false);
  const [phoneCol, setPhoneCol] = useState("pinned");
  /** Orders just dragged, shown before userPrefs catches up. */
  const [moved, setMoved] = useState<Record<string, string[]>>({});

  const order = { ...(prefs?.todoOrder ?? {}), ...moved };
  const dismissed = prefs?.todoDismissed ?? [];
  const input = {
    artistId, shows: shows.rows ?? [], releases: releases.rows ?? [], social: social?.checklists ?? [], pitches: pitches.rows ?? [], todos: todos.rows ?? [],
    order, dismissed, mine: mine ? { musicianId: p.musicianId, userId: p.userId } : null, showDone,
  };
  const cols = buildBoard(input);
  const gone = dismissedLists(input);
  const loading = [shows, releases, pitches, todos].some((c) => c.loading);
  const at = cols.some((c) => c.key === phoneCol) ? phoneCol : "pinned";

  const setOrder = (col: BoardColumn, keys: string[]) => {
    setMoved((m) => ({ ...m, [col.key]: keys }));
    void act("todos.setOrder", { column: col.key, keys });
  };

  return (
    <div className="grid gap-4" data-testid="todos-page">
      <PageTitle title="To Dos" sub="Everything open across shows, releases, Social Media and booking. Drag to reorder: it only changes this page, and only for you."
        actions={<>
          <div className="seg" role="radiogroup" aria-label="Whose">
            <label><input type="radio" name="todos-whose" checked={!mine} onChange={() => setMine(false)} data-testid="todos-everyone" />Everyone</label>
            <label><input type="radio" name="todos-whose" checked={mine} onChange={() => setMine(true)} data-testid="todos-mine" />Mine</label>
          </div>
          <label className="inline-flex min-h-10 items-center gap-2 font-semibold">
            <input type="checkbox" className="h-[18px] w-[18px]" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} data-testid="todos-show-done" />Show done
          </label>
          <button type="button" className="btn sm ghost" aria-expanded={openDismissed} onClick={() => setOpenDismissed((o) => !o)} data-testid="todos-dismissed">Dismissed ({gone.length})</button>
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
        <div className="td-board">
          {cols.map((c) => <Column key={c.key} col={c} on={c.key === at} musicians={musicians} onOrder={(keys) => setOrder(c, keys)} />)}
        </div>
      )}
    </div>
  );
}

function Column({ col, on, musicians, onOrder }: { col: BoardColumn; on: boolean; musicians: Row<Musician>[]; onOrder(keys: string[]): void }) {
  const empty = !col.groups.some((g) => g.items.length);
  const id = `td-${col.key.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <section className="td-col" aria-labelledby={id} data-on={on ? "" : undefined} data-testid={`todos-col-${col.key}`}>
      <div className="td-ch">
        <h2 id={id}>{col.href ? <Link href={col.href}>{col.title}</Link> : col.title}</h2>
        <span className="td-n">{columnCount(col)}</span>
      </div>
      {col.caption && <p className="td-cs">{col.caption}</p>}
      {col.key === "our" && <AddTodo />}
      {empty && col.key !== "our" && <p className="td-none">{col.key === "pinned" ? "Nothing pinned. Pin an item on any checklist to see it here." : "Nothing to do here."}</p>}
      {col.groups.map((g, gi) => <Group key={g.key ?? gi} col={col} g={g} gi={gi} musicians={musicians} onOrder={onOrder} />)}
      {col.key === "booking" && <p className="td-tip">Ticking a next step marks it done on the pitch. Ticking a quiet pitch logs a follow up today, so it leaves until it goes quiet again.</p>}
      {col.key === "our" && <p className="td-tip">Click the text to edit it and pick who. Clear the text to remove it.</p>}
    </section>
  );
}

function Group({ col, g, gi, musicians, onOrder }: { col: BoardColumn; g: BoardGroup; gi: number; musicians: Row<Musician>[]; onOrder(keys: string[]): void }) {
  const move = (from: number, to: number) => onOrder(movedOrder(col, gi, from, to));
  const drag = useDragReorder(move);
  if (!g.items.length && col.key !== "our") return null;
  return (
    <>
      {g.title && (
        <div className="td-grp" data-testid={`todos-group-${g.key}`}>
          <h3>{g.titleLink ? <><Link href={g.titleLink.href}>{g.titleLink.text}</Link> › {g.title}</> : g.title}</h3>
          <span className="td-cnt">{g.done} of {g.total}</span>
          {g.key && <button type="button" className="td-dis" aria-label={`Dismiss ${g.title}`} data-testid={`todos-dismiss-${g.key}`}
            onClick={() => act("todos.dismiss", { key: g.key }, { text: `${g.title} dismissed. Find it under Dismissed to show it again.` })}>Dismiss</button>}
        </div>
      )}
      <ul className="td-list">
        {g.items.map((item, i) => (
          <li key={item.key} {...drag.row(i)}>
            <Card item={item} musicians={musicians} grip={drag.handle(i)}
              onUp={i > 0 ? () => move(i, i - 1) : undefined} onDown={i < g.items.length - 1 ? () => move(i, i + 1) : undefined} />
          </li>
        ))}
      </ul>
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
    const people = activePeople(musicians);
    return (
      <div className={`td-it${item.done ? " done" : ""}`} data-testid={testid}>
        <Grip {...grip} />
        <div className="min-w-0 grow">
          <ChecklistItem item={{ id: a.id, label: item.label, done: item.done, ownerId: item.ownerId }} people={people} musicians={musicians}
            onToggle={(d) => tick(item, d)}
            onSave={(n) => act("todos.edit", { id: a.id, label: n.label, ownerId: n.ownerId })}
            onRemove={() => act("todos.remove", { id: a.id }, { text: `Removed: ${item.label}`, undo: true })} />
        </div>
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
          {item.source && <Link href={item.source.href} data-testid="todos-source">{item.source.text}</Link>}
          {a.type === "checklist" && (item.ownerId ? <span className="td-who">{nameOf(musicians, item.ownerId)}</span> : <span>Unassigned</span>)}
          {item.chip && <span className={`chip ${item.chip.tone}`}>{item.chip.text}</span>}
          {item.note && <span>{item.note}</span>}
        </div>
      </div>
      {a.type === "checklist" && !item.done && (
        <button type="button" className="td-pin" aria-pressed={!!item.pinned} aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.label}`} title={item.pinned ? "Unpin" : "Pin to the top"}
          data-testid={`todos-pin-${item.key}`} onClick={() => act("checklists.pin", { kind: a.kind, id: a.id, listId: a.listId, itemId: a.itemId, pinned: !item.pinned })}>
          <PinIcon on={item.pinned} />
        </button>
      )}
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

/** "Add a to do" at the top of Our list. */
function AddTodo() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    const label = text.trim();
    if (!label || busy) return;
    setBusy(true);
    const r = await act("todos.add", { label });
    setBusy(false);
    if (r) setText("");
  }
  return (
    <form className="td-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <input className="input min-w-0 grow" placeholder="Add a to do" aria-label="New to do" value={text} onChange={(e) => setText(e.target.value)} data-testid="todos-add-input" />
      <button type="submit" className="btn" disabled={busy || !text.trim()} data-testid="todos-add">Add</button>
    </form>
  );
}
