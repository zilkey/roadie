/**
 * Email on places. A Gmail thread belongs to the place (venue, promoter, festival or act), not to one pitch, so it stays when the
 * pitch closes. Firestore keeps a summary per thread (`emailThreads`); message bodies are never stored, they come from Gmail
 * on demand. The pitch commands (pitches.sendEmail, draftEmail, checkReplies) are wrappers over the functions here.
 */
import { z } from "zod";
import { defineCommand } from "./types";
import { idInput } from "./util";
import { db, run, type Writer, type Doc } from "../db";
import type { Ctx } from "../ctx";
import { AppError } from "../errors";
import { gmailClient, IntegrationError } from "../integrations";
import type { MailMessage, MailThread } from "../integrations/gmail";
import { unfilledFields } from "@/lib/booking";
import { snippetOf } from "@/lib/email-text";
import { sanitizeHtml, htmlToText } from "@/lib/email-html";
import { signatureOf, nameFromAddress } from "@/lib/email-signature";
import { e164 } from "@/schema/normalize";
import { BAND_NOTES, bandNoteId, emailThreadId, threadPitchIds, venueNoteId, email as emailSchema } from "@/schema";
import { withBandNote } from "@/lib/bandNotes";
import { callerArtistId, privateOf } from "../venues";
import { bookingMailOf } from "../google/band";
import { createNoted } from "../bandNotes";
import { attachContact } from "../contactLinks";
import { roleIn } from "@/schema";

export const gmailFail = (e: unknown): never => {
  if (e instanceof IntegrationError) throw new AppError("gmail_error", `Gmail: ${e.message}`, 502);
  throw e;
};

export type Place = { kind: "venue" | "promoter" | "festival" | "act"; id: string; name: string };
const targetIn = z.strictObject({ kind: z.enum(["venue", "promoter", "festival", "edition", "act"]), id: z.string().min(1) });
type TargetIn = z.infer<typeof targetIn>;
const COLL = { venue: "venues", promoter: "promoters", festival: "festivals", edition: "editions", act: "acts" } as const;

/** The place a thread belongs to: an edition's threads go on its festival. */
export async function resolvePlace(t: TargetIn): Promise<Place> {
  const d = await db.get(COLL[t.kind], t.id);
  if (!d || d.deletedAt) throw new AppError("not_found", `${t.kind} not found`, 404);
  if (t.kind === "edition") return { kind: "festival", id: d.festivalId as string, name: d.festivalName as string };
  return { kind: t.kind, id: t.id, name: d.name as string };
}

export async function requirePitchDoc(id: string): Promise<Doc> {
  const p = await db.get("pitches", id);
  if (!p || p.deletedAt) throw new AppError("not_found", "Pitch not found", 404);
  return p;
}
/** The place a pitch is about. */
export const placeOfPitch = (p: Doc) => resolvePlace({ kind: p.target.kind, id: p.target.id });

async function artistIdFor(ctx: Ctx): Promise<string> {
  if (ctx.artistId) return ctx.artistId;
  const all = await db.list("artists", (q) => q.limit(2));
  if (all.length !== 1) throw new AppError("not_found", "Set up the artist first", 404);
  return all[0].id;
}
/**
 * The mailbox the caller's email goes through: the booking mailbox when the band has one (every admin sends, drafts and
 * searches through it), else the caller's own Gmail. Gmail finds the grant by this address (accessTokenForEmail).
 * Threads already linked keep the `account` they were read from.
 */
export async function accountOf(ctx: Ctx): Promise<string> {
  const artistId = await artistIdFor(ctx).catch(() => null); // no artist to read the setting from: the caller's own, as before
  const mail = artistId ? await bookingMailOf(artistId) : null;
  return mail ? mail.email : ownAccount(ctx);
}
async function ownAccount(ctx: Ctx): Promise<string> {
  const u = await db.get("users", ctx.uid);
  if (!u) throw new AppError("forbidden", "No user for this account", 403);
  return u.email as string;
}

const validEmail = (s: string) => emailSchema.safeParse(s).success;

/** The summary fields of an `emailThreads` doc, from the thread as Gmail has it. */
export function summarize(thread: MailThread, account: string) {
  const msgs = thread.messages;
  const last = msgs[msgs.length - 1];
  const me = account.toLowerCase();
  const participants = [...new Set(msgs.flatMap((m) => [m.from, ...m.to, ...m.cc]).map((a) => a.toLowerCase()).filter((a) => a !== me && validEmail(a)))];
  const from = last?.from.toLowerCase() ?? "";
  return {
    subject: thread.subject || msgs[0]?.subject || "",
    snippet: last ? snippetOf(last.body) : "",
    ...(msgs[0]?.date ? { firstDate: msgs[0].date } : {}),
    lastDate: last?.date ?? thread.lastDate,
    lastFrom: validEmail(from) ? from : me,
    lastDirection: last?.direction ?? "sent",
    messageCount: msgs.length,
    participants,
  };
}

