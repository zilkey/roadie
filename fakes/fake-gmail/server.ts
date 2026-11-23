import { defineFake, runIfMain, esc, need, required, type Route } from "../lib";
import { matches } from "./query";

export interface GMessage {
  id: string; threadId: string; account: string; direction: "sent" | "received";
  from: string; /** Display name of the sender; missing on messages written before it existed. */ fromName?: string; to: string[]; cc: string[]; subject: string; body: string; html?: string; date: string;
  /** Only on search results: a draft, or scheduled (see GET /messages). */ unsent?: "draft" | "scheduled";
}
export interface GDraft { id: string; account: string; to: string[]; cc: string[]; subject: string; body: string; html?: string; threadId?: string; date: string; messageId?: string; /** Gmail's Schedule send: out of Drafts, waiting to go. */ scheduled?: boolean; /** When a scheduled draft goes. */ sendAt?: string }
export interface GmailState { seq: number; messages: GMessage[]; drafts: GDraft[]; /** Gmail signature (HTML) per account, set with PUT /settings/signature. */ signatures?: Record<string, string> }

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const threadsOf = (s: GmailState, account?: string) => {
  const by = new Map<string, GMessage[]>();
  for (const m of s.messages) if (!account || m.account === account) (by.get(m.threadId) ?? by.set(m.threadId, []).get(m.threadId)!).push(m);
  return [...by.entries()].map(([id, messages]) => ({ id, subject: messages[0].subject, messages, lastDate: messages[messages.length - 1].date }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
};

/** A draft as Gmail's search shows it: an unsent message, dated when it goes once scheduled. */
const unsentMessage = (d: GDraft): GMessage => ({
  id: d.messageId ?? d.id, threadId: d.threadId ?? d.id, account: d.account, direction: "sent", from: d.account, fromName: "", to: d.to, cc: d.cc,
  subject: d.subject, body: d.body, date: d.scheduled && d.sendAt ? d.sendAt : d.date, unsent: d.scheduled ? "scheduled" : "draft",
});

const routes: Route<GmailState>[] = [
  ["POST", "/messages/send", ({ body }, s) => {
    required(body, "from", "to", "subject");
    const to = list(body.to);
    if (!to.length) return { status: 400, json: { error: { code: 400, message: "Missing field: to" } } };
    const id = `m${++s.seq}`;
    const threadId = body.threadId ? need(s.messages.find((m) => m.threadId === body.threadId), "Thread").threadId : `t${++s.seq}`;
    const m: GMessage = { id, threadId, account: body.from, direction: "sent", from: body.from, fromName: "", to, cc: list(body.cc), subject: body.subject, body: body.body ?? "", ...(body.html ? { html: String(body.html) } : {}), date: new Date().toISOString() };
    s.messages.push(m);
    return { json: m }; // wrapped: a bare object with an `html` key would be taken for an HTML page
  }],
  ["POST", "/drafts", ({ body }, s) => {
    required(body, "from", "subject");
    // Like Gmail, a draft has its own message and a thread: the one it answers, or a new one.
    const d: GDraft = { id: `d${++s.seq}`, account: body.from, to: list(body.to), cc: list(body.cc), subject: body.subject, body: body.body ?? "", ...(body.html ? { html: String(body.html) } : {}),
      threadId: body.threadId || `t${++s.seq}`, messageId: `m${++s.seq}`, date: new Date().toISOString() };
    s.drafts.push(d);
    return { json: d };
  }],
  // Test setup, what a person does in Gmail with a draft Roadie made: Schedule send (scheduled), send it (optionally at `date`), or delete it.
  // Test setup: a draft made in Gmail, not by Roadie (body as POST /drafts), optionally already scheduled ({scheduled, sendAt}).
  ["POST", "/drafts/gmail", ({ body }, s) => {
    required(body, "from", "subject");
    const d: GDraft = { id: `d${++s.seq}`, account: body.from, to: list(body.to), cc: list(body.cc), subject: body.subject, body: body.body ?? "",
      threadId: body.threadId || `t${++s.seq}`, messageId: `m${++s.seq}`, date: new Date().toISOString(), ...(body.scheduled ? { scheduled: true, sendAt: new Date(body.sendAt ?? Date.now() + 86_400_000).toISOString() } : {}) };
    s.drafts.push(d);
    return { json: d };
  }],
  ["POST", "/drafts/:id/schedule", ({ params, body }, s) => {
    const d = need(s.drafts.find((x) => x.id === params.id), "Draft");
    d.scheduled = true; d.sendAt = new Date(body?.sendAt ?? Date.now() + 86_400_000).toISOString();
    return d;
  }],
  ["POST", "/drafts/:id/send", ({ params, body }, s) => {
    const d = need(s.drafts.find((x) => x.id === params.id), "Draft");
    s.drafts = s.drafts.filter((x) => x !== d);
    const m: GMessage = { id: d.messageId ?? `m${++s.seq}`, threadId: d.threadId ?? `t${++s.seq}`, account: d.account, direction: "sent", from: d.account, fromName: "", to: d.to, cc: d.cc,
      subject: d.subject, body: d.body, ...(d.html ? { html: d.html } : {}), date: body?.date ? new Date(String(body.date)).toISOString() : new Date().toISOString() };
    s.messages.push(m);
    return { json: m }; // wrapped: see /messages/send
  }],
  ["DELETE", "/drafts/:id", ({ params }, s) => { s.drafts = s.drafts.filter((x) => x.id !== params.id); return { ok: true }; }],
  ["GET", "/drafts/:id/status", ({ params, query }, s) => {
    // Found by its message when Roadie only saw it scheduled (no draft id): like Gmail, a scheduled message has left Drafts.
    const d = s.drafts.find((x) => x.id === params.id || (!!x.messageId && x.messageId === query.get("messageId")));
    if (d) return { state: d.scheduled ? "scheduled" : "draft" };
    const t = threadsOf(s).find((x) => x.id === query.get("threadId"));
    const message = t?.messages.find((m) => m.id === query.get("messageId") && m.direction === "sent");
    return message ? { json: { state: "sent", message, thread: t } } : { state: "gone" };
  }],
  ["GET", "/drafts", ({ query }, s) => s.drafts.filter((d) => !query.get("account") || d.account === query.get("account"))],
  // Like Gmail's search, drafts and scheduled mail come back too (not in a thread's own listing).
  ["GET", "/messages", ({ query }, s) => {
    const q = query.get("q");
    const unsent = query.get("threadId") ? [] : s.drafts.map(unsentMessage);
    return [...s.messages, ...unsent].filter((m) => (!query.get("account") || m.account === query.get("account")) && (!query.get("threadId") || m.threadId === query.get("threadId")) && matches(q, m));
  }],
  // A message that arrives from outside: a stranger's first email or a web form's auto-reply (new thread), or one more in an existing thread.
  ["POST", "/messages/receive", ({ body }, s) => {
    required(body, "from", "to", "subject");
    const to = list(body.to);
    if (!to.length) return { status: 400, json: { error: { code: 400, message: "Missing field: to" } } };
    const inThread = body.threadId ? need(s.messages.find((m) => m.threadId === body.threadId), "Thread") : undefined;
    const m: GMessage = {
      id: `m${++s.seq}`, threadId: inThread ? inThread.threadId : `t${++s.seq}`, account: inThread ? inThread.account : to[0], direction: "received",
      from: String(body.from).toLowerCase(), fromName: body.fromName ?? "", to, cc: list(body.cc), subject: body.subject, body: body.body ?? "", ...(body.html ? { html: String(body.html) } : {}), date: new Date().toISOString(),
    };
    s.messages.push(m);
    return { json: m }; // wrapped: see /messages/send
  }],
  ["GET", "/threads", ({ query }, s) => threadsOf(s, query.get("account") ?? undefined)],
  ["GET", "/threads/:id", ({ params, query }, s) => {
    if (!query.get("unsent")) return need(threadsOf(s).find((t) => t.id === params.id), "Thread");
    // ?unsent=1: its drafts and scheduled mail too, as search shows them.
    const messages = [...s.messages.filter((m) => m.threadId === params.id), ...s.drafts.filter((d) => d.threadId === params.id).map((d) => unsentMessage(d))];
    need(messages[0], "Thread");
    return { id: params.id, subject: messages[0].subject, messages, lastDate: messages[messages.length - 1].date };
  }],
  // The Gmail signature, as users.settings.sendAs.list answers it: one primary address for the account.
  ["GET", "/settings/sendAs", ({ query }, s) => {
    const account = query.get("account") ?? "";
    return { sendAs: [{ sendAsEmail: account, isPrimary: true, signature: s.signatures?.[account] ?? "" }] };
  }],
  // Test setup: PUT /settings/signature {account, signature}.
  ["PUT", "/settings/signature", ({ body }, s) => {
    required(body, "account");
    (s.signatures ??= {})[body.account] = String(body.signature ?? "");
    return { account: body.account, signature: s.signatures[body.account] };
  }],
  // Simulate the recipient replying. `from` defaults to the first recipient of the thread's last sent message.
  ["POST", "/threads/:id/reply", ({ params, body }, s) => {
    const msgs = s.messages.filter((m) => m.threadId === params.id);
    if (!msgs.length) return { status: 404, json: { error: { code: 404, message: "Thread not found" } } };
    const lastSent = [...msgs].reverse().find((m) => m.direction === "sent") ?? msgs[msgs.length - 1];
    const m: GMessage = {
      id: `m${++s.seq}`, threadId: params.id, account: lastSent.account, direction: "received",
      from: body.from || lastSent.to[0] || "someone@example.com", fromName: body.fromName ?? "", to: [lastSent.account], cc: [],
      subject: msgs[0].subject.startsWith("Re:") ? msgs[0].subject : `Re: ${msgs[0].subject}`,
      body: body.body || "Thanks for reaching out. We would love to have you play. What dates are you thinking?", ...(body.html ? { html: String(body.html) } : {}), date: new Date().toISOString(),
    };
    s.messages.push(m);
    return { json: m }; // wrapped: see /messages/send
  }],
];

export const fakeGmail = defineFake<GmailState>({
  name: "fake-gmail", defaultPort: 3201, initial: () => ({ seq: 0, messages: [], drafts: [] }), routes,
  page: (s) => `<h2>Threads</h2>${threadsOf(s).map((t) => `<h3>${esc(t.subject)} <span class="muted">${t.id}</span></h3><table>${t.messages.map((m) =>
    `<tr><td>${m.direction}</td><td>${esc(m.from)} &rarr; ${esc(m.to.join(", "))}${m.cc.length ? ` (cc ${esc(m.cc.join(", "))})` : ""}</td><td><pre>${esc(m.body)}</pre></td><td>${esc(m.date)}</td></tr>`).join("")}</table>
    <form method="post" action="/threads/${t.id}/reply"><button data-testid="simulate-reply">Simulate reply</button></form>`).join("") || "<p>No messages yet.</p>"}
    <h2>Drafts</h2><table>${s.drafts.map((d) => `<tr><td>${esc(d.account)}</td><td>${esc(d.to.join(", "))}</td><td>${esc(d.subject)}</td><td><pre>${esc(d.body)}</pre></td></tr>`).join("") || "<tr><td>None</td></tr>"}</table>`,
});
runIfMain(import.meta, fakeGmail);
