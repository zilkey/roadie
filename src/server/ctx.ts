import { randomUUID } from "node:crypto";
import type { Via } from "@/schema/common";

export type Role = "admin" | "member" | "mcp";

/** What every context carries: who is calling, how, and the run their writes belong to. */
interface CtxBase {
  uid: string;
  via: Via;
  runId: string;
  /** Injectable clock (tests). Defaults to the real time. */
  now?: Date;
  /** Set by dispatch for autosave patches from the app: lets Writer.update fold them into the previous history entry. */
  autosave?: boolean;
  /** Set by dispatch: the `rev` the caller last saw of document `id`. Writer.update refuses to overwrite fields changed since. */
  baseRev?: { id: string; rev: number };
  /** Which assistant session made the call (Roadie: the thread id). The history entry records it. */
  sessionId?: string;
  /** Which assistant made the call, and the model if known (Roadie: {name: "Roadie", model}). */
  client?: { name: string; model?: string };
  /** Filled by Writer: doc id -> rev after this call's writes. Dispatch returns it so clients can track revs. */
  touched?: Record<string, number>;
}

/**
 * A call for one artist (tenancy plan D3): every read and write of an artist kind is scoped to `artistId` by the Writer and `db`
 * (src/server/db.ts). Built by `artistCtx` (authenticate, the MCP and Shortcut token checks, public link verifiers) and `importCtx`.
 */
export interface ArtistCtx extends CtxBase {
  /** The caller's role in `artistId`. MCP sessions use "mcp". */
  role: Role;
  artistId: string;
  /** The caller's musician in `artistId` (their membership's), when they have one. */
  musicianId?: string;
  system?: undefined;
  person?: undefined;
}

/**
 * A verified person with no artist (yet): invites.list / accept / decline and the new-artist path. Reads of artist kinds see
 * nothing; the invite commands reach the invited artist through narrow, allow-listed steps (`w.forArtist`).
 */
export interface PersonCtx extends CtxBase {
  person: true;
  email: string;
  role?: undefined;
  artistId?: undefined;
  musicianId?: undefined;
  system?: undefined;
}

/**
 * Whole-database server code: migrations, backup, restore, wipe, cron, the venue-calendar refresh, denormalization across artists.
 * Reads are unscoped. Only the allow-listed files may build one (tests/unit/tenancy-guard.test.ts).
 */
export interface SystemCtx extends CtxBase {
  system: true;
  reason: string;
  role?: undefined;
  artistId?: undefined;
  musicianId?: undefined;
  person?: undefined;
}

/** What commands run with: always one artist. */
export type Ctx = ArtistCtx;
export type AnyCtx = ArtistCtx | PersonCtx | SystemCtx;

export const newRunId = () => randomUUID();

export const artistCtx = (c: Omit<ArtistCtx, "runId" | "system" | "person"> & { runId?: string }): ArtistCtx => ({ ...c, runId: c.runId ?? newRunId() });
export const personCtx = (uid: string, email: string, via: Via = "app"): PersonCtx => ({ person: true, uid, email, via, runId: newRunId() });
/** `uid` names who the writes are by in History (default: the reason, e.g. "venue-calendars"). */
export const systemCtx = (reason: string, opts: { uid?: string; runId?: string; via?: Via } = {}): SystemCtx => ({
  system: true, reason, uid: opts.uid ?? reason, via: opts.via ?? "import", runId: opts.runId ?? newRunId(),
});
/** An import or script writing one artist's records as that artist's admin. */
export const importCtx = (artistId: string, uid = "import", runId: string = newRunId()): ArtistCtx => ({ uid, role: "admin", via: "import", runId, artistId });

export const isSystem = (c: AnyCtx): c is SystemCtx => c.system === true;
export const isPerson = (c: AnyCtx): c is PersonCtx => c.person === true;
