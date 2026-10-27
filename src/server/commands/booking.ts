import { z } from "zod";
import { defineCommand } from "./types";
import { patchInput, idInput } from "./util";
import { db, run, type Writer, type Doc } from "../db";
import { AppError } from "../errors";
import { gmailClient, IntegrationError } from "../integrations";
import type { MailMessage } from "../integrations/gmail";
import { unfilledFields, isActive, sortedDates } from "@/lib/booking";
import { archiveNote, artistIdOf, ensureNote, tryArtistId, hasPrivate, isPrivateField, noteOf, privateOf, refusePrivate, setContactRoles, sharedOf, writeNote } from "../venues";
import { CONTACT_ROLES } from "@/lib/venues";
import { createNoted, setVenuePromoters, updateNoted } from "../bandNotes";
import { ensureVenueTypes, requireVenueType } from "../venueTypes";
import { FESTIVAL_PAGE_SIZE, FESTIVAL_SORTS, festivalRows } from "@/lib/festivalPage";
import {
  VenueInput, VENUE_ROLE_FIELDS, venueNoteId, slug, PromoterInput, FestivalInput, EditionInput, ContactInput, EmailTemplateInput, pitchStatus, dateStr, email as emailSchema, lowerEmail, e164,
} from "@/schema";

const ROLES = ["admin", "mcp"] as const;
/** The shared venue directory is open to every signed-in band user, members too (the private notes are not: see venues.ts). */
const VENUE_ROLES = ["admin", "member", "mcp"] as const;
const arr = <T extends z.ZodType>(s: T) => s.default([] as never);

// ---------- places and people ----------

// The private fields stay optional (no default []): a member may not send them at all, and "not sent" must be told from "sent empty".
const VenueIn = VenueInput.extend({ contactIds: VenueInput.shape.contactIds.optional(), promoterIds: VenueInput.shape.promoterIds.optional() });
const PromoterIn = PromoterInput.extend({ contactIds: arr(PromoterInput.shape.contactIds), venueIds: arr(PromoterInput.shape.venueIds) });
const FestivalIn = FestivalInput.extend({ contactIds: arr(FestivalInput.shape.contactIds) });
const FestivalNew = FestivalIn.extend({ address: FestivalInput.shape.address.unwrap() });
const EditionIn = EditionInput.omit({ festivalName: true }).extend({ venueIds: arr(EditionInput.shape.venueIds) });
const lowerEmails = z.array(z.string().transform(lowerEmail).pipe(emailSchema));
const ContactIn = ContactInput.extend({ emails: lowerEmails.default([]), phones: z.array(z.string().transform(e164).pipe(ContactInput.shape.phones.element)).default([]) });
const parentKind = z.enum(["venues", "promoters", "festivals"]);

async function requireVenue(w: Writer, id: string) {
  const v = await w.get("venues", id);
  if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
  return v;
}

