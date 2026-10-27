/**
 * Gmail. Two implementations of GmailService: the fake's HTTP client (fakes/fake-gmail; dev and tests) and the Gmail API
 * (users.messages.send, users.drafts.create/list/get, users.messages.list/get, users.threads.list/get), chosen by
 * gmailClient(). `account` is the sending mailbox: the admin whose own Google grant sends it (see src/server/google).
 * Replies are found by reading the thread again (pitches.checkReplies).
 */
import { randomBytes } from "node:crypto";
import { IntegrationError, jsonClient } from "./http";
import { googleJson, useRealGoogle } from "./google";
import { accessTokenForEmail } from "../google/grants";

export interface MailInput { account: string; to: string[]; cc?: string[]; subject: string; body: string; /** Sent as multipart/alternative next to `body` (the plain text). Sanitize it first (src/lib/email-html.ts). */ html?: string; threadId?: string }
export interface MailMessage {
  id: string; threadId: string; account: string; direction: "sent" | "received";
  from: string; to: string[]; cc: string[]; subject: string; body: string; date: string;
}
export interface MailDraft { id: string; account: string; to: string[]; cc: string[]; subject: string; body: string; threadId?: string; date: string }
export interface MailThread { id: string; subject: string; messages: MailMessage[]; lastDate: string }

export interface GmailService {
  send(input: MailInput): Promise<MailMessage>;
  createDraft(input: MailInput): Promise<MailDraft>;
  listDrafts(account?: string): Promise<MailDraft[]>;
  listMessages(opts?: { account?: string; threadId?: string; q?: string }): Promise<MailMessage[]>;
  listThreads(account?: string): Promise<MailThread[]>;
  /** `account` is the mailbox the thread is in (the real API needs it; the fake has one shared view). */
  getThread(id: string, account?: string): Promise<MailThread>;
  /** The Gmail signature (HTML, as Gmail stores it) of the account's primary address; "" when none is set. Throws IntegrationError(403) when the grant can't read settings. */
  getSignature(account: string): Promise<string>;
  /** Fake only: pretend the recipient replied. Not part of the real API. */
  simulateReply?(threadId: string, opts?: { from?: string; body?: string }): Promise<MailMessage>;
}

/** The real Gmail API when Google is configured and GMAIL_BASE_URL isn't set; otherwise the fake at GMAIL_BASE_URL. */
export function gmailClient(baseUrl?: string): GmailService {
  if (useRealGoogle(process.env.GMAIL_BASE_URL, baseUrl)) return googleGmail((account, force) => accessTokenForEmail(account, "gmail", force));
  return fakeGmailClient(baseUrl ?? process.env.GMAIL_BASE_URL ?? "http://127.0.0.1:3201");
}

export function fakeGmailClient(baseUrl: string): GmailService {
  const call = jsonClient("gmail", baseUrl);
  const wire = (i: MailInput) => ({ from: i.account, to: i.to, cc: i.cc ?? [], subject: i.subject, body: i.body, ...(i.html ? { html: i.html } : {}), threadId: i.threadId });
  return {
    send: (i) => call("POST", "/messages/send", { body: wire(i) }),
    createDraft: (i) => call("POST", "/drafts", { body: wire(i) }),
    listDrafts: (account) => call("GET", "/drafts", { query: { account } }),
    listMessages: (o = {}) => call("GET", "/messages", { query: o }),
    listThreads: (account) => call("GET", "/threads", { query: { account } }),
    getThread: (id) => call("GET", `/threads/${encodeURIComponent(id)}`),
    async getSignature(account) {
      const r = await call<{ sendAs?: { isPrimary?: boolean; signature?: string }[] }>("GET", "/settings/sendAs", { query: { account } });
      return r.sendAs?.find((a) => a.isPrimary)?.signature ?? "";
    },
    simulateReply: (id, o = {}) => call("POST", `/threads/${encodeURIComponent(id)}/reply`, { body: o }),
  };
}

// ---------- the Gmail API ----------

interface GPart { mimeType?: string; headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: GPart[] }
interface GMessage { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: GPart }

