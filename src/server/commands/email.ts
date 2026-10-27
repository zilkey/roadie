/**
 * Email on places. A Gmail thread belongs to the place (venue, promoter or festival), not to one pitch, so it stays when the
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
import { signatureOf } from "@/lib/email-signature";
import { e164 } from "@/schema/normalize";
import { emailThreadId, venueNoteId, email as emailSchema } from "@/schema";
import { privateOf } from "../venues";

export const gmailFail = (e: unknown): never => {
  if (e instanceof IntegrationError) throw new AppError("gmail_error", `Gmail: ${e.message}`, 502);
  throw e;
};

export type Place = { kind: "venue" | "promoter" | "festival"; id: string; name: string };
const targetIn = z.strictObject({ kind: z.enum(["venue", "promoter", "festival", "edition"]), id: z.string().min(1) });
type TargetIn = z.infer<typeof targetIn>;
const COLL = { venue: "venues", promoter: "promoters", festival: "festivals", edition: "editions" } as const;

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
async function accountOf(ctx: Ctx): Promise<string> {
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
    lastDate: last?.date ?? thread.lastDate,
    lastFrom: validEmail(from) ? from : me,
    lastDirection: last?.direction ?? "sent",
    messageCount: msgs.length,
    participants,
  };
}

/** Create the thread's doc, or refresh it (and bring back an unlinked one when `place` is given). */
async function upsertThread(w: Writer, a: { artistId: string; account: string; thread: MailThread; place?: Place; pitchId?: string }) {
  const id = emailThreadId(a.artistId, a.thread.id);
  const existing = await w.get("emailThreads", id);
  const sum = summarize(a.thread, a.account);
  if (!existing) {
    if (!a.place) throw new AppError("invalid_input", "Which place does this thread belong to?", 400);
    await w.create("emailThreads", { artistId: a.artistId, account: a.account, threadId: a.thread.id, target: a.place, ...(a.pitchId ? { pitchId: a.pitchId } : {}), ...sum, syncedAt: w.now }, { id });
  } else {
    if (existing.deletedAt) await w.restore("emailThreads", id);
    await w.update("emailThreads", id, { ...sum, syncedAt: w.now, ...(a.place ? { target: a.place } : {}), ...(a.pitchId ? { pitchId: a.pitchId } : {}) });
  }
  return id;
}

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

export async function linkThread(ctx: Ctx, i: { threadId: string; place: Place; pitchId?: string; account?: string }) {
  const [artistId, account] = [await artistIdFor(ctx), i.account ?? (await accountOf(ctx))];
  if (i.pitchId) await requirePitchDoc(i.pitchId);
  const thread = await gmailClient().getThread(i.threadId, account).catch(gmailFail);
  return run(ctx, async (w) => {
    const id = await upsertThread(w, { artistId, account, thread, place: i.place, pitchId: i.pitchId });
    const added = i.pitchId ? await addReplies(w, i.pitchId, thread.messages) : 0;
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
      if (d.pitchId) n += await addReplies(w, d.pitchId, thread.messages).catch((e) => (e instanceof AppError && e.status === 404 ? 0 : Promise.reject(e)));
    }
    return n;
  });
  return { added, threads: docs.length };
}

const mailIn = {
  pitchId: z.string().min(1).optional(), threadId: z.string().min(1).optional(), html: z.string().optional(),
  to: z.array(emailSchema).min(1), cc: z.array(emailSchema).optional(), subject: z.string().min(1), body: z.string().min(1),
};

export async function sendMail(ctx: Ctx, i: { place: Place; pitchId?: string; threadId?: string; to: string[]; cc?: string[]; subject: string; body: string; html?: string; markPitched?: boolean }) {
  const missing = unfilledFields(`${i.subject}\n${i.body}`);
  if (missing.length) throw new AppError("unfilled_fields", `Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before sending`, 400);
  if (i.pitchId) await requirePitchDoc(i.pitchId);
  const [artistId, account] = [await artistIdFor(ctx), await accountOf(ctx)];
  const gmail = gmailClient();
  const msg = await gmail.send({ account, to: i.to, cc: i.cc, subject: i.subject, body: i.body, html: i.html && sanitizeHtml(i.html), threadId: i.threadId }).catch(gmailFail);
  const thread = await gmail.getThread(msg.threadId, account).catch((): MailThread => ({ id: msg.threadId, subject: msg.subject, messages: [msg], lastDate: msg.date }));
  return run(ctx, async (w) => {
    const id = await upsertThread(w, { artistId, account, thread, place: i.place, pitchId: i.pitchId });
    let activityId: string | undefined;
    if (i.pitchId) {
      const p = (await w.get("pitches", i.pitchId))!;
      activityId = (await w.create(`pitches/${i.pitchId}/activity`, {
        type: "emailSent", text: i.body, gmail: { messageId: msg.id, threadId: msg.threadId, to: i.to.join(", "), subject: i.subject, account },
      })).id;
      await w.update("pitches", i.pitchId, { lastContactAt: w.now });
      if (i.markPitched && (p.status === "idea" || p.status === "toPitch")) {
        await w.update("pitches", i.pitchId, { status: "pitched" });
        await w.create(`pitches/${i.pitchId}/activity`, { type: "status", fromStatus: p.status, toStatus: "pitched" });
      }
    }
    return { id, activityId, messageId: msg.id, threadId: msg.threadId };
  });
}