/**
 * Create the thread's doc, or refresh it (and bring back an unlinked one when `place` is given). `pitchIds` are added to the
 * pitches the thread covers (#82 S8): never replaced, so linking a second pitch no longer moves the thread off the first.
 * `pitchId` stays the first pitch (what older readers use); `pitchIds` is written once a thread covers more than one.
 */
async function upsertThread(w: Writer, a: { artistId: string; account: string; thread: MailThread; place?: Place; pitchIds?: string[]; sentBy?: { messageId: string; uid: string } }) {
  const id = emailThreadId(a.artistId, a.thread.id);
  const existing = await w.get("emailThreads", id);
  const sum = { ...summarize(a.thread, a.account), ...(a.sentBy ? { sentBy: { ...(existing?.sentBy ?? {}), [a.sentBy.messageId]: a.sentBy.uid } } : {}) };
  const had = existing ? threadPitchIds(existing as { pitchId?: string; pitchIds?: string[] }) : [];
  const all = [...new Set([...had, ...(a.pitchIds ?? [])])];
  const pitches = all.length ? { pitchId: (existing?.pitchId as string | undefined) ?? all[0], ...(all.length > 1 ? { pitchIds: all } : {}) } : {};
  if (!existing) {
    if (!a.place) throw new AppError("invalid_input", "Which place does this thread belong to?", 400);
    await w.create("emailThreads", { artistId: a.artistId, account: a.account, threadId: a.thread.id, target: a.place, ...pitches, ...sum, syncedAt: w.now }, { id });
  } else {
    if (existing.deletedAt) await w.restore("emailThreads", id);
    const grew = all.length > had.length;
    await w.update("emailThreads", id, { ...sum, syncedAt: w.now, ...(a.place ? { target: a.place } : {}), ...(grew ? pitches : {}) });
  }
  const place = a.place ?? (existing?.target as Place | undefined);
  if (place) await addThreadPeople(w, { artistId: a.artistId, account: a.account, place, messages: a.thread.messages });
  return id;
}

// ---------- the people a place's mail is with ----------

