/**
 * Scan the committable files for private strings (real band emails and names, booking contacts) before a push.
 *   npm run leak-check
 *
 * Terms come from src/lib/band.ts (gitignored; every email and the `name` of each BAND_PEOPLE entry) and from the
 * top level of .booking-kit/*.json (contacts[].email / phone / name, plus any email-shaped string). Files come from
 * `git ls-files -co --exclude-standard`, so tracked and untracked-not-ignored files are checked; binaries and files
 * over 2MB are skipped. Exits 1 on any hit.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MIN_TERM = 5;
const MAX_BYTES = 2 * 1024 * 1024;

/** Emails that are fine to appear in the repo: the zilkey account and the reserved example domains. */
export function isAllowedEmail(email: string): boolean {
  const e = email.toLowerCase();
  return e.includes("zilkey") || e.endsWith("@example.com") || e.includes(".example");
}

/**
 * Pull the names, emails and Signal group link out of band.ts source text: all emails, any signal.group link, and the `name:` of each entry that has an `email:`.
 * A name is public, and left out, when its email is allowed (the repo owner, already public as the commit author) or
 * when the artist bills under it (`billingName: "<name> Duo"` makes the frontwoman's name the act's public name).
 */
export function termsFromBandSource(src: string): string[] {
  const terms: string[] = [...src.matchAll(EMAIL_RE)].map((m) => m[0]);
  // The band's Signal group link: anyone who has it can join the group.
  terms.push(...[...src.matchAll(/https:\/\/signal\.group\/#[A-Za-z0-9_-]+/g)].map((m) => m[0]));
  const billed = [...src.matchAll(/\bbillingName:\s*"([^"]*)"/g)].map((m) => m[1].toLowerCase());
  for (const line of src.split("\n")) {
    const email = line.match(/\bemail:\s*"([^"]*)"/)?.[1];
    const name = line.match(/\bname:\s*"([^"]*)"/)?.[1];
    if (!email || !name || isAllowedEmail(email)) continue;
    if (billed.some((b) => b === name.toLowerCase() || b.startsWith(`${name.toLowerCase()} `))) continue;
    terms.push(name);
  }
  return terms;
}

/** Walk a parsed .booking-kit JSON value: contact name/email/phone, plus any email-shaped string anywhere. */
export function termsFromBookingKit(json: unknown): string[] {
  const terms: string[] = [];
  const walk = (node: unknown, key?: string): void => {
    if (typeof node === "string") {
      terms.push(...(node.match(EMAIL_RE) ?? []));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        if (key === "contacts" && item && typeof item === "object") {
          const c = item as Record<string, unknown>;
          for (const k of ["email", "phone"]) {
            if (typeof c[k] === "string") terms.push(c[k] as string);
          }
          // A first name alone ("Angel") names no one and matches song titles; only a full name is a term.
          if (typeof c.name === "string" && /\S\s+\S/.test(c.name.trim())) terms.push(c.name);
        }
        walk(item);
      }
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  };
  walk(json);
  return terms;
}

/** Normalise, drop short and allow-listed terms, and de-duplicate case-insensitively. */
export function finishTerms(raw: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of raw.map((s) => s.trim())) {
    if (t.length < MIN_TERM) continue;
    const emails = t.match(EMAIL_RE);
    if (emails && emails.every(isAllowedEmail)) continue;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  }
  return [...seen.values()];
}

export type Hit = { file: string; term: string };

/** Generated files whose contents are third-party package metadata, not ours. */
const SKIP_FILES = new Set(["package-lock.json"]);

/**
 * Case-insensitive whole-word scan of each file's content for each term ("Ann" must not hit "Annual").
 * Returns one hit per file and term.
 */
export function scanContents(files: { path: string; content: string }[], terms: string[]): Hit[] {
  const hits: Hit[] = [];
  const res = terms.map((t) => [t, new RegExp(`(?<![\\w@.+-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "i")] as const);
  for (const f of files) {
    if (SKIP_FILES.has(f.path)) continue;
    for (const [term, re] of res) {
      if (re.test(f.content)) hits.push({ file: f.path, term });
    }
  }
  return hits;
}

function readIfPresent(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function gatherTerms(root: string): { terms: string[] } {
  const raw: string[] = [];

  const bandPath = path.join(root, "src/lib/band.ts");
  const band = readIfPresent(bandPath);
  if (band === undefined) console.warn(`leak-check: warning: ${bandPath} is missing; skipping band terms`);
  else raw.push(...termsFromBandSource(band));

  const kitDir = path.join(root, ".booking-kit");
  if (!fs.existsSync(kitDir)) {
    console.warn(`leak-check: warning: ${kitDir} is missing; skipping booking terms`);
  } else {
    for (const name of fs.readdirSync(kitDir).filter((n) => n.endsWith(".json")).sort()) {
      const text = readIfPresent(path.join(kitDir, name));
      if (text === undefined) continue;
      try {
        raw.push(...termsFromBookingKit(JSON.parse(text)));
      } catch {
        console.warn(`leak-check: warning: ${path.join(kitDir, name)} is not valid JSON; skipped`);
      }
    }
  }
  return { terms: finishTerms(raw) };
}

function listFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function readScannable(root: string, rel: string): string | undefined {
  const abs = path.join(root, rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return undefined;
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return undefined;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return undefined; // binary
  return buf.toString("utf8");
}

export function main(root = process.cwd()): number {
  const { terms } = gatherTerms(root);
  const files: { path: string; content: string }[] = [];
  for (const rel of listFiles(root)) {
    const content = readScannable(root, rel);
    if (content !== undefined) files.push({ path: rel, content });
  }
  const hits = scanContents(files, terms);
  for (const h of hits) console.log(`${h.file}: ${h.term}`);
  if (hits.length) return 1;
  console.log(`leak-check: clean (${terms.length} terms, ${files.length} files)`);
  return 0;
}

if (process.argv[1]?.endsWith("leak-check.ts")) process.exit(main());