export const venuesCreate = defineCommand({
  name: "venues.create", roles: [...VENUE_ROLES], input: VenueIn,
  description:
    "Add a venue. type is a key from the venue type list (records.list venueTypes; add one with venueTypes.add). A venue with the same name and city merges into the existing one ({id, merged: true}); adding a room this band archived brings it back. Name, address, type, region, capacity, ages, sound, website, instagram and sources are the shared room: " +
    "every band that uses Roadie sees them. loadInNotes, notes, contactIds, promoterIds, bookingContactIds and dayOfContactIds are this band's private notes (admins only; a member who sends them gets a 403). " +
    "bookingContactIds / dayOfContactIds say which of contactIds handle booking and who to call on the day (contacts.setRoles sets one person's).",
  run: (ctx, input) => run(ctx, async (w) => {
    const priv = Object.fromEntries(Object.entries(input).filter(([k, v]) => isPrivateField(k) && v !== undefined));
    const shared = Object.fromEntries(Object.entries(input).filter(([k]) => !isPrivateField(k)));
    refusePrivate(ctx, Object.keys(priv));
    await requireVenueType(w, shared.type);
    const r = await w.create("venues", shared);
    if (ctx.role !== "member") {
      const wants = hasPrivate(privateOf(priv));
      const artistId = wants ? await artistIdOf(w) : await tryArtistId(w);
      if (artistId) {
        const venue = (await w.get("venues", r.id))!;
        const { doc, fields } = await noteOf(w, venue, artistId);
        if (wants) {
          // Adding a room that is already in the directory fills what the band has not said yet and links more; it never replaces.
          const next = await writeNote(w, venue, artistId, {
            ...(priv.loadInNotes && !fields.loadInNotes ? { loadInNotes: priv.loadInNotes } : {}), ...(priv.notes && !fields.notes ? { notes: priv.notes } : {}),
            contactIds: [...new Set([...fields.contactIds, ...((priv.contactIds as string[] | undefined) ?? [])])],
            promoterIds: [...new Set([...fields.promoterIds, ...((priv.promoterIds as string[] | undefined) ?? [])])],
            ...Object.fromEntries(VENUE_ROLE_FIELDS.map((k) => [k, [...new Set([...fields[k], ...((priv[k] as string[] | undefined) ?? [])])]])),
          });
          if (priv.promoterIds) await setVenuePromoters(w, artistId, r.id, next.promoterIds);
        } else if (doc?.deletedAt) await ensureNote(w, venue, artistId); // adding a room this band had archived brings it back
      }
    }
    return r;
  }),
});
export const venuesUpdate = defineCommand({
  name: "venues.update", roles: [...VENUE_ROLES], input: patchInput(VenueIn),
  description:
    "Edit a venue. address and sound are whole objects (city and state required; sound needs provider): Roadie fills missing keys from the record, other callers send the whole object. notes and loadInNotes replace the text (to add, read first and resend). contactIds/promoterIds replace the list (prefer contacts.attach/detach for contacts; contacts.setRoles for who handles booking or is the day-of contact). ages is all|18|21. Name, address, type, region, capacity, ages, sound, website, instagram and sources are the SHARED room: a change here changes it for every band that uses Roadie, " +
    "and your name goes in its history, so only change what you know is right. loadInNotes, notes, contactIds, promoterIds, bookingContactIds and dayOfContactIds are this band's private notes (admins only). Renaming updates its pitches and shows.",
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const sharedPatch = Object.fromEntries(Object.entries(patch).filter(([k, v]) => !isPrivateField(k) && v !== undefined));
    const privPatch = Object.fromEntries(Object.entries(patch).filter(([k, v]) => isPrivateField(k) && v !== undefined));
    refusePrivate(ctx, Object.keys(privPatch));
    const venue = await requireVenue(w, id);
    await requireVenueType(w, sharedPatch.type, venue.type);
    let changed = false;
    if (Object.keys(sharedPatch).length) changed = (await w.update("venues", id, sharedPatch)).changed;
    if (Object.keys(privPatch).length) {
      const artistId = await artistIdOf(w);
      // The autosave form sends the notes' rev: conflict checks follow the notes doc, not the shared one.
      if (ctx.baseRev?.id === id && !Object.keys(sharedPatch).length) ctx.baseRev = { id: venueNoteId(artistId, id), rev: ctx.baseRev.rev };
      await writeNote(w, venue, artistId, privPatch);
      if (privPatch.promoterIds) await setVenuePromoters(w, artistId, id, privPatch.promoterIds as string[]);
      changed = true;
    }
    return { id, changed };
  }),
});
export const venuesRemove = defineCommand({
  name: "venues.remove", roles: ["admin"], input: idInput,
  description: "Archive a venue for this band: it leaves this band's lists. The shared room stays for every other band (to fix a duplicate use venues.mergeInto).",
  run: (ctx, { id }) => run(ctx, async (w) => {
    const venue = await requireVenue(w, id);
    await archiveNote(w, venue, await artistIdOf(w));
    return { id, changed: true };
  }),
});

/** Merge two text notes: both kept, the incoming one after, nothing doubled. */
const joinText = (a?: string, b?: string) => (!a ? b : !b || a.includes(b) ? a : `${a}\n\n${b}`);

