/**
 * Move the posts #49 made into the Socials layout (docs/designs/posts-carousels/design.md, "Migrating the #49 posts").
 *   npm run migrate:posts-49                 (dry run: reports what it would do, changes nothing)
 *   npm run migrate:posts-49 -- --apply      (does it)
 * Against the emulator, set FIRESTORE_EMULATOR_HOST (and DRIVE_BASE_URL for the fake Drive); against prod, GCLOUD_PROJECT and
 * GOOGLE_APPLICATION_CREDENTIALS as for the other scripts. Run it after Set up (posts.setup) has made Socials/Posts.
 *
 * Per artist, as the band's Google account: every post with no driveFolderId gets a title (the caption's first 40
 * characters cut at a word, else "Photo <created date>") and its own folder in Posts/:
 *   - posted: "YYYY-MM-DD - <title>", dated the day it was created (band timezone);
 *   - failed: "DRAFT - <title>", so it becomes an editable draft;
 *   - publishing (cut off before it posted): the same as failed, set to failed with "Interrupted before it posted".
 * Its photo moves in, remembering the month folder it came from (from.folderId), and name, size and modifiedTime are filled
 * in from Drive. A post whose photo is gone is reported and skipped. Posts that already have a driveFolderId are skipped,
 * so running it again changes nothing.
 */
import { db } from "@/server/db";
import { importCtx, newRunId, type Ctx } from "@/server/ctx";
import { driveClient, IntegrationError, type DriveFile, type DriveService } from "@/server/integrations";
import { isEmpty, moveInto, uniqueName } from "@/server/postFolder";
import { dateInBandZone } from "@/lib/timezone";
import type { PostMedia } from "@/schema/posts";

export const INTERRUPTED = "Interrupted before it posted";

export interface Migrated { postId: string; title: string; folder: string; status: string; photos: string[] }
export interface Skipped { postId?: string; artistId: string; reason: string }
export interface MigrateResult { apply: boolean; migrated: Migrated[]; skipped: Skipped[] }

/** The caption's first 40 characters, cut at a word; else "Photo <created date>". */
export function titleFor(caption: string | undefined, createdDate: string): string {
  const c = (caption ?? "").replace(/\s+/g, " ").trim();
  if (!c) return `Photo ${createdDate}`;
  if (c.length <= 40) return c;
  const sp = c.slice(0, 41).lastIndexOf(" ");
  return (sp > 0 ? c.slice(0, sp) : c.slice(0, 40)).trim();
}

const dateOf = (t: unknown): Date =>
  t && typeof (t as { toDate?: unknown }).toDate === "function" ? (t as { toDate(): Date }).toDate() : new Date(t as string);

/** The photo as Drive has it now, or null when it's gone or trashed. */
async function photoOf(drive: DriveService, id: string): Promise<DriveFile | null> {
  try {
    const f = await drive.get(id);
    return f.trashed ? null : f;
  } catch (e) {
    if (e instanceof IntegrationError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

/** Width and height upright: swapped when Drive says the photo is turned a quarter. */
const upright = (f: DriveFile) => {
  if (!f.image) return {};
  const odd = (f.image.rotation ?? 0) % 2 === 1;
  return { width: odd ? f.image.height : f.image.width, height: odd ? f.image.width : f.image.height };
};

export async function migratePosts49(opts: { apply: boolean; log?: (s: string) => void }): Promise<MigrateResult> {
  const log = opts.log ?? (() => undefined);
  const out: MigrateResult = { apply: opts.apply, migrated: [], skipped: [] };
  const runId = newRunId();
  for (const artist of await db.list("artists")) {
    const artistId = artist.id;
    const todo = (await db.list("posts", (q) => q.where("artistId", "==", artistId))).filter((p) => !p.driveFolderId);
    if (!todo.length) continue;
    const postsId = artist.postFoldersId as string | undefined;
    if (!artist.postsFolderId || !postsId) {
      out.skipped.push({ artistId, reason: `${todo.length} post(s) left: run Set up in Settings › Google first` });
      continue;
    }
    const ctx: Ctx = importCtx("migrate-posts-49", runId, artistId);
    const drive = driveClient({ artistId });
    for (const p of todo) {
      const created = dateInBandZone(dateOf(p.createdAt));
      const title = titleFor(p.caption as string | undefined, created);
      const status = p.status as string;
      const posted = status === "posted";
      const media = p.media as PostMedia[];
      const files: DriveFile[] = [];
      for (const m of media) {
        const f = await photoOf(drive, m.driveFileId);
        if (f) files.push(f);
      }
      if (files.length < media.length) {
        out.skipped.push({ postId: p.id, artistId, reason: `its photo is no longer in Drive (${media.map((m) => m.driveFileId).join(", ")})` });
        log(`skip ${p.id}: photo gone`);
        continue;
      }
      const folderName = await uniqueName(drive, postsId, `${posted ? created : "DRAFT"} - ${title}`);
      const row: Migrated = { postId: p.id, title, folder: folderName, status: posted ? "posted" : "failed", photos: files.map((f) => f.name) };
      if (!opts.apply) { out.migrated.push(row); log(`would move ${row.photos.join(", ")} into Posts/${folderName}`); continue; }

      const folder = await drive.createFolder(folderName, postsId);
      const moved: { id: string; from: string }[] = [];
      try {
        const next: PostMedia[] = [];
        for (const [i, f] of files.entries()) {
          const from = f.parents[0];
          const after = await moveInto(drive, f.id, folder.id, from);
          moved.push({ id: f.id, from });
          next.push({
            ...media[i], name: f.name, ...upright(f), modifiedTime: after.modifiedTime ?? f.modifiedTime, from: { folderId: from },
          } as PostMedia);
        }
        await db.update(ctx, "posts", p.id, {
          title, driveFolderId: folder.id, media: next,
          ...(status === "publishing" ? { status: "failed", error: INTERRUPTED } : {}),
        });
      } catch (e) {
        // Put back what this post moved, so a re-run starts clean.
        for (const m of moved.reverse()) await moveInto(drive, m.id, m.from, folder.id).catch(() => undefined);
        if (await isEmpty(drive, folder.id).catch(() => false)) await drive.trash(folder.id).catch(() => undefined);
        out.skipped.push({ postId: p.id, artistId, reason: e instanceof Error ? e.message : String(e) });
        log(`skip ${p.id}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      out.migrated.push(row);
      log(`moved ${row.photos.join(", ")} into Posts/${folderName}`);
    }
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT;
  if (!project && !emulator) throw new Error("No target: set GCLOUD_PROJECT (real Firestore) or FIRESTORE_EMULATOR_HOST (emulator). Refusing to guess.");
  console.log(`Target: ${project ?? "demo-band-tracker"} (${emulator ? `emulator at ${emulator}` : "REAL Firestore"})${apply ? "" : ", dry run"}`);
  const r = await migratePosts49({ apply, log: (s) => console.log(`  ${s}`) });
  console.log(`${apply ? "Moved" : "Would move"} ${r.migrated.length} post(s); skipped ${r.skipped.length}.`);
  for (const s of r.skipped) console.log(`  skipped ${s.postId ?? `artist ${s.artistId}`}: ${s.reason}`);
  if (!apply) console.log("(dry run, nothing changed; re-run with --apply)");
}

if (process.argv[1]?.endsWith("migrate-posts-49.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
