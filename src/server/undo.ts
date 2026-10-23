/**
 * Undo a whole run: every history entry with the runId is reversed, newest first, through Writer.revert, so the
 * reversals are themselves written to history under a NEW runId (which can be undone in turn = redo).
 * A field that was edited again after the run is left alone (reported in changedSince / skippedFields), never overwritten.
 * Immutable collections (ledger, statSnapshots) are skipped and reported; add a correction instead.
 * Things outside Firestore (sent email, Calendar events, Bandsintown listings, Drive copies) are not undone.
 */
import type { Timestamp } from "firebase-admin/firestore";
import { collections, kindOf } from "@/schema";
import { newRunId, type Ctx } from "./ctx";
import { db, run, type Doc } from "./db";
import { AppError } from "./errors";

export interface UndoItem { kind: string; id: string; op: string; as?: string; reason?: string; /** Fields left alone because they changed again after this run. */ skippedFields?: string[] }
export interface UndoReport {
  undoRunId: string;
  /** Changes put back. */
  reverted: UndoItem[];
  /** Already in the wanted state (for example created, then archived later). */
  unchanged: UndoItem[];
  /** Immutable records that were not touched: correct these by hand. */
  needsManualCorrection: UndoItem[];
  /** Could not be reversed for another reason (document gone, no longer valid). */
  failed: UndoItem[];
  /** Entries where every changed field was edited again since: nothing was overwritten. */
  changedSince: UndoItem[];
}

const CHUNK = 100;
const tsKey = (d: Doc) => {
  const t = d.createdAt as Timestamp | undefined;
  return [t?.seconds ?? 0, t?.nanoseconds ?? 0, (d.seq as number | undefined) ?? 0] as const;
};
const byTime = (a: Doc, b: Doc) => {
  const x = tsKey(a), y = tsKey(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

export async function historyOfRun(runId: string): Promise<Doc[]> {
  return (await db.list("history", (q) => q.where("runId", "==", runId))).sort(byTime);
}

function place(report: UndoReport, item: UndoItem, changed: boolean, skipped?: string[]) {
  if (skipped?.length) item = { ...item, skippedFields: skipped };
  (changed ? report.reverted : skipped?.length ? report.changedSince : report.unchanged).push(item);
}

/** `ownerUid`: when set, every change in the run must have been made by that user (MCP users undo their own runs only). */
export async function undoRun(ctx: Ctx, runId: string, opts: { ownerUid?: string } = {}): Promise<UndoReport> {
  const entries = await historyOfRun(runId);
  if (!entries.length) throw new AppError("not_found", `No changes recorded for run ${runId}`, 404);
  if (opts.ownerUid && entries.some((e) => e.actor?.uid !== opts.ownerUid)) {
    throw new AppError("forbidden", "You can only undo your own runs", 403);
  }
  const report: UndoReport = { undoRunId: newRunId(), reverted: [], unchanged: [], needsManualCorrection: [], failed: [], changedSince: [] };
  const undoCtx: Ctx = { ...ctx, runId: report.undoRunId };

  const todo: Doc[] = [];
  for (const e of [...entries].reverse()) {
    const item = { kind: e.entity.kind as string, id: e.entity.id as string, op: e.op as string };
    if (collections[kindOf(item.kind)]?.immutable) {
      report.needsManualCorrection.push({ ...item, reason: "Immutable record: add a correction instead" });
    } else todo.push(e);
  }
  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    try {
      await run(undoCtx, async (w) => {
        const done: { item: UndoItem; changed: boolean; skipped?: string[] }[] = [];
        for (const e of chunk) {
          const item = { kind: e.entity.kind as string, id: e.entity.id as string, op: e.op as string };
          const r = await w.revert(item.kind, item.id, item.op, e.diff);
          done.push({ item: { ...item, as: r.as }, changed: r.changed, skipped: r.skipped });
        }
        return done;
      }).then((done) => {
        for (const d of done) place(report, d.item, d.changed, d.skipped);
      });
    } catch (err) {
      // One bad entry must not hide the rest: fall back to one transaction per entry for this chunk.
      for (const e of chunk) {
        const item = { kind: e.entity.kind as string, id: e.entity.id as string, op: e.op as string };
        try {
          const r = await run(undoCtx, (w) => w.revert(item.kind, item.id, item.op, e.diff));
          place(report, { ...item, as: r.as }, r.changed, r.skipped);
        } catch (e2) {
          report.failed.push({ ...item, reason: e2 instanceof Error ? e2.message : String(e2) });
        }
      }
      void err;
    }
  }
  return report;
}

/** Recent runs by one actor, newest first: {runId, via, at, changes, entities}. */
export async function runsOf(uid: string, limit = 20) {
  const rows = await db.list("history", (q) => q.where("actor.uid", "==", uid));
  const runs = new Map<string, { runId: string; via: string; at: string; changes: number; entities: Set<string> }>();
  for (const r of rows.sort(byTime)) {
    const cur = runs.get(r.runId) ?? { runId: r.runId as string, via: r.actor.via as string, at: (r.createdAt as Timestamp).toDate().toISOString(), changes: 0, entities: new Set<string>() };
    cur.changes++;
    cur.entities.add(r.entity.kind);
    runs.set(r.runId, cur);
  }
  return [...runs.values()].reverse().slice(0, limit).map((r) => ({ ...r, entities: [...r.entities] }));
}
