import { defineFake, runIfMain, esc, need, required, type Route } from "../lib";

export interface GMessage {
  id: string; threadId: string; account: string; direction: "sent" | "received";
  from: string; to: string[]; cc: string[]; subject: string; body: string; html?: string; date: string;
}
export interface GDraft { id: string; account: string; to: string[]; cc: string[]; subject: string; body: string; html?: string; threadId?: string; date: string }
export interface GmailState { seq: number; messages: GMessage[]; drafts: GDraft[]; /** Gmail signature (HTML) per account, set with PUT /settings/signature. */ signatures?: Record<string, string> }

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const threadsOf = (s: GmailState, account?: string) => {
  const by = new Map<string, GMessage[]>();
  for (const m of s.messages) if (!account || m.account === account) (by.get(m.threadId) ?? by.set(m.threadId, []).get(m.threadId)!).push(m);
  return [...by.entries()].map(([id, messages]) => ({ id, subject: messages[0].subject, messages, lastDate: messages[messages.length - 1].date }))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
};

const routes: Route<GmailState>[] = [
  ["POST", "/messages/send", ({ body }, s) => {
    required(body, "from", "to", "subject");
    const to = list(body.to);
    if (!to.length) return { status: 400, json: { error: { code: 400, message: "Missing field: to" } } };
    const id = `m${++s.seq}`;
    const threadId = body.threadId ? need(s.messages.find((m) => m.threadId === body.threadId), "Thread").threadId : `t${++s.seq}`;
    const m: GMessage = { id, threadId, account: body.from, direction: "sent", from: body.from, to, cc: list(body.cc), subject: body.subject, body: body.body ?? "", ...(body.html ? { html: String(body.html) } : {}), date: new Date().toISOString() };
    s.messages.push(m);
    return { json: m }; // wrapped: a bare object with an `html` key would be taken for an HTML page
  }],
  ["POST", "/drafts", ({ body }, s) => {
    required(body, "from", "subject");
    const d: GDraft = { id: `d${++s.seq}`, account: body.from, to: list(body.to), cc: list(body.cc), subject: body.subject, body: body.body ?? "", ...(body.html ? { html: String(body.html) } : {}), threadId: body.threadId, date: new Date().toISOString() };
    s.drafts.push(d);
    return { json: d };
  }],
  ["GET", "/drafts", ({ query }, s) => s.drafts.filter((d) => !query.get("account") || d.account === query.get("account"))],
  ["GET", "/messages", ({ query }, s) => {
    const q = query.get("q")?.toLowerCase();
    return s.messages.filter((m) => (!query.get("account") || m.account === query.get("account")) && (!query.get("threadId") || m.threadId === query.get("threadId"))
      && (!q || `${m.subject} ${m.body}`.toLowerCase().includes(q)));
  }],
  ["GET", "/threads", ({ query }, s) => threadsOf(s, query.get("account") ?? undefined)],
  ["GET", "/threads/:id", ({ params }, s) => need(threadsOf(s).find((t) => t.id === params.id), "Thread")],
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
      from: body.from || lastSent.to[0] || "someone@example.com", to: [lastSent.account], cc: [],
      subject: msgs[0].subject.startsWith("Re:") ? msgs[0].subject : `Re: ${msgs[0].subject}`,
      body: body.body || "Thanks for reaching out. We would love to have you play. What dates are you thinking?", date: new Date().toISOString(),
    };
    s.messages.push(m);
    return m;
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