const header = (p: GPart | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
const addresses = (v: string) => (v.match(/[^\s<>,"';:]+@[^\s<>,"';:]+/g) ?? []).map((a) => a.toLowerCase());
const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");
/** Header text: plain ASCII as is, anything else as an RFC 2047 encoded word. Line breaks are dropped (no header injection). */
const headerText = (v: string) => { const s = v.replace(/[\r\n]+/g, " "); return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`; };

function textOf(p: GPart | undefined): string {
  if (!p) return "";
  const find = (part: GPart, type: string): GPart | undefined =>
    part.mimeType === type && part.body?.data ? part : part.parts?.map((x) => find(x, type)).find(Boolean);
  const plain = find(p, "text/plain");
  if (plain) return decode(plain.body?.data);
  const html = find(p, "text/html");
  return html ? decode(html.body?.data).replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim() : "";
}

function toMessage(m: GMessage, account: string): MailMessage {
  const p = m.payload;
  return {
    id: m.id, threadId: m.threadId, account, direction: m.labelIds?.includes("SENT") ? "sent" : "received",
    from: addresses(header(p, "from"))[0] ?? "", to: addresses(header(p, "to")), cc: addresses(header(p, "cc")),
    subject: header(p, "subject"), body: textOf(p), date: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
  };
}

const b64Lines = (s: string) => Buffer.from(s, "utf8").toString("base64").match(/.{1,76}/g) ?? [];

/** An RFC 2822 message, base64url as Gmail's `raw` wants it: text/plain, or multipart/alternative (plain text, then HTML) when `html` is given. */
export function rawMessage(i: MailInput, reply?: { messageId: string; references: string }): string {
  const head = [
    `To: ${i.to.join(", ")}`, ...(i.cc?.length ? [`Cc: ${i.cc.join(", ")}`] : []), `Subject: ${headerText(i.subject)}`,
    ...(reply?.messageId ? [`In-Reply-To: ${reply.messageId}`, `References: ${[reply.references, reply.messageId].filter(Boolean).join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];
  const part = (type: string, text: string) => [`Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", ...b64Lines(text)];
  const lines = !i.html
    ? [...head, ...part("text/plain", i.body)]
    : (() => {
        const boundary = `roadie_${randomBytes(12).toString("hex")}`;
        return [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
          `--${boundary}`, ...part("text/plain", i.body), `--${boundary}`, ...part("text/html", i.html), `--${boundary}--`, ""];
      })();
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function googleGmail(tokenFor: (account: string, force?: boolean) => Promise<string>, baseUrl = "https://gmail.googleapis.com/gmail/v1/users/me"): GmailService {
  const callAs = (account: string | undefined) => {
    if (!account) throw new IntegrationError("gmail", 400, "Which mailbox? Gmail needs the account");
    return googleJson("gmail", baseUrl, (force) => tokenFor(account, force));
  };
  const getMessage = (account: string, id: string) => callAs(account)<GMessage>("GET", `/messages/${encodeURIComponent(id)}`, { query: { format: "full" } });

  async function getThread(id: string, account?: string): Promise<MailThread> {
    const t = await callAs(account)<{ id: string; messages?: GMessage[] }>("GET", `/threads/${encodeURIComponent(id)}`, { query: { format: "full" } });
    const messages = (t.messages ?? []).filter((m) => !m.labelIds?.includes("DRAFT")).map((m) => toMessage(m, account!));
    return { id: t.id, subject: messages[0]?.subject ?? "", messages, lastDate: messages[messages.length - 1]?.date ?? "" };
  }

  /** In-Reply-To / References for answering in a thread, from its last message. */
  async function replyHeaders(account: string, threadId: string) {
    const t = await callAs(account)<{ messages?: GMessage[] }>("GET", `/threads/${encodeURIComponent(threadId)}`, { query: { format: "metadata" } });
    const last = t.messages?.[t.messages.length - 1]?.payload;
    return { messageId: header(last, "message-id"), references: header(last, "references") };
  }

  async function encode(i: MailInput) {
    return { raw: rawMessage(i, i.threadId ? await replyHeaders(i.account, i.threadId) : undefined), ...(i.threadId ? { threadId: i.threadId } : {}) };
  }

  const toDraft = (d: { id: string; message: GMessage }, account: string): MailDraft => {
    const m = toMessage(d.message, account);
    return { id: d.id, account, to: m.to, cc: m.cc, subject: m.subject, body: m.body, threadId: d.message.threadId, date: m.date };
  };

  return {
    async send(i) {
      const sent = await callAs(i.account)<{ id: string; threadId: string }>("POST", "/messages/send", { body: await encode(i) });
      return { id: sent.id, threadId: sent.threadId, account: i.account, direction: "sent", from: i.account, to: i.to, cc: i.cc ?? [], subject: i.subject, body: i.body, date: new Date().toISOString() };
    },
    async createDraft(i) {
      const d = await callAs(i.account)<{ id: string; message: { id: string; threadId: string } }>("POST", "/drafts", { body: { message: await encode(i) } });
      return { id: d.id, account: i.account, to: i.to, cc: i.cc ?? [], subject: i.subject, body: i.body, threadId: d.message.threadId, date: new Date().toISOString() };
    },
    async listDrafts(account) {
      const r = await callAs(account)<{ drafts?: { id: string }[] }>("GET", "/drafts", { query: { maxResults: "25" } });
      return Promise.all((r.drafts ?? []).map(async (d) =>
        toDraft(await callAs(account)<{ id: string; message: GMessage }>("GET", `/drafts/${encodeURIComponent(d.id)}`, { query: { format: "full" } }), account!)));
    },
    async listMessages(o = {}) {
      if (o.threadId) return (await getThread(o.threadId, o.account)).messages;
      const r = await callAs(o.account)<{ messages?: { id: string }[] }>("GET", "/messages", { query: { q: o.q, maxResults: "50" } });
      return Promise.all((r.messages ?? []).map(async (m) => toMessage(await getMessage(o.account!, m.id), o.account!)));
    },
    async listThreads(account) {
      const r = await callAs(account)<{ threads?: { id: string }[] }>("GET", "/threads", { query: { maxResults: "20" } });
      return Promise.all((r.threads ?? []).map((t) => getThread(t.id, account)));
    },
    getThread,
    async getSignature(account) {
      const r = await callAs(account)<{ sendAs?: { sendAsEmail?: string; isPrimary?: boolean; signature?: string }[] }>("GET", "/settings/sendAs");
      return r.sendAs?.find((a) => a.isPrimary)?.signature ?? "";
    },
  };
}
