/**
 * To Dos: one board of everything open across shows, releases, the Social Media sidebar, booking and Our list. Pure (no server or
 * browser imports): the page builds its columns with `buildBoard`, the server checks keys with the patterns.
 *
 * Item keys: show:{showId}:{listId}:{itemId}, release:{releaseId}:{listId}:{itemId}, social:{artistId}:{listId}:{itemId},
 * pitch:{pitchId}, todo:{id}. A checklist's key (what Dismiss stores) is the item key without the item: show:{showId}:{listId}.
 * Column keys: pinned, booking, show:{showId}, releases, social, our.
 */
import { followUpFor, fmtPitchDate, STATUS_LABEL, todayStr, type FollowUpPitchLike, type Status } from "./booking";
import { isOff, showName, type ChecklistItem, type ChecklistKind, type ChecklistLike, type ShowPlaceLike } from "./shows";

export const TODO_COLUMN_KEY = /^(pinned|booking|releases|social|our|show:[^:\s]+)$/;
export const TODO_CHECKLIST_KEY = /^(show|release|social):[^:\s]+:[^:\s]+$/;

export const checklistKey = (kind: ChecklistKind, id: string, listId: string) => `${kind}:${id}:${listId}`;
export const itemKey = (kind: ChecklistKind, id: string, listId: string, itemId: string) => `${checklistKey(kind, id, listId)}:${itemId}`;

/** What ticking a card does. */
export type BoardAction =
  | { type: "checklist"; kind: ChecklistKind; id: string; listId: string; itemId: string }
  | { type: "pitch"; id: string; due: boolean }
  | { type: "todo"; id: string };

export interface BoardItem {
  key: string;
  label: string;
  done: boolean;
  /** A musician; missing = unassigned. Booking cards have none. */
  ownerId?: string;
  /** Booking cards: the pitch's assignee (a user id). */
  assigneeId?: string;
  pinned?: boolean;
  /** Where it lives, as a link ("Sat Nov 14 Hi-Dive › Advance"): Pinned and Booking cards. */
  source?: { text: string; href: string };
  /** A small chip: "Due Mon, Nov 9" (red when overdue), "Due today", "21 days quiet". */
  chip?: { text: string; tone: "r" | "y" | "a" };
  /** Extra plain text in the meta row (a pitch's status). */
  note?: string;
  action: BoardAction;
}
export interface BoardGroup {
  /** The checklist key (Dismiss). Missing for flat columns. */
  key?: string;
  title?: string;
  /** "Spring EP" links to the release; the rest of the title is text. */
  titleLink?: { text: string; href: string };
  done?: number;
  total?: number;
  items: BoardItem[];
}
export interface BoardColumn {
  key: string;
  title: string;
  href?: string;
  /** Short name for the phone's chips ("Hi-Dive", "Social"). */
  chip: string;
  caption?: string;
  groups: BoardGroup[];
}

export interface ShowLike extends ShowPlaceLike { id: string; date: string; status: string; checklists?: ChecklistLike[]; deletedAt?: unknown }
export interface ReleaseLike { id: string; title: string; checklists?: ChecklistLike[] }
export interface PitchLike extends FollowUpPitchLike { id: string; target: { kind: string; id: string; name: string }; assigneeId?: string; nextStep?: { text: string; due: string } | null }
export interface TodoLike { id: string; label: string; done: boolean; ownerId?: string }

export interface BoardInput {
  artistId: string;
  shows: ShowLike[];
  releases: ReleaseLike[];
  social: ChecklistLike[];
  pitches: PitchLike[];
  todos: TodoLike[];
  /** The caller's saved order per column (userPrefs todoOrder). */
  order: Record<string, string[]>;
  dismissed: string[];
  /** Mine: only items assigned to this musician or to nobody (booking: assigned to this user or to nobody). */
  mine?: { musicianId?: string; userId: string } | null;
  showDone: boolean;
  today?: string;
}

