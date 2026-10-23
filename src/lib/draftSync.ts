"use client";
import { doc, getDoc } from "firebase/firestore";
import { onIdTokenChanged } from "firebase/auth";
import { clientAuth, clientDb } from "./firebase-client";
import { CommandError, runCommand } from "./commands";
import { draftDocId } from "@/schema/drafts";
import type { SaveState } from "./autosave";

/**
 * Client side of unsubmittedDrafts/{uid}__{path}. One DraftChannel per (user, path); useDraft (new records) and useAutosave
 * (unsaved edits to an existing record) both write through it. Every change goes to localStorage at once, then to the server
 * 500ms later; the LATEST write simply wins (no merge, no timestamps). On pagehide / hidden the pending write is sent with
 * fetch keepalive so a closing tab still lands. Offline, the local copy stays and is pushed when we are back online.
 * The server doc is the source of truth: a local copy only matters while it has not reached the server.
 */
export const DRAFT_SAVE_MS = 500;
const RETRY_MS = 5000;
const KEEPALIVE_MAX = 60_000; // browsers cap keepalive request bodies at 64KB

export interface DraftPayload { values: Record<string, unknown>; title: string; route: string; /** Edits only: the record's rev the edits were made against. */ rev?: number }
/** `sent`: a keepalive request went out and we couldn't see whether it landed. `cleared`: tombstone, the server doc is to be deleted. */
type Local = ({ cleared: true } | ({ cleared?: false } & DraftPayload)) & { at: number; sent?: boolean };

const lsKey = (uid: string, path: string) => `unsubmitted:${uid}:${path}`;
function readLocal(uid: string, path: string): Local | null {
  try { return JSON.parse(localStorage.getItem(lsKey(uid, path)) ?? "null") as Local | null; } catch { return null; }
}
const writeLocal = (uid: string, path: string, l: Local) => { try { localStorage.setItem(lsKey(uid, path), JSON.stringify(l)); } catch { /* no device copy: the server copy still works */ } };
const removeLocal = (uid: string, path: string, at?: number) => {
  try { if (at === undefined || readLocal(uid, path)?.at === at) localStorage.removeItem(lsKey(uid, path)); } catch { /* ignore */ }
};

// pagehide can't wait for getIdToken(), so keep the latest token around.
let token: string | null = null, watching = false;
function watchToken() {
  if (watching) return;
  watching = true;
  onIdTokenChanged(clientAuth(), (u) => { if (!u) token = null; else void u.getIdToken().then((t) => { token = t; }); });
}

export class DraftChannel {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private touched = false;
  private seq = 0;
  constructor(readonly uid: string, readonly path: string, private onStatus: (s: SaveState) => void = () => undefined) { watchToken(); }

  /** Latest write wins: replace whatever is stored for this path. */
  set(p: DraftPayload) {
    this.touched = true;
    writeLocal(this.uid, this.path, { ...p, at: Date.now() * 1000 + (this.seq++ % 1000) });
    this.onStatus("saving");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, DRAFT_SAVE_MS);
  }

  /** A draft already exists on the server (restored): `clear()` must delete it even if nothing is typed from here. */
  adopt() { this.touched = true; }

  /** Delete the draft (saved, or "Start over"). Resolves when the server has dropped it (or we're offline: it is retried). */
  async clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.touched && !readLocal(this.uid, this.path)) return; // nothing was ever written from here
    writeLocal(this.uid, this.path, { cleared: true, at: Date.now() * 1000 + (this.seq++ % 1000) });
    this.touched = false;
    await this.flush();
  }

  /** Push the latest local write now. Calls queue behind each other, so an older write can never land after a newer one. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.chain = this.chain.then(() => this.pushOnce());
    return this.chain;
  }

  private async pushOnce() {
    const l = readLocal(this.uid, this.path);
    if (!l || l.sent) return;
    try {
      if (l.cleared) await runCommand("drafts.clear", { path: this.path });
      else await runCommand("drafts.save", { path: this.path, values: l.values, title: l.title, route: l.route, rev: l.rev });
      removeLocal(this.uid, this.path, l.at);
      this.onStatus(readLocal(this.uid, this.path) ? "saving" : l.cleared ? "idle" : "saved");
    } catch (e) {
      const offline = (e as CommandError).code === "offline";
      this.onStatus(offline ? "offline" : "error");
      if (offline) this.retry = setTimeout(() => { this.retry = null; void this.flush(); }, RETRY_MS);
    }
  }

  /** Tab is closing: fire the pending write with keepalive (no waiting, no result). Falls back to the local copy when it can't. */
  flushOnExit() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const l = readLocal(this.uid, this.path);
    if (!l || l.sent || !token) return;
    const body = JSON.stringify(l.cleared ? { path: this.path } : { path: this.path, values: l.values, title: l.title, route: l.route, rev: l.rev });
    if (body.length > KEEPALIVE_MAX) return;
    writeLocal(this.uid, this.path, { ...l, sent: true });
    try {
      void fetch(`/api/commands/${l.cleared ? "drafts.clear" : "drafts.save"}`, {
        method: "POST", keepalive: true, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body,
      }).catch(() => undefined);
    } catch { writeLocal(this.uid, this.path, l); }
  }

  /** The tab stays open (hidden, not closed): a "sent" copy goes back to pending so the normal push confirms it. */
  resume() {
    const l = readLocal(this.uid, this.path);
    if (l?.sent) { writeLocal(this.uid, this.path, { ...l, sent: false }); void this.flush(); }
    else if (l) void this.flush();
  }
}

export interface OpenedDraft { values: Record<string, unknown>; rev?: number; title: string; route: string; /** When it was last written (ms). */ at: number }

/**
 * What to show when a form opens: the draft at `path`, or null. A local copy that never reached the server wins (and is pushed);
 * a copy sent by a closing tab wins only if it is newer than the server doc (its keepalive may never have landed: last-in-wins);
 * otherwise the server doc. Newer is by this device's clock vs. the server's updatedAt, so a skewed clock can tip a near-tie.
 */
export async function openDraft(uid: string, path: string): Promise<OpenedDraft | null> {
  const local = readLocal(uid, path);
  let server: OpenedDraft | null = null, known = true;
  try {
    const d = (await getDoc(doc(clientDb(), "unsubmittedDrafts", draftDocId(uid, path)))).data();
    if (d && (d.expiresAt as { toMillis(): number }).toMillis() > Date.now()) server = { values: d.values, rev: d.rev, title: d.title, route: d.route, at: (d.updatedAt as { toMillis(): number }).toMillis() };
  } catch (e) {
    // Rules can't evaluate a missing doc's owner: "permission-denied" here means "no draft".
    if ((e as { code?: string }).code !== "permission-denied") known = false;
  }
  if (local && !local.sent) return local.cleared ? null : { ...local, at: Math.floor(local.at / 1000) };
  if (local?.sent && server && !local.cleared && Math.floor(local.at / 1000) > server.at) return { ...local, at: Math.floor(local.at / 1000) };
  if (local?.sent) removeLocal(uid, path, local.at);
  if (server) return server;
  if (local && !local.cleared && known) return { ...local, at: Math.floor(local.at / 1000) }; // a keepalive that never landed
  return null;
}

/** Push locally kept writes that never reached the server (offline earlier). Copies a closing tab already sent are left alone. */
export function pushPending(uid: string) {
  try {
    const prefix = `unsubmitted:${uid}:`;
    const paths: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) paths.push(k.slice(prefix.length)); }
    for (const path of paths) { const l = readLocal(uid, path); if (l && !l.sent) void new DraftChannel(uid, path).flush(); }
  } catch { /* ignore */ }
}