export const venuesMergeInto = defineCommand({
  name: "venues.mergeInto", roles: ["admin", "mcp"], input: z.strictObject({ from: z.string().min(1), into: z.string().min(1) }),
  description:
    "Merge a duplicate venue (from) into the one to keep (into), for EVERY band: their shows, pitches, promoter and festival-year links move to `into`, each band's private notes are joined onto its notes for `into`, " +
    "empty shared fields on `into` are filled from `from`, and `from` is archived with a pointer to `into` (its page redirects). One run: history.undoRun reverses it. Never returns another band's private notes.",
  run: (ctx, { from, into }) => run(ctx, async (w) => {
    if (from === into) throw new AppError("invalid_input", "Pick a different venue to merge into", 400);
    const src = await requireVenue(w, from), dst = await requireVenue(w, into);
    const copy = { id: dst.id, name: dst.name as string, address: [dst.address?.street, dst.address?.city].filter(Boolean).join(", "), city: dst.address?.city as string | undefined };
    const moved = { shows: 0, pitches: 0, promoters: 0, editions: 0, notes: 0 };

    for (const s of await w.query("shows", (q) => q.where("venue.id", "==", from))) { await w.update("shows", s.id, { venue: copy }); moved.shows++; }
    for (const p of await w.query("pitches", (q) => q.where("target.id", "==", from))) {
      if (p.target?.kind === "venue") { await w.update("pitches", p.id, { target: { ...p.target, id: into, name: dst.name } }); moved.pitches++; }
    }
    // promoterNotes: each band's promoter links; promoters: a not-yet-migrated promoter's links (migrate:band-notes moves them).
    for (const [coll, key] of [["promoterNotes", "promoters"], ["promoters", "promoters"], ["editions", "editions"]] as const) {
      for (const d of await w.query(coll, (q) => q.where("venueIds", "array-contains", from))) {
        const ids = [...new Set((d.venueIds as string[]).map((x) => (x === from ? into : x)))];
        await w.update(coll, d.id, { venueIds: ids });
        moved[key]++;
      }
    }

    // Each band's notes move across; where a band already has notes on `into` they are joined. Another band's content is written, never returned.
    const notes = await w.query("venueNotes", (q) => q.where("venueId", "==", from), { includeDeleted: true });
    const artists = new Set(notes.map((n) => n.artistId as string));
    if (ctx.artistId) artists.add(ctx.artistId); // a not-yet-migrated venue keeps its private fields on the doc: they belong to the caller's band
    for (const artistId of artists) {
      const mine = await noteOf(w, src, artistId), theirs = await noteOf(w, dst, artistId);
      if (!mine.doc && !hasPrivate(mine.fields)) continue;
      const a = theirs.fields, b = mine.fields;
      const joined = {
        loadInNotes: joinText(a.loadInNotes, b.loadInNotes) ?? null, notes: joinText(a.notes, b.notes) ?? null,
        contactIds: [...new Set([...a.contactIds, ...b.contactIds])], promoterIds: [...new Set([...a.promoterIds, ...b.promoterIds])],
        bookingContactIds: [...new Set([...a.bookingContactIds, ...b.bookingContactIds])], dayOfContactIds: [...new Set([...a.dayOfContactIds, ...b.dayOfContactIds])],
      };
      const archived = !!mine.doc?.deletedAt && !!theirs.doc?.deletedAt; // the room stays hidden for a band only if it hid both
      if (mine.doc?.deletedAt && !hasPrivate(mine.fields) && !theirs.doc) continue; // nothing to carry over
      await writeNote(w, dst, artistId, joined);
      if (archived) await w.softDelete("venueNotes", venueNoteId(artistId, into));
      if (mine.doc && !mine.doc.deletedAt) await w.softDelete("venueNotes", venueNoteId(artistId, from));
      moved.notes++;
    }

    const fill = sharedOf(src);
    if (Object.keys(fill).length) await w.merge("venues", into, fill);
    await w.update("venues", from, { mergedInto: into });
    await w.softDelete("venues", from);
    return { id: into, merged: from, moved };
  }),
});

// ---------- venue types ----------

/** The one list of venue types (src/schema/venueTypes.ts). A venue's type is the key; the label is what everyone sees. */
export const venueTypesAdd = defineCommand({
  name: "venueTypes.add", roles: [...VENUE_ROLES], input: z.strictObject({ label: z.string().trim().min(1) }),
  description: "Add a venue type (\"Winery\") to the list every band picks from, and return its key ({id}) to set as a venue's type. One that is already there (any case) is returned as it is ({existing: true}).",
  run: (ctx, { label }) => run(ctx, async (w) => {
    await ensureVenueTypes(w);
    const key = slug(label);
    if (!key) throw new AppError("invalid_input", "Type a name with a letter or number in it", 400);
    const same = (await w.query("venueTypes", (q) => q.where("matchKey", "==", key).limit(1)))[0] ?? (await w.get("venueTypes", key));
    if (same && !same.deletedAt) return { id: same.id, existing: true };
    if (same) { await w.restore("venueTypes", same.id); await w.update("venueTypes", same.id, { label }); return { id: same.id }; }
    return w.create("venueTypes", { label }, { id: key });
  }),
});
export const venueTypesRename = defineCommand({
  name: "venueTypes.rename", roles: ["admin"], input: z.strictObject({ id: z.string().min(1), label: z.string().trim().min(1) }),
  description: "Rename a venue type for every band. Its venues keep it (they hold the key, not the name).",
  run: (ctx, { id, label }) => run(ctx, async (w) => {
    await ensureVenueTypes(w);
    const t = await w.get("venueTypes", id);
    if (!t || t.deletedAt) throw new AppError("not_found", "Venue type not found", 404);
    const clash = (await w.query("venueTypes", (q) => q.where("matchKey", "==", slug(label)).limit(2))).find((x) => x.id !== id);
    if (clash) throw new AppError("conflict", `There is already a type called ${clash.label}`, 409);
    return w.update("venueTypes", id, { label });
  }),
});
export const venueTypesRemove = defineCommand({
  name: "venueTypes.remove", roles: ["admin"], input: idInput,
  description: "Take a venue type off the list for every band. Refused while any venue still has it: change those venues first.",
  run: (ctx, { id }) => run(ctx, async (w) => {
    await ensureVenueTypes(w);
    const used = await w.query("venues", (q) => q.where("type", "==", id));
    if (used.length) throw new AppError("conflict", `${used.length} ${used.length === 1 ? "venue has" : "venues have"} this type. Change ${used.length === 1 ? "it" : "them"} first.`, 409);
    return w.softDelete("venueTypes", id);
  }),
});