/** "Sat Nov 14". */
export const shortDate = (d: string) => fmtPitchDate(d).replace(",", "");

/** Items in the saved order: those with a saved place first (in it), the rest after in their natural order. */
export function applyOrder<T extends { key: string }>(items: T[], saved: readonly string[] | undefined): T[] {
  if (!saved?.length) return items;
  const at = new Map(saved.map((k, i) => [k, i]));
  const placed = items.filter((x) => at.has(x.key)).sort((a, b) => at.get(a.key)! - at.get(b.key)!);
  return [...placed, ...items.filter((x) => !at.has(x.key))];
}

/** The column's keys, top first, after moving the item at `from` to `to` inside one of its groups. */
export function movedOrder(col: BoardColumn, group: number, from: number, to: number): string[] {
  return col.groups.flatMap((g, gi) => {
    const keys = g.items.map((i) => i.key);
    if (gi !== group) return keys;
    const [k] = keys.splice(from, 1);
    keys.splice(to, 0, k);
    return keys;
  });
}

function checklistItems(kind: ChecklistKind, id: string, list: ChecklistLike, keep: (i: ChecklistItem) => boolean, source?: { text: string; href: string }): BoardItem[] {
  return list.items.filter(keep).map((i) => ({
    key: itemKey(kind, id, list.id, i.id), label: i.label, done: i.done, ownerId: i.ownerId, pinned: !!i.pinnedAt,
    ...(source ? { source } : {}), action: { type: "checklist", kind, id, listId: list.id, itemId: i.id },
  }));
}

