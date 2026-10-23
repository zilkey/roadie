/** Tiny framework for the local fake APIs: JSON routes, a state file, an HTML page, POST /__reset. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export interface FakeReq {
  method: string;
  path: string;
  query: URLSearchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  params: Record<string, string>;
}
/** Return a plain value for 200 JSON, or { status, json } / { redirect } / { html }. */
export type FakeRes = { status?: number; json?: unknown; html?: string; redirect?: string } | unknown;
export type Route<S> = [method: string, pattern: string, handler: (req: FakeReq, state: S) => FakeRes | Promise<FakeRes>];

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface FakeDef<S> {
  name: string;
  defaultPort: number;
  initial: () => S;
  routes: Route<S>[];
  /** Body HTML of the GET / page (inside the standard layout). */
  page: (state: S) => string;
}

export interface RunningFake { port: number; url: string; close: () => Promise<void> }

export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const layout = (name: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title>
<style>body{font:14px system-ui;margin:2rem;max-width:960px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}
pre{white-space:pre-wrap;margin:0}button{cursor:pointer}.muted{color:#777}</style></head><body><h1>${esc(name)} <span class="muted">(fake)</span></h1>${body}
<form method="post" action="/__reset"><button>Reset to seed data</button></form></body></html>`;

function compile(pattern: string) {
  const keys: string[] = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  return (p: string) => { const m = re.exec(p); return m ? Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) : null; };
}

export function defineFake<S>(def: FakeDef<S>) {
  const routes = def.routes.map(([m, p, h]) => ({ m, match: compile(p), h }));
  async function start(opts: { port?: number; dataDir?: string; host?: string } = {}): Promise<RunningFake> {
    const dir = opts.dataDir ?? process.env.FAKE_DATA_DIR ?? path.resolve(process.cwd(), ".fake-data");
    const file = path.join(dir, `${def.name}.json`);
    const load = (): S => {
      try { return JSON.parse(fs.readFileSync(file, "utf8")) as S; } catch { return def.initial(); }
    };
    const save = () => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(state, null, 2)); };
    let state = load();
    save();
    const server = http.createServer(async (rq, rs) => {
      const send = (status: number, type: string, payload: string, extra: Record<string, string> = {}) => {
        rs.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", ...extra });
        rs.end(payload);
      };
      try {
        const url = new URL(rq.url ?? "/", "http://x");
        const chunks: Buffer[] = [];
        for await (const c of rq) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        const ct = rq.headers["content-type"] ?? "";
        let body: unknown = undefined;
        if (raw) body = ct.includes("urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : (() => { try { return JSON.parse(raw); } catch { throw new HttpError(400, "Body is not valid JSON"); } })();
        const method = rq.method ?? "GET";
        const isForm = ct.includes("urlencoded");
        if (method === "OPTIONS") return send(204, "text/plain", "", { "access-control-allow-methods": "*", "access-control-allow-headers": "*" });
        if (url.pathname === "/health") return send(200, "application/json", JSON.stringify({ ok: true, name: def.name }));
        if (method === "GET" && url.pathname === "/") return send(200, "text/html", layout(def.name, def.page(state)));
        if (method === "POST" && url.pathname === "/__reset") {
          state = def.initial(); save();
          return isForm ? send(303, "text/plain", "", { location: "/" }) : send(200, "application/json", JSON.stringify({ ok: true }));
        }
        for (const r of routes) {
          if (r.m !== method) continue;
          const params = r.match(url.pathname);
          if (!params) continue;
          const out = (await r.h({ method, path: url.pathname, query: url.searchParams, body: body ?? {}, params }, state)) as
            | { status?: number; json?: unknown; html?: string; redirect?: string } | undefined;
          if (method !== "GET") save();
          const wrapped = out && typeof out === "object" && ("redirect" in out || "html" in out || "json" in out);
          if (wrapped && out.redirect) return send(303, "text/plain", "", { location: out.redirect });
          if (wrapped && out.html) return send(out.status ?? 200, "text/html", out.html);
          const status = wrapped ? out.status ?? 200 : 200;
          const json = wrapped ? out.json : out;
          // Form posts from the HTML page go back to the page.
          if (isForm && method === "POST") return send(303, "text/plain", "", { location: "/" });
          return send(status, "application/json", JSON.stringify(json ?? { ok: true }));
        }
        send(404, "application/json", JSON.stringify({ error: { code: 404, message: `No route ${method} ${url.pathname}` } }));
      } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        send(status, "application/json", JSON.stringify({ error: { code: status, message: (e as Error).message } }));
      }
    });
    await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(opts.port ?? def.defaultPort + Number(process.env.FAKE_PORT_OFFSET ?? 0), opts.host ?? "127.0.0.1", ok); });
    const port = (server.address() as { port: number }).port;
    return { port, url: `http://127.0.0.1:${port}`, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }) };
  }
  return { def, start };
}

export const uid = (prefix: string, n: number) => `${prefix}-${n}`;
export function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null) throw new HttpError(404, `${what} not found`);
  return v;
}
export function required(body: Record<string, unknown>, ...keys: string[]) {
  for (const k of keys) if (body[k] === undefined || body[k] === "") throw new HttpError(400, `Missing field: ${k}`);
}

/** Run a fake as a script: `tsx fakes/fake-x/server.ts`. */
export function runIfMain(meta: ImportMeta, fake: { def: { name: string; defaultPort: number }; start: (o?: { port?: number }) => Promise<RunningFake> }) {
  if (process.argv[1] && meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
    const port = Number(process.env[`${fake.def.name.toUpperCase().replace(/-/g, "_")}_PORT`] ?? fake.def.defaultPort);
    fake.start({ port }).then((r) => console.log(`${fake.def.name} listening on ${r.url}`));
  }
}