export const promotersCreate = defineCommand({
  name: "promoters.create", roles: [...ROLES], input: PromoterIn,
  description: "Add a promoter or booking group. Same name merges into the existing one. kind: promoter|venueGroup|nonprofit|buyer. venueIds/contactIds are the whole lists; link contacts with contacts.attach. " +
    "notes and howToPitch are this band's private notes (other bands never see them); everything else is shared with every band.",
  run: (ctx, input) => run(ctx, (w) => createNoted(w, "promoters", input)),
});
export const promotersUpdate = defineCommand({
  name: "promoters.update", roles: [...ROLES], input: patchInput(PromoterIn),
  description: "Edit a promoter. kind: promoter|venueGroup|nonprofit|buyer. venueIds/contactIds replace the lists; link contacts with contacts.attach. " +
    "notes and howToPitch are this band's private notes (they replace the text: read first to add); everything else is shared with every band.",
  run: (ctx, { id, patch }) => run(ctx, (w) => updateNoted(ctx, w, "promoters", id, patch as Record<string, unknown>)),
});
export const promotersRemove = defineCommand({
  name: "promoters.remove", roles: ["admin"], input: idInput, description: "Archive a promoter.",
  run: (ctx, { id }) => db.softDelete(ctx, "promoters", id),
});

export const festivalsCreate = defineCommand({
  name: "festivals.create", roles: [...ROLES], input: FestivalNew,
  description: "Add a festival or series. address is {city, state}: the one town it happens in (a series in several towns: its main one). Same name merges into the existing one. notes is this band's private notes (other bands never see them); everything else is shared with every band.",
  run: (ctx, input) => run(ctx, (w) => createNoted(w, "festivals", input)),
});
export const festivalsUpdate = defineCommand({
  name: "festivals.update", roles: [...ROLES], input: patchInput(FestivalIn),
  description: "Edit a festival. type: festival|series. contactIds replaces the list; link contacts with contacts.attach. Renaming updates its editions and their pitches. " +
    "address is {city, state}: the one town it happens in (a series in several towns: its main one). " +
    "notes is this band's private notes (replaces the text: read first to add); everything else is shared with every band.",
  // A festival given its town loses the old region it may still carry (until the festival-where migration has run).
  run: (ctx, { id, patch }) => run(ctx, (w) => updateNoted(ctx, w, "festivals", id, { ...patch, ...(patch.address ? { region: null } : {}) } as Record<string, unknown>)),
});
export const festivalsPage = defineCommand({
  name: "festivals.page", roles: [...ROLES],
  description:
    "One page of the Festivals tab, in order: rows are {kind: edition|festival, id}, one per edition (a festival with no edition is one festival row). " +
    `q matches a festival's name or its contacts, like the booking search. sort: ${FESTIVAL_SORTS.join("|")} (deadline = application deadline, date = edition start, "-" = latest first; ` +
    `rows without one go last). offset/limit page through it (limit default ${FESTIVAL_PAGE_SIZE}); total is every match, nextOffset null on the last page.`,
  input: z.strictObject({
    q: z.string().default(""), sort: z.enum(FESTIVAL_SORTS).default("name"),
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(500).default(FESTIVAL_PAGE_SIZE),
  }),
  async run(_ctx, i) {
    const [festivals, editions, contacts] = await Promise.all([db.list("festivals"), db.list("editions"), db.list("contacts")]);
    const all = festivalRows({ festivals, editions, contacts } as unknown as Parameters<typeof festivalRows>[0], i.q, i.sort);
    const end = i.offset + i.limit;
    return { total: all.length, rows: all.slice(i.offset, end), nextOffset: end < all.length ? end : null };
  },
});
export const festivalsRemove = defineCommand({
  name: "festivals.remove", roles: ["admin"], input: idInput, description: "Archive a festival and its editions.",
  run: (ctx, { id }) => run(ctx, async (w) => {
    for (const e of await w.query("editions", (q) => q.where("festivalId", "==", id))) await w.softDelete("editions", e.id);
    return w.softDelete("festivals", id);
  }),
});

export const editionsCreate = defineCommand({
  name: "editions.create", roles: [...ROLES], input: EditionIn.extend({ festivalId: z.string().min(1) }),
  description: "Add a dated year of a festival (applications, deadline, dates). notes and payNotes are this band's private notes (other bands never see them); everything else is shared with every band.",
  run: (ctx, input) => run(ctx, async (w) => {
    const f = await w.get("festivals", input.festivalId);
    if (!f || f.deletedAt) throw new AppError("not_found", "Festival not found", 404);
    return createNoted(w, "editions", { ...input, festivalName: f.name });
  }),
});
export const editionsUpdate = defineCommand({
  name: "editions.update", roles: [...ROLES], input: patchInput(EditionIn.omit({ festivalId: true })),
  description: "Edit an edition. Changing the label updates its pitches. notes and payNotes are this band's private notes (they replace the text: read first to add); everything else is shared with every band.",
  run: (ctx, { id, patch }) => run(ctx, (w) => updateNoted(ctx, w, "editions", id, patch as Record<string, unknown>)),
});
export const editionsRemove = defineCommand({
  name: "editions.remove", roles: ["admin"], input: idInput, description: "Archive an edition.",
  run: (ctx, { id }) => db.softDelete(ctx, "editions", id),
});