export function buildBoard(b: BoardInput): BoardColumn[] {
  const today = b.today ?? todayStr();
  const dismissed = new Set(b.dismissed);
  const mineItem = (i: BoardItem) => !b.mine || (i.action.type === "pitch" ? !i.assigneeId || i.assigneeId === b.mine.userId : !i.ownerId || i.ownerId === b.mine.musicianId);
  const shown = (i: BoardItem) => (b.showDone || !i.done) && mineItem(i);
  const ordered = (key: string, groups: BoardGroup[]) => groups.map((g) => ({ ...g, items: applyOrder(g.items.filter(shown), b.order[key]) }));

  // Show columns are for upcoming shows; a pin on any live show (past ones too) still lands in Pinned.
  const live = b.shows.filter((s) => !s.deletedAt && !isOff(s)).sort((x, y) => x.date.localeCompare(y.date));
  const shows = live.filter((s) => s.date >= today);
  const showTitle = (s: ShowLike) => `${shortDate(s.date)} ${showName(s)}`;
  const releaseHref = (r: ReleaseLike) => `/releases/${r.id}`;

  // Pinned: every pinned item, from any list (dismissed or not), in source order: shows, releases, Social Media.
  const pinned: BoardItem[] = [
    ...live.flatMap((s) => (s.checklists ?? []).flatMap((l) => checklistItems("show", s.id, l, (i) => !!i.pinnedAt, { text: `${showTitle(s)} › ${l.name}`, href: `/shows/${s.id}` }))),
    ...b.releases.flatMap((r) => (r.checklists ?? []).flatMap((l) => checklistItems("release", r.id, l, (i) => !!i.pinnedAt, { text: `${r.title} › ${l.name}`, href: releaseHref(r) }))),
    ...b.social.flatMap((l) => checklistItems("social", b.artistId, l, (i) => !!i.pinnedAt, { text: `Social Media › ${l.name}`, href: "/posts" })),
  ];

  const booking: BoardItem[] = b.pitches.flatMap((p) => {
    const f = followUpFor(p, today);
    if (!f) return [];
    const href = `/booking/pitches/${p.id}`;
    const days = f.daysSinceContact ?? 0;
    const item: BoardItem = f.due
      ? { key: `pitch:${p.id}`, label: p.nextStep!.text, done: false, assigneeId: p.assigneeId, source: { text: p.target.name, href },
        chip: p.nextStep!.due < today ? { text: `Due ${shortDate(p.nextStep!.due)}`, tone: "r" } : { text: "Due today", tone: "y" }, action: { type: "pitch", id: p.id, due: true } }
      : { key: `pitch:${p.id}`, label: `Follow up with ${p.target.name}`, done: false, assigneeId: p.assigneeId, source: { text: p.target.name, href },
        chip: { text: `${days} days quiet`, tone: "y" }, note: STATUS_LABEL[p.status as Status], action: { type: "pitch", id: p.id, due: false } };
    return [{ ...item, days }];
  }).sort((x, y) => y.days - x.days).map(({ days: _d, ...i }) => i);

  /** A checklist as a group of its unpinned items, unless dismissed. */
  const group = (kind: ChecklistKind, id: string, l: ChecklistLike, extra: Partial<BoardGroup> = {}): BoardGroup[] => {
    const key = checklistKey(kind, id, l.id);
    if (dismissed.has(key)) return [];
    return [{ key, title: l.name, done: l.items.filter((i) => i.done).length, total: l.items.length, items: checklistItems(kind, id, l, (i) => !i.pinnedAt), ...extra }];
  };
  const nonEmpty = (gs: BoardGroup[]) => gs.filter((g) => g.items.length);

  const showCols: BoardColumn[] = shows.map((s) => ({
    key: `show:${s.id}`, title: `${shortDate(s.date)} · ${showName(s)}`, chip: showName(s), href: `/shows/${s.id}`,
    groups: nonEmpty(ordered(`show:${s.id}`, (s.checklists ?? []).flatMap((l) => group("show", s.id, l)))),
  })).filter((c) => c.groups.length);

  return [
    { key: "pinned", title: "Pinned", chip: "Pinned", caption: "Pinned from any checklist. Unpin to send it back.", groups: ordered("pinned", [{ items: pinned }]) },
    { key: "booking", title: "Booking", chip: "Booking", href: "/booking/pitches", caption: "Pitches that need a follow up: a next step that's due, or 14+ days quiet.", groups: ordered("booking", [{ items: booking }]) },
    ...showCols,
    {
      key: "releases", title: "Releases", chip: "Releases", href: "/releases",
      groups: nonEmpty(ordered("releases", b.releases.flatMap((r) => (r.checklists ?? []).flatMap((l) => group("release", r.id, l, { titleLink: { text: r.title, href: releaseHref(r) } }))))),
    },
    { key: "social", title: "Social Media", chip: "Social", href: "/posts", groups: nonEmpty(ordered("social", b.social.flatMap((l) => group("social", b.artistId, l)))) },
    {
      key: "our", title: "Our list", chip: "Our list", caption: "For the band, not tied to any show or release.",
      groups: ordered("our", [{ items: b.todos.map((t) => ({ key: `todo:${t.id}`, label: t.label, done: t.done, ownerId: t.ownerId, action: { type: "todo", id: t.id } as const })) }]),
    },
  ];
}

export const columnCount = (c: BoardColumn) => c.groups.reduce((n, g) => n + g.items.filter((i) => !i.done).length, 0);

/** The dismissed checklists that still exist, with a name to list under "Dismissed (n)". */
export function dismissedLists(b: Pick<BoardInput, "artistId" | "shows" | "releases" | "social" | "dismissed">): { key: string; title: string }[] {
  const names = new Map<string, string>();
  for (const s of b.shows) for (const l of s.checklists ?? []) names.set(checklistKey("show", s.id, l.id), `${shortDate(s.date)} ${showName(s)} › ${l.name}`);
  for (const r of b.releases) for (const l of r.checklists ?? []) names.set(checklistKey("release", r.id, l.id), `${r.title} › ${l.name}`);
  for (const l of b.social) names.set(checklistKey("social", b.artistId, l.id), `Social Media › ${l.name}`);
  return b.dismissed.filter((k) => names.has(k)).map((k) => ({ key: k, title: names.get(k)! }));
}