/** Robots, not people: no-reply senders, bounces, mailer daemons, notification and list addresses. */
const NOT_A_PERSON = /(^|[._+-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|unsubscribe|calendar-notification)([._+-]|@)|@(.+\.)?(noreply|bounce|bounces|email|mailchimp|mcsv|sendgrid|mailgun)\./i;
export const isPerson = (addr: string) => !NOT_A_PERSON.test(addr);

export interface ThreadPerson { email: string; name: string; title?: string; phone?: string }
/**
 * The other people on a place's mail: whoever wrote to the mailbox (with the name from the From header, and a title and phone
 * guessed from the signature) and whoever the mailbox wrote to. Cc'd addresses, robots and the band's own addresses are left out.
 */
export function threadPeople(messages: MailMessage[], ours: ReadonlySet<string>): ThreadPerson[] {
  const by = new Map<string, ThreadPerson>();
  for (const m of [...messages].sort((a, b) => b.date.localeCompare(a.date))) {
    const others = m.direction === "received" ? [m.from] : m.to;
    for (const raw of others) {
      const email = raw.toLowerCase();
      if (ours.has(email) || !validEmail(email) || !isPerson(email)) continue;
      const p = by.get(email) ?? by.set(email, { email, name: "" }).get(email)!;
      if (m.direction !== "received" || p.name) continue;
      p.name = m.fromName.trim();
      const sig = signatureOf(m.body, p.name);
      const phone = sig.phone ? e164(sig.phone) : "";
      if (sig.title) p.title = sig.title;
      if (/^\+[1-9]\d{6,14}$/.test(phone)) p.phone = phone;
    }
  }
  return [...by.values()];
}

/** The band's own addresses: the mailbox, its team's logins and its musicians. Mail between them is not a contact. */
async function ourAddresses(w: Writer, artistId: string, account: string): Promise<Set<string>> {
  const users = (await w.query("users")).filter((u) => !u.deletedAt && roleIn(u, artistId));
  const musicians = await w.query("musicians");
  return new Set([account, ...users.map((u) => u.email as string), ...musicians.map((m) => m.email as string | undefined)].filter((e): e is string => !!e).map((e) => e.toLowerCase()));
}

/**
 * Make each person on the thread one of the band's contacts and link them to the place, so the next pitch there has someone to
 * write to. An address already in the band's contacts is linked, not copied (and gets the name from Gmail when it only had the
 * address, when the contact was only named from the address); one the band archived stays archived and unlinked. Returns how many were linked that weren't before.
 */
async function addThreadPeople(w: Writer, a: { artistId: string; account: string; place: Place; messages: MailMessage[] }): Promise<number> {
  const people = threadPeople(a.messages, await ourAddresses(w, a.artistId, a.account));
  if (!people.length) return 0;
  const coll = COLL[a.place.kind];
  const before = new Set(((await placeContactIds(w, a.place, a.artistId)) ?? []));
  let added = 0;
  for (const p of people) {
    const mine = (await w.query("contacts", (q) => q.where("emails", "array-contains", p.email))).filter((c) => c.artistId === a.artistId);
    const live = mine.find((c) => !c.deletedAt);
    if (!live && mine.length) continue; // archived on purpose
    let id: string;
    if (live) {
      id = live.id;
      const guessed = [p.email, nameFromAddress(p.email)].includes(live.name as string); // named from the address before anyone answered
      if (p.name && guessed && live.name !== p.name) await w.update("contacts", id, { name: p.name });
    } else {
      id = (await createNoted(w, "contacts", { artistId: a.artistId, name: p.name || nameFromAddress(p.email), emails: [p.email], phones: p.phone ? [p.phone] : [], ...(p.title ? { title: p.title } : {}) })).id;
    }
    if (before.has(id)) continue;
    await attachContact(w, coll, a.place.id, id);
    before.add(id);
    added++;
  }
  return added;
}

/** The ids the band has linked to the place (venue notes, or the band's notes on a promoter, festival or act). */
async function placeContactIds(w: Writer, place: Place, artistId: string): Promise<string[]> {
  const rec = await w.get(COLL[place.kind], place.id);
  if (!rec) return [];
  if (place.kind === "venue") return privateOf((await w.get("venueNotes", venueNoteId(artistId, place.id))) ?? rec).contactIds as string[] ?? [];
  const kind = ({ promoter: "promoters", festival: "festivals", act: "acts" } as const)[place.kind];
  return withBandNote(kind, rec, await w.get(BAND_NOTES[kind].coll, bandNoteId(artistId, rec.id))).contactIds ?? [];
}

/** Every pitch named, live and this band's, checked before anything is sent (S8: N pitches, one email). */
async function requirePitches(ids: string[], artistId: string | undefined): Promise<void> {
  for (const id of ids) {
    const p = await requirePitchDoc(id);
    if (artistId && p.artistId && p.artistId !== artistId) throw new AppError("not_found", "Pitch not found", 404);
  }
}
const allPitches = (i: { pitchId?: string; pitchIds?: string[] }) => [...new Set([...(i.pitchId ? [i.pitchId] : []), ...(i.pitchIds ?? [])])];

/** Add an emailReply to the pitch's timeline for each received message that isn't there yet. Returns how many. */
async function addReplies(w: Writer, pitchId: string, messages: MailMessage[]): Promise<number> {
  const pitch = await w.get("pitches", pitchId);
  if (!pitch || pitch.deletedAt) throw new AppError("not_found", "Pitch not found", 404);
  const acts = await w.query(`pitches/${pitchId}/activity`, (q) => q);
  const seen = new Set(acts.filter((a) => a.gmail?.messageId).map((a) => a.gmail.messageId as string));
  const fresh = messages.filter((m) => m.direction === "received" && !seen.has(m.id)).sort((a, b) => a.date.localeCompare(b.date));
  for (const m of fresh) {
    await w.create(`pitches/${pitchId}/activity`, {
      type: "emailReply", text: `From ${m.from}\n\n${m.body}`, gmail: { messageId: m.id, threadId: m.threadId, to: m.to.join(", "), subject: m.subject, account: m.account },
    });
  }
  if (fresh.length) await w.update("pitches", pitchId, { lastContactAt: new Date(fresh[fresh.length - 1].date) });
  return fresh.length;
}

// ---------- the work, shared with the pitch wrappers ----------

export async function linkThread(ctx: Ctx, i: { threadId: string; place: Place; pitchId?: string; pitchIds?: string[]; account?: string }) {
  const [artistId, account] = [await artistIdFor(ctx), i.account ?? (await accountOf(ctx))];
  const ids = allPitches(i);
  await requirePitches(ids, ctx.artistId);
  const thread = await gmailClient().getThread(i.threadId, account).catch(gmailFail);
  return run(ctx, async (w) => {
    const id = await upsertThread(w, { artistId, account, thread, place: i.place, pitchIds: ids });
    let added = 0;
    for (const p of ids) added += await addReplies(w, p, thread.messages);
    return { id, added };
  });
}

/** Re-read every live thread of the place, refresh the summaries and put new replies on the timelines of the pitches they belong to. */
export async function syncPlace(ctx: Ctx, place: Place): Promise<{ added: number; threads: number }> {
  const artistId = await artistIdFor(ctx);
  const docs = (await db.list("emailThreads", (q) => q.where("artistId", "==", artistId).where("target.id", "==", place.id))).filter((d) => d.target.kind === place.kind);
  const read = await Promise.all(docs.map(async (d) => {
    const thread = await gmailClient().getThread(d.threadId, d.account).catch((e) => (e instanceof IntegrationError && e.status === 404 ? null : gmailFail(e)));
    return { d, thread };
  }));
  const live = read.filter((r): r is { d: Doc; thread: MailThread } => !!r.thread);
  if (!live.length) return { added: 0, threads: docs.length };
  const added = await run(ctx, async (w) => {
    let n = 0;
    for (const { d, thread } of live) {
      await upsertThread(w, { artistId, account: d.account, thread });
      for (const p of threadPitchIds(d as { pitchId?: string; pitchIds?: string[] })) n += await addReplies(w, p, thread.messages).catch((e) => (e instanceof AppError && e.status === 404 ? 0 : Promise.reject(e)));
    }
    return n;
  });
  return { added, threads: docs.length };
}

const mailIn = {
  pitchId: z.string().min(1).optional(), pitchIds: z.array(z.string().min(1)).optional(), threadId: z.string().min(1).optional(), html: z.string().optional(),
  to: z.array(emailSchema).min(1), cc: z.array(emailSchema).optional(), subject: z.string().min(1), body: z.string().min(1),
};

export async function sendMail(ctx: Ctx, i: { place: Place; pitchId?: string; pitchIds?: string[]; threadId?: string; to: string[]; cc?: string[]; subject: string; body: string; html?: string; markPitched?: boolean }) {
  const missing = unfilledFields(`${i.subject}\n${i.body}`);
  if (missing.length) throw new AppError("unfilled_fields", `Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before sending`, 400);
  const [artistId, account] = [await artistIdFor(ctx), await accountOf(ctx)];
  // Every pitch is checked before Gmail is called: a bad id must not leave a sent email half logged (S8-a).
  const ids = allPitches(i);
  await requirePitches(ids, ctx.artistId);
  const gmail = gmailClient();
  const msg = await gmail.send({ account, to: i.to, cc: i.cc, subject: i.subject, body: i.body, html: i.html && sanitizeHtml(i.html), threadId: i.threadId }).catch(gmailFail);
  const thread = await gmail.getThread(msg.threadId, account).catch((): MailThread => ({ id: msg.threadId, subject: msg.subject, messages: [msg], lastDate: msg.date }));
  return run(ctx, async (w) => {
    const id = await upsertThread(w, { artistId, account, thread, place: i.place, pitchIds: ids, sentBy: { messageId: msg.id, uid: ctx.uid } });
    let activityId: string | undefined;
    // The same emailSent on every pitch the email covers; logging is keyed on the message id, so a re-run never doubles it.
    for (const pitchId of ids) {
      const p = (await w.get("pitches", pitchId))!;
      const logged = (await w.query(`pitches/${pitchId}/activity`, (q) => q)).find((a) => a.gmail?.messageId === msg.id);
      const act = logged ?? await w.create(`pitches/${pitchId}/activity`, {
        type: "emailSent", text: i.body, gmail: { messageId: msg.id, threadId: msg.threadId, to: i.to.join(", "), subject: i.subject, account },
      });
      if (pitchId === ids[0]) activityId = act.id as string;
      await w.update("pitches", pitchId, { lastContactAt: w.now });
      if (i.markPitched && (p.status === "idea" || p.status === "toPitch")) {
        await w.update("pitches", pitchId, { status: "pitched" });
        await w.create(`pitches/${pitchId}/activity`, { type: "status", fromStatus: p.status, toStatus: "pitched" });
      }
    }
    return { id, activityId, messageId: msg.id, threadId: msg.threadId };
  });
}

export async function draftMail(ctx: Ctx, i: { pitchId?: string; pitchIds?: string[]; threadId?: string; to: string[]; cc?: string[]; subject: string; body: string; html?: string }) {
  const missing = unfilledFields(`${i.subject}\n${i.body}`);
  if (missing.length) throw new AppError("unfilled_fields", `Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before drafting`, 400);
  const ids = allPitches(i);
  await requirePitches(ids, ctx.artistId);
  const account = await accountOf(ctx);
  const draft = await gmailClient().createDraft({ account, to: i.to, cc: i.cc, subject: i.subject, body: i.body, html: i.html && sanitizeHtml(i.html), threadId: i.threadId }).catch(gmailFail);
  let id: string | undefined;
  for (const pitchId of ids) {
    const act = await db.create(ctx, `pitches/${pitchId}/activity`, { type: "note", text: `Email drafted (not sent) to ${i.to.join(", ")}: ${i.subject}\n\n${i.body}` });
    id ??= act.id as string;
  }
  return { id, draftId: draft.id, sent: false as const };
}

/** The pitch-level "check for replies": link the threads this pitch's timeline already mentions (older pitches), then sync the place. */
export async function checkPitchReplies(ctx: Ctx, pitchId: string): Promise<{ added: number }> {
  const pitch = await requirePitchDoc(pitchId);
  const place = await placeOfPitch(pitch);
  const [artistId, acts, me] = [await artistIdFor(ctx), await db.list(`pitches/${pitchId}/activity`), await ownAccount(ctx)];
  const threads = new Map<string, string>();
  // Timeline entries from before `gmail.account` was stored were sent from the admin's own Gmail, never the booking mailbox.
  for (const a of acts) if (a.gmail?.threadId && !threads.has(a.gmail.threadId)) threads.set(a.gmail.threadId, (a.gmail.account as string | undefined) ?? me);
  let added = 0;
  for (const [threadId, account] of threads) {
    if (await db.get("emailThreads", emailThreadId(artistId, threadId))) continue; // linked, or deliberately unlinked
    added += (await linkThread(ctx, { threadId, place, pitchId, account })).added;
  }
  return { added: added + (await syncPlace(ctx, place)).added };
}

// ---------- commands ----------

/** Firestore timestamps as ISO strings, so a doc can go back over the wire. */
const plain = (d: Doc) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v && typeof (v as { toDate?: unknown }).toDate === "function" ? (v as { toDate(): Date }).toDate().toISOString() : v]));