export const contactsCreate = defineCommand({
  name: "contacts.create", roles: [...ROLES], input: ContactIn.extend({ attachTo: z.strictObject({ kind: parentKind, id: z.string().min(1) }).optional() }),
  description: "Add a person. Same email (or name when no email) merges into the existing contact. attachTo links them to a venue, promoter or festival. notes is this band's private notes (other bands never see them).",
  run: (ctx, { attachTo, ...input }) => run(ctx, async (w) => {
    const r = await createNoted(w, "contacts", input);
    if (attachTo) await attach(w, attachTo.kind, attachTo.id, r.id);
    return r;
  }),
});
export const contactsUpdate = defineCommand({
  name: "contacts.update", roles: [...ROLES], input: patchInput(ContactIn),
  description: "Edit a contact. emails/phones replace the lists (first email is primary; emails lowercased, phones stored E.164): read first. Use contacts.attach/detach for links. notes is this band's private notes (replaces the text: read first to add).",
  run: (ctx, { id, patch }) => run(ctx, (w) => updateNoted(ctx, w, "contacts", id, patch as Record<string, unknown>)),
});
export const contactsRemove = defineCommand({
  name: "contacts.remove", roles: ["admin"], input: idInput, description: "Archive a contact and unlink them from places.",
  run: (ctx, { id }) => run(ctx, async (w) => {
    for (const kind of parentKind.options) {
      if (kind === "venues") {
        // Archiving a contact unlinks them from every band's notes (contacts are shared, admin-only records), and from venues not yet migrated.
        // An archived note (a room the band hid, or a merged duplicate) can't be written; the dead id there is skipped wherever contacts are read.
        for (const n of await w.query("venueNotes", (q) => q.where("contactIds", "array-contains", id))) {
          const drop = (k: string) => (n[k] as string[] | undefined)?.includes(id) ? { [k]: (n[k] as string[]).filter((x) => x !== id) } : {};
          await w.update("venueNotes", n.id, { contactIds: (n.contactIds as string[]).filter((x) => x !== id), ...drop("bookingContactIds"), ...drop("dayOfContactIds") });
        }
        for (const v of await w.query("venues", (q) => q.where("contactIds", "array-contains", id))) {
          await w.update("venues", v.id, { contactIds: (v.contactIds as string[]).filter((x) => x !== id) });
        }
        continue;
      }
      for (const p of await w.query(kind, (q) => q.where("contactIds", "array-contains", id))) await detach(w, kind, p.id, id);
    }
    return w.softDelete("contacts", id);
  }),
});

/** A venue's contact links are the band's private notes; promoters' and festivals' stay on the record. */
async function attach(w: Writer, kind: string, parentId: string, contactId: string) {
  const p = await w.get(kind, parentId);
  if (!p || p.deletedAt) throw new AppError("not_found", "Place not found", 404);
  if (kind === "venues") {
    const artistId = await artistIdOf(w);
    const { fields } = await noteOf(w, p, artistId);
    if (!fields.contactIds.includes(contactId)) await writeNote(w, p, artistId, { contactIds: [...fields.contactIds, contactId] });
    return;
  }
  const ids = (p.contactIds ?? []) as string[];
  if (!ids.includes(contactId)) await w.update(kind, parentId, { contactIds: [...ids, contactId] });
}
async function detach(w: Writer, kind: string, parentId: string, contactId: string) {
  const p = await w.get(kind, parentId);
  if (!p || p.deletedAt) return;
  if (kind === "venues") {
    const artistId = await artistIdOf(w);
    const { fields } = await noteOf(w, p, artistId);
    if (fields.contactIds.includes(contactId)) await writeNote(w, p, artistId, { contactIds: fields.contactIds.filter((x) => x !== contactId) });
    return;
  }
  await w.update(kind, parentId, { contactIds: ((p.contactIds ?? []) as string[]).filter((x) => x !== contactId) });
}
const linkInput = z.strictObject({ contactId: z.string().min(1), kind: parentKind, id: z.string().min(1) });
export const contactsAttach = defineCommand({
  name: "contacts.attach", roles: [...ROLES], input: linkInput, description: "Link an existing contact to a venue, promoter or festival.",
  run: (ctx, i) => run(ctx, async (w) => { await attach(w, i.kind, i.id, i.contactId); return { id: i.contactId }; }),
});
export const contactsDetach = defineCommand({
  name: "contacts.detach", roles: [...ROLES], input: linkInput, description: "Unlink a contact from a venue, promoter or festival (a venue contact's roles go with it).",
  run: (ctx, i) => run(ctx, async (w) => { await detach(w, i.kind, i.id, i.contactId); return { id: i.contactId }; }),
});
export const contactsSetRoles = defineCommand({
  name: "contacts.setRoles", roles: [...ROLES],
  input: z.strictObject({ contactId: z.string().min(1), venueId: z.string().min(1), roles: z.array(z.enum(CONTACT_ROLES)) }),
  description:
    "Say what a contact does for this band at a venue: roles is their whole set, booking (who you pitch and book with) and/or dayOf (who to call on the day of a show); [] clears both. " +
    "Links them to the venue first if they aren't. Several people can share a role. A new show at the venue takes its first dayOf contact as the show's day-of contact; pitch emails go to booking contacts first.",
  run: (ctx, i) => run(ctx, async (w) => {
    const venue = await requireVenue(w, i.venueId);
    if (!(await w.get("contacts", i.contactId))) throw new AppError("not_found", "Contact not found", 404);
    await setContactRoles(w, venue, await artistIdOf(w), i.contactId, i.roles);
    return { id: i.contactId };
  }),
});

