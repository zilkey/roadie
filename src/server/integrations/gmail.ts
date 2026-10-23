/**
 * Gmail integration. Real implementation later: Gmail API (users.messages.send, users.drafts.create,
 * users.threads.list/get) with OAuth scopes gmail.send, gmail.compose, gmail.readonly (see docs/FIREBASE-SETUP.md).
 * `account` is the sending mailbox (the admin who owns the OAuth grant).
 */
import { jsonClient } from "./http";

export interface MailInput { account: string; to: string[]; cc?: string[]; subject: string; body: string; threadId?: string }
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
  getThread(id: string): Promise<MailThread>;
  /** Fake only: pretend the recipient replied. Not part of the real API. */
  simulateReply?(threadId: string, opts?: { from?: string; body?: string }): Promise<MailMessage>;
}

export function gmailClient(baseUrl = process.env.GMAIL_BASE_URL ?? "http://127.0.0.1:3201"): GmailService {
  const call = jsonClient("gmail", baseUrl);
  const wire = (i: MailInput) => ({ from: i.account, to: i.to, cc: i.cc ?? [], subject: i.subject, body: i.body, threadId: i.threadId });
  return {
    send: (i) => call("POST", "/messages/send", { body: wire(i) }),
    createDraft: (i) => call("POST", "/drafts", { body: wire(i) }),
    listDrafts: (account) => call("GET", "/drafts", { query: { account } }),
    listMessages: (o = {}) => call("GET", "/messages", { query: o }),
    listThreads: (account) => call("GET", "/threads", { query: { account } }),
    getThread: (id) => call("GET", `/threads/${encodeURIComponent(id)}`),
    simulateReply: (id, o = {}) => call("POST", `/threads/${encodeURIComponent(id)}/reply`, { body: o }),
  };
}
