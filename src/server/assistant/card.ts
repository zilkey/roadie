/**
 * What a confirm card shows: one short row per field Roadie wants to write, never raw JSON. And picks: a value the
 * person has to choose from a list (a venue type that isn't on the band's list, a region the schema doesn't know) becomes
 * a dropdown on the card instead of a card that fails after Yes.
 */
import type { z } from "zod";
import { BUILTIN_VENUE_TYPES } from "@/schema";
import type { CardField } from "@/schema/assistant";
import { REGION_LABEL } from "@/components/booking/listRows";
import { fmtField } from "./policy";
import { makeCtx, runAs, type Session } from "./run";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Option { value: string; label: string }
/** A dropdown the person must answer before Yes runs: the input path it fills, the values it may take, and what Roadie had put there. */
export interface Pick { path: string; options: Option[]; was?: string }

export const getPath = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Row)[k] : undefined), o);
export function setPath<T>(o: T, path: string, v: unknown): T {
  const [k, ...rest] = path.split(".");
  const x = (o && typeof o === "object" ? o : {}) as Row;
  return { ...x, [k]: rest.length ? setPath(x[k], rest.join("."), v) : v } as T;
}

const sameWords = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A dropdown value that means "add this label to the venue type list first" (confirm.ts runs venueTypes.add, then the command with its key). */
export const NEW_TYPE = "new:";
export const newTypeValue = (label: string) => `${NEW_TYPE}${label}`;
export const newTypeLabel = (v: string) => (v.startsWith(NEW_TYPE) ? v.slice(NEW_TYPE.length) : undefined);
const humanize = (k: string) => { const w = k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); };

// ---------- lists the model can't see ----------

export async function venueTypes(s: Session): Promise<Option[]> {
  const rows = ((await runAs(makeCtx(s), "records.list", { kind: "venueTypes", limit: 200 })).result as { rows: Row[] }).rows;
  const list = rows.length ? rows.map((r) => ({ value: r.id as string, label: r.label as string })) : BUILTIN_VENUE_TYPES.map(([value, label]) => ({ value, label }));
  return list.sort((a, b) => a.label.localeCompare(b.label));
}
/** Fields whose values come from a list in the band's data, by command: the path in the input and how to read the list. */
const LISTS: Record<string, { path: string; options: (s: Session) => Promise<Option[]> }[]> = {
  "venues.create": [{ path: "type", options: venueTypes }],
  "venues.update": [{ path: "patch.type", options: venueTypes }],
};

/** Labels for enum values the schema knows. Anything else reads as its words ("venueProvided" -> "Venue provided"). */
const ENUM_LABEL: Record<string, Record<string, string>> = { region: REGION_LABEL, ages: { all: "All ages", 18: "18+", 21: "21+" } };
const enumOptions = (key: string, values: string[]): Option[] => values.map((v) => ({ value: v, label: ENUM_LABEL[key]?.[v] ?? humanize(v) }));

/**
 * The input with every value that needs the person's pick, and those picks. `issues` are the input's validation errors:
 * when every one is a top-level field (or patch field) set to something not on its enum, each becomes a pick (the input
 * holds the first option until the person chooses). Any other error returns null and goes back to the model as before.
 * `before` is the record an update starts from: a value it already has is never asked about.
 */
export async function picksFor(s: Session, name: string, input: unknown, issues: z.core.$ZodIssue[] = [], before?: Row): Promise<{ input: unknown; picks: Pick[]; labels: Record<string, Option[]> } | null> {
  let out = input;
  const picks: Pick[] = [];
  for (const i of issues) {
    const path = i.path.map(String);
    const top = path.length === 1 || (path.length === 2 && path[0] === "patch");
    if (i.code !== "invalid_value" || !top || !i.values.every((v) => typeof v === "string")) return null;
    const options = enumOptions(path[path.length - 1], i.values as string[]);
    const was = getPath(out, path.join("."));
    picks.push({ path: path.join("."), options, ...(typeof was === "string" ? { was } : {}) });
    out = setPath(out, path.join("."), options[0].value);
  }
  const labels: Record<string, Option[]> = {};
  for (const l of LISTS[name] ?? []) {
    const v = getPath(out, l.path);
    if (typeof v !== "string") continue;
    let options: Option[];
    try { options = await l.options(s); } catch { continue; }
    labels[l.path] = options;
    if (options.some((o) => o.value === v) || v === before?.[l.path.split(".").pop()!]) continue;
    // "Listening Room" for the key "listening": the label, in any case, is the value.
    const byLabel = options.find((o) => sameWords(o.label, v) || sameWords(o.value, v));
    if (byLabel) { out = setPath(out, l.path, byLabel.value); continue; }
    // Not on the list at all: the card's dropdown offers the list, plus adding what Roadie said as a new type.
    picks.push({ path: l.path, options: [...options, { value: newTypeValue(v), label: `Add "${v}" as a new type` }], was: v });
  }
  return { input: out, picks, labels };
}