/**
 * Who sent each message from Roadie, by Gmail message id: the thread's `sentBy`, then the pitch timeline's emailSent
 * entries (their `createdBy`, stamped by db.ts) for sends from before `sentBy`. Values are the admins' names.
 */
async function sentByNames(d: Doc): Promise<Record<string, string>> {
  const uids: Record<string, string> = {};
  if (d.pitchId) {
    for (const a of await db.list(`pitches/${d.pitchId}/activity`)) {
      if (a.type === "emailSent" && a.gmail?.messageId && a.gmail.threadId === d.threadId && a.createdBy) uids[a.gmail.messageId] = a.createdBy;
    }
  }
  Object.assign(uids, (d.sentBy ?? {}) as Record<string, string>);
  const names = new Map<string, string>();
  await Promise.all([...new Set(Object.values(uids))].map(async (uid) => {
    const u = await db.get("users", uid);
    names.set(uid, ((u?.name as string | undefined) || (u?.email as string | undefined)) ?? "an admin");
  }));
  return Object.fromEntries(Object.entries(uids).map(([m, uid]) => [m, names.get(uid)!]));
}

async function ownThread(ctx: Ctx, id: string): Promise<Doc> {
  const [d, artistId] = [await db.get("emailThreads", id), await artistIdFor(ctx)];
  if (!d || d.deletedAt || d.artistId !== artistId) throw new AppError("not_found", "Thread not found", 404);
  return d;
}

