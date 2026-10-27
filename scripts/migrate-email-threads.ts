/**
 * Gmail threads used to live only in pitch timelines (activity entries with `gmail.threadId`). They now belong to the place,
 * with a summary doc each in `emailThreads`:
 *   tsx scripts/migrate-email-threads.ts [--dry-run] [--yes]
 * For every thread named by a pitch's activity, one `emailThreads/{artistId}__{threadId}` doc is created: target = the pitch's
 * place (an edition's threads go on its festival), account = the mailbox on the entry (else the assignee's email), summary from
 * Gmail when the mailbox's token works, else from the timeline entries (subject, date, who it went to). A thread that already has a
 * doc (even an unlinked one) is left alone, so it is safe to run again. Written through the normal writer (via "import").
 * Against real Firestore (no emulator host) it needs --yes.
 */
import type { Firestore } from "firebase-admin/firestore";
import { firestore } from "@/server/admin";
import { importCtx } from "@/server/ctx";
import { db } from "@/server/db";
import { gmailClient } from "@/server/integrations";
import type { MailThread } from "@/server/integrations/gmail";
import { summarize } from "@/server/commands/email";
import { emailThreadId, email as emailSchema } from "@/schema";

export interface MigrateEmailThreadsResult {
  created: { id: string; subject: string; place: string; source: "gmail" | "timeline" }[];
  skipped: { threadId: string; why: string }[];
}
type ReadThread = (threadId: string, account: string) => Promise<MailThread | null>;

const readFromGmail: ReadThread = async (threadId, account) => gmailClient().getThread(threadId, account).catch(() => null);
const iso = (t: unknown) => (t && typeof (t as { toDate?: unknown }).toDate === "function" ? (t as { toDate(): Date }).toDate().toISOString() : new Date(0).toISOString());

export async function migrateEmailThreads(fs: Firestore, opts: { dryRun?: boolean; readThread?: ReadThread } = {}): Promise<MigrateEmailThreadsResult> {
  const readThread = opts.readThread ?? readFromGmail;
  const out: MigrateEmailThreadsResult = { created: [], skipped: [] };
  const acts = (await fs.collectionGroup("activity").get()).docs.filter((d) => d.ref.path.startsWith("pitches/") && !d.data().deletedAt && d.data().gmail?.threadId);
  // threadId -> the entries that mention it, oldest first
  const byThread = new Map<string, { pitchId: string; data: Record<string, any> }[]>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const d of acts) {
    const t = d.data().gmail.threadId as string;
    (byThread.get(t) ?? byThread.set(t, []).get(t)!).push({ pitchId: d.ref.parent.parent!.id, data: d.data() });
  }
  for (const [threadId, entries] of byThread) {
    entries.sort((a, b) => iso(a.data.createdAt).localeCompare(iso(b.data.createdAt)));
    const first = entries.find((e) => e.data.type === "emailSent") ?? entries[0];
    const pitch = await db.get("pitches", first.pitchId);
    if (!pitch || pitch.deletedAt) { out.skipped.push({ threadId, why: "its pitch is gone" }); continue; }
    const id = emailThreadId(pitch.artistId as string, threadId);
    if ((await fs.collection("emailThreads").doc(id).get()).exists) continue;

    let place: { kind: "venue" | "promoter" | "festival"; id: string; name: string };
    if (pitch.target.kind === "edition") {
      const ed = await db.get("editions", pitch.target.id);
      if (!ed) { out.skipped.push({ threadId, why: "its festival year is gone" }); continue; }
      place = { kind: "festival", id: ed.festivalId, name: ed.festivalName };
    } else place = { kind: pitch.target.kind, id: pitch.target.id, name: pitch.target.name };

    let account = entries.map((e) => e.data.gmail.account as string | undefined).find(Boolean);
    if (!account && pitch.assigneeId) account = (await db.get("users", pitch.assigneeId))?.email as string | undefined;
    if (!account || !emailSchema.safeParse(account).success) { out.skipped.push({ threadId, why: "no mailbox to read it from" }); continue; }

    const gmail = await readThread(threadId, account);
    let fields: ReturnType<typeof summarize>;
    if (gmail) fields = summarize(gmail, account);
    else {
      const last = entries[entries.length - 1];
      const to = entries.flatMap((e) => String(e.data.gmail.to ?? "").split(/[,\s]+/)).map((a) => a.toLowerCase()).filter((a) => emailSchema.safeParse(a).success && a !== account);
      fields = {
        subject: first.data.gmail.subject ?? "", snippet: String(last.data.text ?? "").replace(/\s+/g, " ").trim().slice(0, 160), lastDate: iso(last.data.createdAt),
        lastFrom: account, lastDirection: last.data.type === "emailReply" ? "received" : "sent", messageCount: entries.length, participants: [...new Set(to)],
      };
    }
    out.created.push({ id, subject: fields.subject, place: place.name, source: gmail ? "gmail" : "timeline" });
    if (opts.dryRun) continue;
    await db.create(importCtx("migrate-email-threads", undefined, pitch.artistId as string), "emailThreads", {
      artistId: pitch.artistId, account, threadId, target: place, pitchId: first.pitchId, ...fields,
    }, { id });
  }
  return out;
}

async function main() {
  const flag = (n: string) => process.argv.includes(`--${n}`);
  if (!process.env.FIRESTORE_EMULATOR_HOST && !flag("yes") && !flag("dry-run")) {
    throw new Error("This would write to REAL Firestore. Re-run with --dry-run to look first, or --yes if that is what you want.");
  }
  const r = await migrateEmailThreads(firestore(), { dryRun: flag("dry-run") });
  for (const c of r.created) console.log(`${flag("dry-run") ? "Would add" : "Added"} thread "${c.subject}" to ${c.place} (summary from ${c.source})`);
  for (const s of r.skipped) console.log(`Skipped thread ${s.threadId}: ${s.why}`);
  console.log(`${r.created.length} thread(s) added, ${r.skipped.length} skipped${flag("dry-run") ? " (dry run, nothing written)" : ""}.`);
}

if (process.argv[1]?.endsWith("migrate-email-threads.ts")) main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
