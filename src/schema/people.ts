import { z } from "zod";
import { lowerEmail } from "./normalize";

/**
 * People rules shared by the People forms (client) and users.add / musicians.create / users.update / musicians.update (server).
 * One person = a Band Member (a non-archived musician record), Team access (a user membership with role admin|member), or both.
 * Issue paths are the form field names, so the UI can show each message under its field.
 */

/** Roles a person can be given in the UI/commands. Stored as-is: "member" is shown as "Standard". (The legacy "ai" role is not settable.) */
export const TeamRole = z.enum(["admin", "member"]);
export type TeamRole = z.infer<typeof TeamRole>;

export const PEOPLE_MESSAGES = {
  name: "Enter a name",
  kind: "Pick Band Member, Team, or both",
  instruments: "Add at least one instrument",
  email: "Email address invalid",
  role: "Pick a role",
  mcpAccess: "Only Admins can have AI access",
} as const;

/** "violin, vocals" -> ["violin", "vocals"]. Splits on commas and newlines, trims, drops empties and repeats (case-insensitive). */
export function parseInstruments(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const s = part.trim();
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}
/** Trim entries and drop empty ones. */
export const cleanInstruments = (xs: readonly string[]): string[] => xs.map((s) => s.trim()).filter(Boolean);

/** Instruments for a Band Member: trimmed, at least one. */
export const InstrumentList = z.array(z.string()).transform(cleanInstruments).pipe(z.array(z.string()).min(1, PEOPLE_MESSAGES.instruments));
/** An email that is trimmed and lowercased before it is checked. */
export const TeamEmail = z.string().transform(lowerEmail).pipe(z.string().email(PEOPLE_MESSAGES.email));
/** An optional musician email: blank means none. Trimmed and lowercased. */
export const OptionalEmail = z.string().transform(lowerEmail).pipe(z.union([z.literal(""), z.string().email(PEOPLE_MESSAGES.email)])).transform((s) => s || undefined);

/** The values the rules look at. `instruments` may be a list or the raw "violin, vocals" text. */
export interface PersonValues {
  name?: string;
  bandMember?: boolean;
  team?: boolean;
  instruments?: readonly string[] | string;
  email?: string;
  role?: string;
  mcpAccess?: boolean;
}
export type PersonIssue = { path: keyof typeof PEOPLE_MESSAGES; message: string };

/** All the rule violations for a person, in field order. Empty when valid. */
export function personIssues(v: PersonValues): PersonIssue[] {
  const out: PersonIssue[] = [];
  if (!(v.name ?? "").trim()) out.push({ path: "name", message: PEOPLE_MESSAGES.name });
  if (!v.bandMember && !v.team) out.push({ path: "kind", message: PEOPLE_MESSAGES.kind });
  if (v.bandMember) {
    const list = typeof v.instruments === "string" ? parseInstruments(v.instruments) : cleanInstruments(v.instruments ?? []);
    if (!list.length) out.push({ path: "instruments", message: PEOPLE_MESSAGES.instruments });
  }
  if (v.team) {
    if (!TeamEmail.safeParse(v.email ?? "").success) out.push({ path: "email", message: PEOPLE_MESSAGES.email });
    if (v.role !== "admin" && v.role !== "member") out.push({ path: "role", message: PEOPLE_MESSAGES.role });
  }
  if (v.mcpAccess && v.role !== "admin") out.push({ path: "mcpAccess", message: PEOPLE_MESSAGES.mcpAccess });
  return out;
}

/** Add this to a zod object with `.superRefine(addPersonIssues)` to report the person rules at the field paths. */
export function addPersonIssues(v: PersonValues, ctx: z.RefinementCtx) {
  for (const i of personIssues(v)) ctx.addIssue({ code: "custom", path: [i.path], message: i.message });
}

/**
 * The People form (Add person / edit). Parse the raw form values with it: `instruments` is the comma text, `email` is
 * only needed (and checked) for Team. Output is normalized: trimmed name, instruments list, lowercased email.
 */
export const PersonForm = z.object({
  name: z.string().trim(),
  bandMember: z.boolean(),
  team: z.boolean(),
  instruments: z.union([z.string(), z.array(z.string())]).default(""),
  email: z.string().default(""),
  role: z.string().default(""),
  mcpAccess: z.boolean().default(false),
}).superRefine(addPersonIssues).transform((v) => ({
  name: v.name,
  bandMember: v.bandMember,
  team: v.team,
  instruments: v.bandMember ? (typeof v.instruments === "string" ? parseInstruments(v.instruments) : cleanInstruments(v.instruments)) : [],
  email: lowerEmail(v.email),
  role: (v.team ? v.role : undefined) as TeamRole | undefined,
  mcpAccess: v.team && v.role === "admin" ? v.mcpAccess : false,
}));
export type PersonFormInput = z.input<typeof PersonForm>;
export type PersonFormValues = z.output<typeof PersonForm>;

/** A zod error (or an AppError/API error `issues` array) as { field: message }. The first message per field wins. Root path is "kind". */
export function fieldErrors(err: { issues?: readonly { path?: readonly PropertyKey[]; message: string }[] } | readonly { path?: readonly PropertyKey[] | string; message: string }[] | null | undefined): Record<string, string> {
  const issues = Array.isArray(err) ? err : (err as { issues?: readonly { path?: readonly PropertyKey[]; message: string }[] } | null | undefined)?.issues ?? [];
  const out: Record<string, string> = {};
  for (const i of issues as readonly { path?: readonly PropertyKey[] | string; message: string }[]) {
    const p = Array.isArray(i.path) ? i.path : typeof i.path === "string" && i.path ? i.path.split(".") : [];
    const key = p.length ? String(p[0] === "musician" && p[1] ? p[1] : p[0]) : "kind";
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

/** Validate form values and return { values } or { errors }. */
export function validatePerson(raw: PersonFormInput): { values: PersonFormValues; errors?: undefined } | { values?: undefined; errors: Record<string, string> } {
  const r = PersonForm.safeParse(raw);
  return r.success ? { values: r.data } : { errors: fieldErrors(r.error) };
}