export const emailLink = defineCommand({
  name: "email.link", roles: ["admin"],
  description: "Put a Gmail thread on a venue, promoter or festival (an edition's threads go on its festival), and start watching it for replies. With pitchId (and pitchIds, every pitch one email covers), replies not yet on those pitches' timelines are added; the thread keeps the pitches it already had.",
  input: z.strictObject({ threadId: z.string().min(1), target: targetIn, pitchId: z.string().min(1).optional(), pitchIds: z.array(z.string().min(1)).optional() }),
  async run(ctx, i) {
    const r = await linkThread(ctx, { threadId: i.threadId, place: await resolvePlace(i.target), pitchId: i.pitchId, pitchIds: i.pitchIds });
    return { id: r.id };
  },
});

export const emailUnlink = defineCommand({
  name: "email.unlink", roles: ["admin"], input: idInput, description: "Take a thread off its place. The timeline entries stay.",
  async run(ctx, { id }) { await ownThread(ctx, id); return db.softDelete(ctx, "emailThreads", id); },
});

export const emailSync = defineCommand({
  name: "email.sync", roles: ["admin"],
  description: "Re-read every thread linked to a place, refresh the list and add new replies to the pitch each thread belongs to. Returns {added, threads}.",
  input: z.strictObject({ target: targetIn }),
  async run(ctx, i) { return syncPlace(ctx, await resolvePlace(i.target)); },
});

export const emailThread = defineCommand({
  name: "email.thread", roles: ["admin"],
  description: "A linked thread with its messages, read from Gmail now. Marks it seen.",
  input: idInput,
  async run(ctx, { id }) {
    const d = await ownThread(ctx, id);
    const t = await gmailClient().getThread(d.threadId, d.account).catch(gmailFail);
    await db.update(ctx, "emailThreads", id, { lastSeenAt: new Date() });
    return { thread: plain({ ...d, lastSeenAt: new Date() }), messages: t.messages, sentBy: await sentByNames(d) };
  },
});