export async function draftMail(ctx: Ctx, i: { pitchId?: string; threadId?: string; to: string[]; cc?: string[]; subject: string; body: string; html?: string }) {
  const missing = unfilledFields(`${i.subject}\n${i.body}`);
  if (missing.length) throw new AppError("unfilled_fields", `Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before drafting`, 400);
  if (i.pitchId) await requirePitchDoc(i.pitchId);
  const account = await accountOf(ctx);
  const draft = await gmailClient().createDraft({ account, to: i.to, cc: i.cc, subject: i.subject, body: i.body, html: i.html && sanitizeHtml(i.html), threadId: i.threadId }).catch(gmailFail);
  const act = i.pitchId
    ? await db.create(ctx, `pitches/${i.pitchId}/activity`, { type: "note", text: `Email drafted (not sent) to ${i.to.join(", ")}: ${i.subject}\n\n${i.body}` })
    : undefined;
  return { id: act?.id, draftId: draft.id, sent: false as const };
}

/** The pitch-level "check for replies": link the threads this pitch's timeline already mentions (older pitches), then sync the place. */
export async function checkPitchReplies(ctx: Ctx, pitchId: string): Promise<{ added: number }> {
  const pitch = await requirePitchDoc(pitchId);
  const place = await placeOfPitch(pitch);
  const [artistId, acts, me] = [await artistIdFor(ctx), await db.list(`pitches/${pitchId}/activity`), await accountOf(ctx)];
  const threads = new Map<string, string>();
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

async function ownThread(ctx: Ctx, id: string): Promise<Doc> {
  const [d, artistId] = [await db.get("emailThreads", id), await artistIdFor(ctx)];
  if (!d || d.deletedAt || d.artistId !== artistId) throw new AppError("not_found", "Thread not found", 404);
  return d;
}

export const emailLink = defineCommand({
  name: "email.link", roles: ["admin"],
  description: "Put a Gmail thread on a venue, promoter or festival (an edition's threads go on its festival), and start watching it for replies. With pitchId, replies not yet on that pitch's timeline are added.",
  input: z.strictObject({ threadId: z.string().min(1), target: targetIn, pitchId: z.string().min(1).optional() }),
  async run(ctx, i) {
    const r = await linkThread(ctx, { threadId: i.threadId, place: await resolvePlace(i.target), pitchId: i.pitchId });
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
    return { thread: plain({ ...d, lastSeenAt: new Date() }), messages: t.messages };
  },
});

const sendIn = z.strictObject({ target: targetIn, ...mailIn, markPitched: z.boolean().default(false) });
export const emailSend = defineCommand({
  name: "email.send", roles: ["admin"],
  description: "Send an already filled-in email from the caller's Gmail (a reply when threadId is given). The thread lands on the place; with pitchId it is logged on that pitch's timeline and sets lastContactAt.",
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
  description: "The caller's Gmail signature (sanitized HTML and plain text), or null when Gmail isn't connected or its grant can't read settings.",
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

/** The place's contacts that have an email, booking contacts first for a venue. Contacts are the shared directory; a venue's links are the band's private notes. */
async function placeContacts(place: Place, artistId: string): Promise<Doc[]> {
  const rec = (await db.get(COLL[place.kind], place.id))!;
  let ids: string[];
  if (place.kind === "venue") {
    const fields = privateOf((await db.get("venueNotes", venueNoteId(artistId, place.id))) ?? rec);
    const booking = (fields.bookingContactIds ?? []) as string[];
    ids = [...(fields.contactIds as string[])].sort((a, b) => Number(booking.includes(b)) - Number(booking.includes(a)));
  } else ids = (rec.contactIds ?? []) as string[];
  const docs = await Promise.all(ids.map((id) => db.get("contacts", id)));
  return docs.filter((c): c is Doc => !!c && !c.deletedAt && ((c.emails as string[] | undefined)?.length ?? 0) > 0);
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
  description: "Search the caller's Gmail for threads about a place: mail from or to its contacts (or to the given addresses or domain) or matching the text (the place's name when none). Read only, newest first, at most 25 threads. linkedId says the thread is already on the place.",
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

export const emailPeople = defineCommand({
  name: "email.people", roles: ["admin"],
  description: "Who the caller has emailed with, from Gmail: q is a name, an address or a domain. Returns {email, name, title?, phone?, lastDate, count, contactId?}, with title and phone guessed from the sender's signature. Read only, newest first, at most 25.",
  input: z.strictObject({ target: targetIn, q: z.string().trim().min(1) }),
  async run(ctx, i) {
    const account = await accountOf(ctx);
    await resolvePlace(i.target);
    const term = /^[^\s"()]+$/.test(i.q) ? i.q : quote(i.q);
    const msgs = (await gmailClient().listMessages({ account, q: `from:${term} OR to:${term}` }).catch(gmailFail)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_MESSAGES);
    const addrs = [...new Set(msgs.flatMap((m) => [m.from, ...m.to]).map((a) => a.toLowerCase()).filter(validEmail))];
    const found = (await Promise.all(addrs.map((a) => db.list("contacts", (c) => c.where("emails", "array-contains", a))))).flat().filter((c) => !c.deletedAt);
    return groupPeople(msgs, account, i.q, found.map((c) => ({ id: c.id, name: c.name as string, emails: c.emails as string[] })));
  },
});

export const emailCommands = [emailSignature, emailLink, emailUnlink, emailSync, emailThread, emailSend, emailDraft, emailSearch, emailPeople];