// ---------- pitches ----------

const target = z.strictObject({ kind: z.enum(["venue", "promoter", "edition"]), id: z.string().min(1) });
const nextStep = z.strictObject({ text: z.string().min(1), due: dateStr });
const pitchDates = z.array(dateStr);
const COLL = { venue: "venues", promoter: "promoters", edition: "editions" } as const;

async function targetName(w: Writer, kind: keyof typeof COLL, id: string) {
  const t = await w.get(COLL[kind], id);
  if (!t || t.deletedAt) throw new AppError("not_found", `${kind} not found`, 404);
  return kind === "edition" ? `${t.festivalName} ${t.label}` : (t.name as string);
}
/** The artist this call is for (ctx.artistId), or the one artist there is when the caller didn't say. */
async function artistOf(w: Writer) {
  const a = w.ctx.artistId ? await w.get("artists", w.ctx.artistId) : (await w.query("artists", (q) => q.limit(1)))[0];
  if (!a || a.deletedAt) throw new AppError("not_found", "Set up the artist first", 404);
  return a;
}
function personnelFor(artist: Doc, configId: string | null | undefined): string[] | undefined {
  if (!configId) return undefined;
  const c = (artist.configurations as { id: string; musicianIds: string[] }[]).find((x) => x.id === configId);
  if (!c) throw new AppError("invalid_input", `No configuration "${configId}"`, 400);
  return c.musicianIds;
}
async function requirePitch(w: Writer, id: string) {
  const p = await w.get("pitches", id);
  if (!p || p.deletedAt) throw new AppError("not_found", "Pitch not found", 404);
  return p;
}
async function requireUser(w: Writer, uid: string) {
  const u = await w.get("users", uid);
  if (!u || u.deletedAt) throw new AppError("not_found", "Assignee must be a signed-in person", 404);
}

export const pitchesFlag = defineCommand({
  name: "pitches.flag", roles: [...ROLES], description: "Add a venue, promoter or edition to the Pitch List. If it is already there, returns that pitch ({existing: true}). " +
    "dates: possible dates for the gig [YYYY-MM-DD, ...], any number; they are stored sorted and unique. pitchedAs is a configuration id (context.now artist.configurations or records.get artists); assigneeId a user id (context.now band[].userId).",
  input: target.extend({
    pitchedAs: z.string().optional(), personnel: z.array(z.string()).optional(), assigneeId: z.string().optional(),
    nextStep: nextStep.optional(), notes: z.string().optional(), dates: pitchDates.optional(),
  }),
  run: (ctx, i) => run(ctx, async (w) => {
    const artist = await artistOf(w);
    // Another band's pitch on the same target is theirs: only this band's own active pitch counts as "already there".
    const open = (await w.query("pitches", (q) => q.where("target.id", "==", i.id))).find((p) => p.artistId === artist.id && p.target.kind === i.kind && isActive(p.status));
    if (open) return { id: open.id, existing: true };
    const name = await targetName(w, i.kind, i.id);
    const assigneeId = i.assigneeId ?? ctx.uid;
    await requireUser(w, assigneeId);
    const r = await w.create("pitches", {
      target: { kind: i.kind, id: i.id, name }, status: "toPitch", artistId: artist.id,
      pitchedAs: i.pitchedAs, personnel: i.personnel ?? personnelFor(artist, i.pitchedAs) ?? [], assigneeId,
      nextStep: i.nextStep, notes: i.notes, dates: sortedDates(i.dates), showIds: [],
    });
    await w.create(`pitches/${r.id}/activity`, { type: "status", toStatus: "toPitch", text: "Added to Pitch List" });
    if (i.kind === "venue") await ensureNote(w, (await w.get("venues", i.id))!, artist.id); // the band now cares about this room
    return { id: r.id, existing: false };
  }),
});

const pitchPatch = z.strictObject({
  pitchedAs: z.string().nullable().optional(), personnel: z.array(z.string()).optional(), assigneeId: z.string().nullable().optional(),
  nextStep: nextStep.nullable().optional(), notes: z.string().nullable().optional(), dates: pitchDates.optional(),
});
export const pitchesUpdate = defineCommand({
  name: "pitches.update", roles: [...ROLES], description: "Edit a pitch: pitchedAs (configuration id from context.now artist.configurations or records.get artists; null for not sure; fills personnel unless given), personnel, assigneeId (user id, context.now band[].userId), nextStep {text, due} (the follow-up date), notes, dates (the whole list of possible dates [YYYY-MM-DD, ...]; replaces the old list, stored sorted; [] clears).",
  input: z.strictObject({ id: z.string().min(1), patch: pitchPatch }),
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    await requirePitch(w, id);
    const p: Record<string, unknown> = { ...patch };
    if (patch.pitchedAs && !patch.personnel) p.personnel = personnelFor(await artistOf(w), patch.pitchedAs);
    if (patch.assigneeId) await requireUser(w, patch.assigneeId);
    if (patch.dates) p.dates = sortedDates(patch.dates);
    return w.update("pitches", id, p);
  }),
});