// ---------- rows ----------

const SHORT: Record<string, string> = {
  name: "Name", type: "Type", address: "Address", region: "Region", capacity: "Capacity", ages: "Ages", sound: "Sound", website: "Website", instagram: "Instagram",
  timeZone: "Time zone", loadInNotes: "Load-in", notes: "Notes", emails: "Email", phones: "Phone", role: "Role", date: "Date", status: "Status", what: "What",
  amount: "Amount", category: "Category", sources: "Source", label: "Label", reason: "Reason", title: "Title", times: "Times", personnel: "Playing",
};
/** Id fields and the collection whose name stands in for the id. Other ids are left off the card: they mean nothing to a person. */
const ID_KINDS: Record<string, string> = {
  venueId: "venues", festivalId: "festivals", promoterId: "promoters", contactId: "contacts", showId: "shows", musicianId: "musicians",
  contactIds: "contacts", promoterIds: "promoters", venueIds: "venues", personnel: "musicians",
};
const ID_LABEL: Record<string, string> = { contactIds: "Contacts", promoterIds: "Promoters", venueIds: "Venues", personnel: "Playing" };
const MAX_VALUE = 200;

function text(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (k === "address" || k === "sound") return fmtField(k, v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return /^amount$|Cents$/.test(k) ? `$${(v / 100).toFixed(v % 100 ? 2 : 0)}` : String(v);
  if (typeof v === "string") return ENUM_LABEL[k]?.[v] ?? v;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? ((x as Row).url ?? (x as Row).label ?? (x as Row).name ?? text("", x)) : text(k, x))).filter(Boolean).join(", ");
  return Object.entries(v as Row).map(([k2, x]) => { const t = text(k2, x); return t && `${SHORT[k2] ?? humanize(k2)} ${t}`; }).filter(Boolean).join(", ");
}

/**
 * The card's rows for a command's input: the fields of `patch` for an update, the input itself otherwise. Ids read as the
 * record's name, list values (venue types) as their label, and a pick as a dropdown.
 */
export async function cardFields(name: string, input: unknown, picks: Pick[], labels: Record<string, Option[]>, nameOf: (kind: string, id: string) => Promise<string | undefined>): Promise<CardField[]> {
  const i = (input ?? {}) as Row;
  const [obj, prefix] = typeof i.id === "string" && i.patch && typeof i.patch === "object" ? [i.patch as Row, "patch."] : [i, ""];
  const rows: CardField[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === "id" || k === "matchKey") continue;
    const path = prefix + k;
    const pick = picks.find((p) => p.path === path);
    const label = ID_LABEL[k] ?? SHORT[k] ?? (ID_KINDS[k] ? humanize(k.replace(/Ids?$/, "")) : humanize(k));
    if (pick) { rows.push({ label, value: pick.was ?? "", path, options: pick.options }); continue; }
    let value: string;
    if (ID_KINDS[k]) {
      const ids = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string");
      value = (await Promise.all(ids.map(async (id) => (await nameOf(ID_KINDS[k], id).catch(() => undefined)) ?? "?"))).join(", ");
    } else if (/Ids?$/.test(k)) continue;
    else value = typeof v === "string" ? (labels[path]?.find((o) => o.value === v)?.label ?? text(k, v)) : text(k, v);
    if (value) rows.push({ label, value: value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value });
  }
  return rows;
}