const sendIn = z.strictObject({ target: targetIn, ...mailIn, markPitched: z.boolean().default(false) });
export const emailSend = defineCommand({
  name: "email.send", roles: ["admin"],
  description: "Send an already filled-in email from the booking mailbox, or the caller's own Gmail when the band has none (a reply when threadId is given). The thread lands on the place; with pitchId it is logged on that pitch's timeline and sets lastContactAt. pitchIds: more pitches the same email covers (one email to a promoter about several venues); each gets the same log.",
  input: sendIn,
  async run(ctx, i) {
    const { target, ...rest } = i;
    const r = await sendMail(ctx, { ...rest, place: await resolvePlace(target) });
    return { id: r.id, messageId: r.messageId, threadId: r.threadId };
  },
});

export const emailDraft = defineCommand({
  name: "email.draft", roles: ["admin"],
  description: "Save an email as a Gmail draft (never sends); with pitchId a note goes on the pitch timeline.",
  input: sendIn.omit({ markPitched: true }),
  async run(ctx, i) { const { target: _t, ...rest } = i; return draftMail(ctx, rest); },
});

export const emailSignature = defineCommand({
  name: "email.signature", roles: ["admin"],
  description: "The Gmail signature of the mailbox the caller sends from (the booking mailbox, or their own): sanitized HTML and plain text, or null when Gmail isn't connected or its grant can't read settings.",
  input: z.object({}),
  async run(ctx) {
    const account = await accountOf(ctx);
    try {
      const html = sanitizeHtml(await gmailClient().getSignature(account));
      return { html, text: htmlToText(html) };
    } catch (e) {
      // Not connected (401) or the grant can't read settings (403): the UI says "Connect Gmail again".
      if (e instanceof IntegrationError && (e.status === 401 || e.status === 403)) return null;
      throw e;
    }
  },
});

// ---------- search (Gmail, read only; nothing is copied until a thread is linked) ----------

const MAX_MESSAGES = 50;
const MAX_RESULTS = 25;

/** The place's contacts that have an email, booking contacts first for a venue. Contacts and the links to them are the band's own (venueNotes, festivalNotes, promoterNotes). */
async function placeContacts(place: Place, artistId: string): Promise<Doc[]> {
  const rec = (await db.get(COLL[place.kind], place.id))!;
  let ids: string[];
  if (place.kind === "venue") {
    const fields = privateOf((await db.get("venueNotes", venueNoteId(artistId, place.id))) ?? rec);
    const booking = (fields.bookingContactIds ?? []) as string[];
    ids = [...(fields.contactIds as string[])].sort((a, b) => Number(booking.includes(b)) - Number(booking.includes(a)));
  } else {
    // A promoter's or festival's contacts are the band's notes on it (an edition has none of its own).
    const kind = ({ promoter: "promoters", festival: "festivals", act: "acts" } as const)[place.kind];
    ids = withBandNote(kind, rec, await db.get(BAND_NOTES[kind].coll, bandNoteId(artistId, rec.id))).contactIds ?? [];
  }
  const docs = await Promise.all(ids.map((id) => db.get("contacts", id)));
  return docs.filter((c): c is Doc => !!c && !c.deletedAt && c.artistId === artistId && ((c.emails as string[] | undefined)?.length ?? 0) > 0);
}

const quote = (s: string) => `"${s.replace(/"/g, "")}"`;
const anyOf = (xs: string[]) => (xs.length === 1 ? xs[0] : `(${xs.join(" OR ")})`);

/** The Gmail query for the Threads tab: mail from or to the addresses, or matching the free text (the place's name unless the caller typed something). */
export function threadsQuery(a: { addresses: string[]; domain?: string; text: string }): string {
  const parts: string[] = [];
  if (a.addresses.length) parts.push(`from:${anyOf(a.addresses)}`, `to:${anyOf(a.addresses)}`);
  if (a.domain) parts.push(`from:@${a.domain}`, `to:@${a.domain}`);
  if (a.text.trim()) parts.push(`(${a.text.trim()})`);
  return parts.join(" OR ");
}

export interface ThreadHit { threadId: string; subject: string; snippet: string; lastDate: string; lastFrom: string; messageCount: number; participants: string[]; linkedId?: string }