export const pitchesMove = defineCommand({
  name: "pitches.move", roles: [...ROLES], description: "Move a pitch to another status and log it on the timeline. Statuses: idea = Future Pitch, a place we might pitch later; toPitch = To Pitch, on the list, not sent; pitched = we sent it, waiting to hear back; talking; booked; declined = they said no; dropped = we stopped. " +
    "Moving to pitched/talking records contact now (how \"I pitched X today\" is logged). booked alone creates no show: use shows.create with pitchId (\"Booked it\").",
  input: z.strictObject({ id: z.string().min(1), status: pitchStatus, text: z.string().optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const p = await requirePitch(w, i.id);
    if (p.status === i.status) return { id: i.id, changed: false };
    await w.update("pitches", i.id, { status: i.status, ...(["pitched", "talking"].includes(i.status) ? { lastContactAt: w.now } : {}) });
    await w.create(`pitches/${i.id}/activity`, { type: "status", fromStatus: p.status, toStatus: i.status, text: i.text });
    return { id: i.id, changed: true };
  }),
});

export const pitchesComment = defineCommand({
  name: "pitches.comment", roles: ["admin", "mcp"], description: "Post to the discussion thread on a pitch (the team talking). For a call, email, visit or note on the timeline use pitches.log.",
  input: z.strictObject({ id: z.string().min(1), body: z.string().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => { await requirePitch(w, i.id); return w.create(`pitches/${i.id}/comments`, { authorId: ctx.uid, body: i.body }); }),
});
export const pitchesLog = defineCommand({
  name: "pitches.log", roles: [...ROLES], description: "Timeline entry on a pitch: a call, email or visit (sets last contact) or a note. The discussion thread is pitches.comment.",
  input: z.strictObject({ id: z.string().min(1), type: z.enum(["call", "email", "visit", "note"]), text: z.string().min(1) }),
  run: (ctx, i) => run(ctx, async (w) => {
    await requirePitch(w, i.id);
    const r = await w.create(`pitches/${i.id}/activity`, { type: i.type, text: i.text });
    if (i.type !== "note") await w.update("pitches", i.id, { lastContactAt: w.now });
    return r;
  }),
});
export const pitchesRemove = defineCommand({
  name: "pitches.remove", roles: ["admin"], input: idInput, description: "Take a pitch off the Pitch List (archive).",
  run: (ctx, { id }) => db.softDelete(ctx, "pitches", id),
});

// ---------- email ----------

export const templatesCreate = defineCommand({
  name: "emailTemplates.create", roles: ["admin", "mcp"], input: EmailTemplateInput.extend({ targetKinds: arr(EmailTemplateInput.shape.targetKinds) }),
  description: "Add an email template. Use {{venue.name}}, {{contact.firstName}}, {{user.name}}, {{artist.name}} etc.",
  run: (ctx, input) => db.create(ctx, "emailTemplates", input),
});
export const templatesUpdate = defineCommand({
  name: "emailTemplates.update", roles: ["admin", "mcp"], input: patchInput(EmailTemplateInput), description: "Edit an email template.",
  run: (ctx, { id, patch }) => db.update(ctx, "emailTemplates", id, patch as Record<string, unknown>),
});
export const templatesRemove = defineCommand({
  name: "emailTemplates.remove", roles: ["admin"], input: idInput, description: "Delete an email template.",
  run: (ctx, { id }) => db.softDelete(ctx, "emailTemplates", id),
});

const gmailFail = (e: unknown): never => {
  if (e instanceof IntegrationError) throw new AppError("gmail_error", `Gmail: ${e.message}`, 502);
  throw e;
};

export const pitchesSendEmail = defineCommand({
  name: "pitches.sendEmail", roles: ["admin"],
  description: "Send an already filled-in email from the caller's Gmail, log emailSent on the pitch timeline and set lastContactAt. Refuses text that still has {{fields}}.",
  input: z.strictObject({
    id: z.string().min(1), to: z.array(emailSchema).min(1), cc: z.array(emailSchema).optional(),
    subject: z.string().min(1), body: z.string().min(1), threadId: z.string().optional(), markPitched: z.boolean().default(false),
  }),
  async run(ctx, i) {
    const missing = unfilledFields(`${i.subject}\n${i.body}`);
    if (missing.length) throw new AppError("unfilled_fields", `Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before sending`, 400);
    const pitch = await db.get("pitches", i.id);
    if (!pitch || pitch.deletedAt) throw new AppError("not_found", "Pitch not found", 404);
    const user = await db.get("users", ctx.uid);
    if (!user) throw new AppError("forbidden", "No user for this account", 403);
    const msg = await gmailClient().send({ account: user.email, to: i.to, cc: i.cc, subject: i.subject, body: i.body, threadId: i.threadId }).catch(gmailFail);
    return run(ctx, async (w) => {
      const p = await requirePitch(w, i.id);
      const act = await w.create(`pitches/${i.id}/activity`, {
        type: "emailSent", text: i.body, gmail: { messageId: msg.id, threadId: msg.threadId, to: i.to.join(", "), subject: i.subject, account: user.email as string },
      });
      await w.update("pitches", i.id, { lastContactAt: w.now });
      if (i.markPitched && (p.status === "idea" || p.status === "toPitch")) {
        await w.update("pitches", i.id, { status: "pitched" });
        await w.create(`pitches/${i.id}/activity`, { type: "status", fromStatus: p.status, toStatus: "pitched" });
      }
      return { id: act.id, messageId: msg.id, threadId: msg.threadId };
    });
  },
});

export const pitchesDraftEmail = defineCommand({
  name: "pitches.draftEmail", roles: ["admin", "mcp"],
  description:
    "Write an email as a DRAFT in the caller's Gmail (never sends) and note it on the pitch timeline. A person reviews and sends it from the app. " +
    "Refuses text that still has {{fields}}.",
  input: z.strictObject({
    id: z.string().min(1), to: z.array(emailSchema).min(1), cc: z.array(emailSchema).optional(),
    subject: z.string().min(1), body: z.string().min(1), threadId: z.string().optional(),
  }),
  async run(ctx, i) {
    const missing = unfilledFields(`${i.subject}\n${i.body}`);
    if (missing.length) throw new AppError("unfilled_fields", `Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before drafting`, 400);
    const pitch = await db.get("pitches", i.id);
    if (!pitch || pitch.deletedAt) throw new AppError("not_found", "Pitch not found", 404);
    const user = await db.get("users", ctx.uid);
    if (!user) throw new AppError("forbidden", "No user for this account", 403);
    const draft = await gmailClient().createDraft({ account: user.email, to: i.to, cc: i.cc, subject: i.subject, body: i.body, threadId: i.threadId }).catch(gmailFail);
    const act = await db.create(ctx, `pitches/${i.id}/activity`, {
      type: "note", text: `Email drafted (not sent) to ${i.to.join(", ")}: ${i.subject}\n\n${i.body}`,
    });
    return { id: act.id, draftId: draft.id, sent: false };
  },
});

export const pitchesCheckReplies = defineCommand({
  name: "pitches.checkReplies", roles: ["admin"],
  description: "Look in the Gmail threads of this pitch's sent emails and add new replies to the timeline as emailReply.",
  input: idInput,
  async run(ctx, { id }) {
    const pitch = await db.get("pitches", id);
    if (!pitch || pitch.deletedAt) throw new AppError("not_found", "Pitch not found", 404);
    const [acts, user] = await Promise.all([db.list(`pitches/${id}/activity`), db.get("users", ctx.uid)]);
    // Each thread is read from the mailbox it was sent from; entries from before that was recorded use the caller's.
    const threads = new Map<string, string>();
    for (const a of acts) if (a.gmail?.threadId && !threads.has(a.gmail.threadId)) threads.set(a.gmail.threadId, (a.gmail.account as string | undefined) ?? (user?.email as string));
    const seen = new Set(acts.filter((a) => a.gmail?.messageId).map((a) => a.gmail.messageId as string));
    const fresh: MailMessage[] = [];
    for (const [t, account] of threads) {
      const th = await gmailClient().getThread(t, account).catch(gmailFail);
      fresh.push(...th.messages.filter((m) => m.direction === "received" && !seen.has(m.id)));
    }
    if (!fresh.length) return { added: 0 };
    fresh.sort((a, b) => a.date.localeCompare(b.date));
    await run(ctx, async (w) => {
      for (const m of fresh) {
        await w.create(`pitches/${id}/activity`, {
          type: "emailReply", text: `From ${m.from}\n\n${m.body}`, gmail: { messageId: m.id, threadId: m.threadId, to: m.to.join(", "), subject: m.subject, account: m.account },
        });
      }
      await w.update("pitches", id, { lastContactAt: new Date(fresh[fresh.length - 1].date) });
    });
    return { added: fresh.length };
  },
});

export const bookingCommands = [
  venuesCreate, venuesUpdate, venuesRemove, venuesMergeInto, promotersCreate, promotersUpdate, promotersRemove,
  venueTypesAdd, venueTypesRename, venueTypesRemove,
  festivalsCreate, festivalsUpdate, festivalsRemove, festivalsPage, editionsCreate, editionsUpdate, editionsRemove,
  contactsCreate, contactsUpdate, contactsRemove, contactsAttach, contactsDetach, contactsSetRoles,
  pitchesFlag, pitchesUpdate, pitchesMove, pitchesComment, pitchesLog, pitchesRemove,
  templatesCreate, templatesUpdate, templatesRemove, pitchesSendEmail, pitchesDraftEmail, pitchesCheckReplies,
];
