/**
 * The fake's tiny version of Gmail's search `q`: words and "quoted phrases" match the subject and body, `from:x` and `to:x`
 * match an address (to: also looks at cc), terms next to each other are AND, `OR` is the lower-precedence alternative and
 * parentheses group. A q with none of that is one plain substring, as before.
 */
export interface QueryTarget { from: string; to: string[]; cc: string[]; subject: string; body: string }
type Node = { t: "word"; v: string } | { t: "from" | "to"; v: string } | { t: "and" | "or"; l: Node; r: Node };

export function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /\(|\)|(?:(?:from|to):)?"[^"]*"|[^\s()]+/gi;
  for (const m of q.matchAll(re)) out.push(m[0]);
  return out;
}

export function parseQuery(q: string): Node | null {
  const toks = tokenize(q);
  let i = 0;
  // `field` is set inside `from:( … )` / `to:( … )`: the words in the group are addresses.
  function atom(field?: "from" | "to"): Node | null {
    const tok = toks[i];
    if (tok === undefined) return null;
    if (tok === "(") { i++; const n = orExpr(field); if (toks[i] === ")") i++; return n; }
    i++;
    const m = /^(from|to):(.*)$/i.exec(tok);
    const unq = (s: string) => s.replace(/^"|"$/g, "").toLowerCase();
    if (m && !m[2] && toks[i] === "(") return atom(m[1].toLowerCase() as "from" | "to");
    if (m) return { t: m[1].toLowerCase() as "from" | "to", v: unq(m[2]) };
    return field ? { t: field, v: unq(tok) } : { t: "word", v: unq(tok) };
  }
  function andExpr(field?: "from" | "to"): Node | null {
    let l = atom(field);
    while (i < toks.length && toks[i] !== ")" && toks[i].toUpperCase() !== "OR") {
      const r = atom(field);
      l = l && r ? { t: "and", l, r } : l ?? r;
    }
    return l;
  }
  function orExpr(field?: "from" | "to"): Node | null {
    let l = andExpr(field);
    while (i < toks.length && toks[i].toUpperCase() === "OR") {
      i++;
      const r = andExpr(field);
      l = l && r ? { t: "or", l, r } : l ?? r;
    }
    return l;
  }
  const n = orExpr();
  return n;
}

const SYNTAX = /(^|\s)(from:|to:|OR(\s|$))|[()"]/;

/** Does the message match the query? An empty query matches everything. */
export function matches(q: string | null | undefined, m: QueryTarget): boolean {
  if (!q?.trim()) return true;
  const text = `${m.subject} ${m.body}`.toLowerCase();
  if (!SYNTAX.test(q)) return text.includes(q.trim().toLowerCase());
  const node = parseQuery(q);
  if (!node) return true;
  const ev = (n: Node): boolean => {
    switch (n.t) {
      case "word": return text.includes(n.v);
      case "from": return m.from.toLowerCase().includes(n.v);
      case "to": return [...m.to, ...m.cc].some((a) => a.toLowerCase().includes(n.v));
      case "and": return ev(n.l) && ev(n.r);
      case "or": return ev(n.l) || ev(n.r);
    }
  };
  return ev(node);
}