/** Group the messages Gmail matched by thread, newest thread first. */
export function groupThreads(messages: MailMessage[], account: string, linked: Map<string, string>): ThreadHit[] {
  const me = account.toLowerCase();
  const by = new Map<string, MailMessage[]>();
  for (const m of messages) (by.get(m.threadId) ?? by.set(m.threadId, []).get(m.threadId)!).push(m);
  return [...by.entries()].map(([threadId, ms]) => {
    ms.sort((a, b) => a.date.localeCompare(b.date));
    const last = ms[ms.length - 1];
    const people = [...new Set(ms.flatMap((m) => [m.from, ...m.to, ...m.cc]).map((x) => x.toLowerCase()).filter((x) => x !== me && validEmail(x)))];
    return { threadId, subject: ms[0].subject, snippet: snippetOf(last.body), lastDate: last.date, lastFrom: last.from.toLowerCase(), messageCount: ms.length, participants: people, ...(linked.has(threadId) ? { linkedId: linked.get(threadId) } : {}) };
  }).sort((a, b) => b.lastDate.localeCompare(a.lastDate)).slice(0, MAX_RESULTS);
}

export interface PersonHit { email: string; name: string; title?: string; phone?: string; lastDate: string; count: number; contactId?: string }

/** Group the messages by the other party's address: the sender of a received message, the recipients of a sent one. */
export function groupPeople(messages: MailMessage[], account: string, q: string, contacts: { id: string; name: string; emails: string[] }[]): PersonHit[] {
  const me = account.toLowerCase();
  const words = norm(q.replace(/^@/, "")).split(" ").filter(Boolean);
  const newestFirst = [...messages].sort((a, b) => b.date.localeCompare(a.date));
  const by = new Map<string, { msgs: MailMessage[]; fromThem: MailMessage[] }>();
  for (const m of newestFirst) {
    const others = m.direction === "received" ? [m.from] : m.to;
    for (const raw of others) {
      const addr = raw.toLowerCase();
      if (addr === me || !validEmail(addr)) continue;
      const e = by.get(addr) ?? by.set(addr, { msgs: [], fromThem: [] }).get(addr)!;
      e.msgs.push(m);
      if (m.direction === "received") e.fromThem.push(m);
    }
  }
  const out: PersonHit[] = [];
  for (const [addr, e] of by) {
    const name = e.fromThem.find((m) => m.fromName)?.fromName ?? "";
    const contact = contacts.find((c) => c.emails.includes(addr));
    const hay = norm(`${name} ${contact?.name ?? ""} ${addr}`);
    if (!words.every((w) => hay.includes(w))) continue; // the other party of a match on someone else's address
    const sig = e.fromThem[0] ? signatureOf(e.fromThem[0].body, name) : {};
    const phone = sig.phone ? e164(sig.phone) : "";
    out.push({ email: addr, name, ...(sig.title ? { title: sig.title } : {}), ...(/^\+[1-9]\d{6,14}$/.test(phone) ? { phone } : {}), lastDate: e.msgs[0].date, count: e.msgs.length, ...(contact ? { contactId: contact.id } : {}) });
  }
  return out.sort((a, b) => b.lastDate.localeCompare(a.lastDate)).slice(0, MAX_RESULTS);
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@._ -]+/g, " ").replace(/\s+/g, " ").trim();

export const emailSearch = defineCommand({
  name: "email.search", roles: ["admin"],
  description: "Search the booking mailbox (or the caller's own Gmail when the band has none) for threads about a place: mail from or to its contacts (or to the given addresses or domain) or matching the text (the place's name when none). Read only, newest first, at most 25 threads. linkedId says the thread is already on the place.",
  input: z.strictObject({ target: targetIn, q: z.string().optional(), addresses: z.array(emailSchema).optional(), domain: z.string().regex(/^[a-z0-9.-]+$/i).optional() }),
  async run(ctx, i) {
    const [place, artistId, account] = [await resolvePlace(i.target), await artistIdFor(ctx), await accountOf(ctx)];
    const addresses = i.addresses ?? (await placeContacts(place, artistId)).flatMap((c) => c.emails as string[]);
    const q = threadsQuery({ addresses: [...new Set(addresses)], domain: i.domain, text: i.q ?? quote(place.name) });
    if (!q) return [];
    const msgs = (await gmailClient().listMessages({ account, q }).catch(gmailFail)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_MESSAGES);
    const docs = (await db.list("emailThreads", (c) => c.where("artistId", "==", artistId).where("target.id", "==", place.id))).filter((d) => d.target.kind === place.kind);
    return groupThreads(msgs, account, new Map(docs.map((d) => [d.threadId as string, d.id])));
  },
});

export interface SuggestHit extends ThreadHit {
  /** Why it matched: written to (or from) one of the place's contacts, the place's name in the subject, or only in the text. */
  why: "contact" | "subject" | "text";
  /** The place the thread is already on, when it's linked somewhere else. */
  elsewhere?: string;
}
const SUGGEST_MESSAGES = 10;
const SUGGEST_THREADS = 3;

/** The Gmail query for "Find sent emails": mail the mailbox sent to the place's contacts, or that names the place. */
export function sentQuery(addresses: string[], name: string): string {
  const parts = [...(addresses.length ? [`to:${anyOf(addresses)}`] : []), ...(name.trim() ? [quote(name.trim())] : [])];
  return parts.length ? `in:sent (${parts.join(" OR ")})` : "";
}

/** Rank a pitch's hits: a contact's address first, then the name in the subject, then the rest; newest first within each. */
export function rankSuggestions(hits: ThreadHit[], messages: MailMessage[], addresses: string[], name: string): Omit<SuggestHit, "elsewhere">[] {
  const addrs = new Set(addresses.map((a) => a.toLowerCase()));
  const n = name.trim().toLowerCase();
  const order = { contact: 0, subject: 1, text: 2 } as const;
  return hits.map((h) => {
    const ms = messages.filter((m) => m.threadId === h.threadId);
    const why: SuggestHit["why"] = ms.some((m) => [m.from, ...m.to, ...m.cc].some((a) => addrs.has(a.toLowerCase()))) ? "contact"
      : n && ms.some((m) => m.subject.toLowerCase().includes(n)) ? "subject" : "text";
    return { ...h, why };
  }).sort((a, b) => order[a.why] - order[b.why] || b.lastDate.localeCompare(a.lastDate));
}

export const emailSuggest = defineCommand({
  name: "email.suggest", roles: ["admin"],
  description: "Find sent emails: the threads the booking mailbox (or the caller's own Gmail) sent that look like this pitch's, to the place's contacts or naming the place. Read only. Returns {account, hits}: the mailbox searched and at most 3 threads, best first, each with why it matched. Threads already on this pitch are left out; elsewhere names the place a thread is already linked to.",
  input: z.strictObject({ pitchId: z.string().min(1) }),
  async run(ctx, { pitchId }) {
    const pitch = await requirePitchDoc(pitchId);
    if (ctx.artistId && pitch.artistId && pitch.artistId !== ctx.artistId) throw new AppError("not_found", "Pitch not found", 404);
    const [place, artistId, account] = [await placeOfPitch(pitch), await artistIdFor(ctx), await accountOf(ctx)];
    const addresses = [...new Set((await placeContacts(place, artistId)).flatMap((c) => c.emails as string[]))];
    const q = sentQuery(addresses, place.name);
    if (!q) return { account, hits: [] };
    const msgs = (await gmailClient().listMessages({ account, q, max: SUGGEST_MESSAGES }).catch(gmailFail)).sort((a, b) => b.date.localeCompare(a.date));
    const ranked = rankSuggestions(groupThreads(msgs, account, new Map()), msgs, addresses, place.name);
    const out: SuggestHit[] = [];
    for (const h of ranked) {
      const d = await db.get("emailThreads", emailThreadId(artistId, h.threadId));
      const live = d && !d.deletedAt ? d : null;
      if (live && threadPitchIds(live as { pitchId?: string; pitchIds?: string[] }).includes(pitchId)) continue;
      const elsewhere = live && live.target.id !== place.id ? (live.target.name as string) : undefined;
      out.push({ ...h, ...(live ? { linkedId: live.id } : {}), ...(elsewhere ? { elsewhere } : {}) });
      if (out.length === SUGGEST_THREADS) break;
    }
    return { account, hits: out };
  },
});

export const emailPeople = defineCommand({
  name: "email.people", roles: ["admin"],
  description: "Who the band has emailed with, from the booking mailbox (or the caller's own Gmail when the band has none): q is a name, an address or a domain. Returns {email, name, title?, phone?, lastDate, count, contactId?}, with title and phone guessed from the sender's signature. Read only, newest first, at most 25.",
  input: z.strictObject({ target: targetIn, q: z.string().trim().min(1) }),
  async run(ctx, i) {
    const account = await accountOf(ctx);
    await resolvePlace(i.target);
    const term = /^[^\s"()]+$/.test(i.q) ? i.q : quote(i.q);
    const msgs = (await gmailClient().listMessages({ account, q: `from:${term} OR to:${term}` }).catch(gmailFail)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_MESSAGES);
    const addrs = [...new Set(msgs.flatMap((m) => [m.from, ...m.to]).map((a) => a.toLowerCase()).filter(validEmail))];
    const artistId = await callerArtistId(ctx);
    const found = (await Promise.all(addrs.map((a) => db.list("contacts", (c) => c.where("emails", "array-contains", a))))).flat().filter((c) => !c.deletedAt && c.artistId === artistId);
    return groupPeople(msgs, account, i.q, found.map((c) => ({ id: c.id, name: c.name as string, emails: c.emails as string[] })));
  },
});

export const emailCommands = [emailSignature, emailLink, emailUnlink, emailSync, emailThread, emailSend, emailDraft, emailSearch, emailPeople, emailSuggest];
