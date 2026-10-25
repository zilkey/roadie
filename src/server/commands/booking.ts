import { z } from "zod";
import { defineCommand } from "./types";
import { patchInput, idInput } from "./util";
import { db, run, type Writer, type Doc } from "../db";
import { AppError } from "../errors";
import { gmailClient, IntegrationError } from "../integrations";
import type { MailMessage } from "../integrations/gmail";
import { unfilledFields, isActive, sortedDates } from "@/lib/booking";
import { archiveNote, artistIdOf, ensureNote, tryArtistId, hasPrivate, isPrivateField, noteOf, privateOf, refusePrivate, sharedOf, writeNote } from "../venues";
import {
  VenueInput, venueNoteId, PromoterInput, FestivalInput, EditionInput, ContactInput, EmailTemplateInput, pitchStatus, dateStr, email as emailSchema, lowerEmail, e164,
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
const EditionIn = EditionInput.omit({ festivalName: true }).extend({ venueIds: arr(EditionInput.shape.venueIds) });
const lowerEmails = z.array(z.string().transform(lowerEmail).pipe(emailSchema));
const ContactIn = ContactInput.extend({ emails: lowerEmails.default([]), phones: z.array(z.string().transform(e164).pipe(ContactInput.shape.phones.element)).default([]) });
const parentKind = z.enum(["venues", "promoters", "festivals"]);

/** Keep the band's venue promoterIds (venueNotes) and promoter.venueIds as two views of the same link. */
async function syncVenuePromoters(w: Writer, venueId: string, promoterIds: string[]) {
  const promoters = await w.query("promoters");
  for (const p of promoters) {
    const has = (p.venueIds as string[]).includes(venueId), want = promoterIds.includes(p.id);
    if (has !== want) {
      await w.update("promoters", p.id, { venueIds: want ? [...p.venueIds, venueId] : (p.venueIds as string[]).filter((x) => x !== venueId) });
    }
  }
}

async function requireVenue(w: Writer, id: string) {
  const v = await w.get("venues", id);
  if (!v || v.deletedAt) throw new AppError("not_found", "Venue not found", 404);
  return v;
}

export const venuesCreate = defineCommand({
  name: "venues.create", roles: [...VENUE_ROLES], input: VenueIn,
  description:
    "Add a venue. A venue with the same name and city merges into the existing one ({id, merged: true}); adding a room this band archived brings it back. Name, address, type, region, capacity, ages, sound, website, instagram and sources are the shared room: " +
    "every band that uses Roadie sees them. loadInNotes, notes, contactIds and promoterIds are this band's private notes (admins only; a member who sends them gets a 403).",
  run: (ctx, input) => run(ctx, async (w) => {
    const priv = Object.fromEntries(Object.entries(input).filter(([k, v]) => isPrivateField(k) && v !== undefined));
    const shared = Object.fromEntries(Object.entries(input).filter(([k]) => !isPrivateField(k)));
    refusePrivate(ctx, Object.keys(priv));
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
          });
          if (priv.promoterIds) await syncVenuePromoters(w, r.id, next.promoterIds);
        } else if (doc?.deletedAt) await ensureNote(w, venue, artistId); // adding a room this band had archived brings it back
      }
    }
    return r;
  }),
});
export const venuesUpdate = defineCommand({
  name: "venues.update", roles: [...VENUE_ROLES], input: patchInput(VenueIn),
  description:
    "Edit a venue. address and sound are whole objects (city and state required; sound needs provider): Roadie fills missing keys from the record, other callers send the whole object. notes and loadInNotes replace the text (to add, read first and resend). contactIds/promoterIds replace the list (prefer contacts.attach/detach for contacts). ages is all|18|21. Name, address, type, region, capacity, ages, sound, website, instagram and sources are the SHARED room: a change here changes it for every band that uses Roadie, " +
    "and your name goes in its history, so only change what you know is right. loadInNotes, notes, contactIds and promoterIds are this band's private notes (admins only). Renaming updates its pitches and shows.",
  run: (ctx, { id, patch }) => run(ctx, async (w) => {
    const sharedPatch = Object.fromEntries(Object.entries(patch).filter(([k, v]) => !isPrivateField(k) && v !== undefined));
    const privPatch = Object.fromEntries(Object.entries(patch).filter(([k, v]) => isPrivateField(k) && v !== undefined));
    refusePrivate(ctx, Object.keys(privPatch));
    const venue = await requireVenue(w, id);
    let changed = false;
    if (Object.keys(sharedPatch).length) changed = (await w.update("venues", id, sharedPatch)).changed;
    if (Object.keys(privPatch).length) {
      const artistId = await artistIdOf(w);
      // The autosave form sends the notes' rev: conflict checks follow the notes doc, not the shared one.
      if (ctx.baseRev?.id === id && !Object.keys(sharedPatch).length) ctx.baseRev = { id: venueNoteId(artistId, id), rev: ctx.baseRev.rev };
      await writeNote(w, venue, artistId, privPatch);
      if (privPatch.promoterIds) await syncVenuePromoters(w, id, privPatch.promoterIds as string[]);
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
    for (const [coll, key] of [["promoters", "promoters"], ["editions", "editions"]] as const) {
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

export const promotersCreate = defineCommand({
  name: "promoters.create", roles: [...ROLES], input: PromoterIn,
  description: "Add a promoter or booking group. Same name merges into the existing one. kind: promoter|venueGroup|nonprofit|buyer. venueIds/contactIds are the whole lists; link contacts with contacts.attach.",
  run: (ctx, input) => db.create(ctx, "promoters", input),
});
export const promotersUpdate = defineCommand({
  name: "promoters.update", roles: [...ROLES], input: patchInput(PromoterIn),
  description: "Edit a promoter. kind: promoter|venueGroup|nonprofit|buyer. venueIds/contactIds replace the lists; link contacts with contacts.attach.",
  run: (ctx, { id, patch }) => db.update(ctx, "promoters", id, patch as Record<string, unknown>),
});
export const promotersRemove = defineCommand({
  name: "promoters.remove", roles: ["admin"], input: idInput, description: "Archive a promoter.",
  run: (ctx, { id }) => db.softDelete(ctx, "promoters", id),
});

export const festivalsCreate = defineCommand({
  name: "festivals.create", roles: [...ROLES], input: FestivalIn,
  description: "Add a festival or series. Same name merges into the existing one.",
  run: (ctx, input) => db.create(ctx, "festivals", input),
});
export const festivalsUpdate = defineCommand({
  name: "festivals.update", roles: [...ROLES], input: patchInput(FestivalIn),
  description: "Edit a festival. type: festival|series. contactIds replaces the list; link contacts with contacts.attach. Renaming updates its editions and their pitches.",
  run: (ctx, { id, patch }) => db.update(ctx, "festivals", id, patch as Record<string, unknown>),
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
  description: "Add a dated year of a festival (applications, deadline, dates).",
  run: (ctx, input) => run(ctx, async (w) => {
    const f = await w.get("festivals", input.festivalId);
    if (!f || f.deletedAt) throw new AppError("not_found", "Festival not found", 404);
    return w.create("editions", { ...input, festivalName: f.name });
  }),
});
export const editionsUpdate = defineCommand({
  name: "editions.update", roles: [...ROLES], input: patchInput(EditionIn.omit({ festivalId: true })),
  description: "Edit an edition. Changing the label updates its pitches.",
  run: (ctx, { id, patch }) => db.update(ctx, "editions", id, patch as Record<string, unknown>),
});
export const editionsRemove = defineCommand({
  name: "editions.remove", roles: ["admin"], input: idInput, description: "Archive an edition.",
  run: (ctx, { id }) => db.softDelete(ctx, "editions", id),
});

export const contactsCreate = defineCommand({
  name: "contacts.create", roles: [...ROLES], input: ContactIn.extend({ attachTo: z.strictObject({ kind: parentKind, id: z.string().min(1) }).optional() }),
  description: "Add a person. Same email (or name when no email) merges into the existing contact. attachTo links them to a venue, promoter or festival.",
  run: (ctx, { attachTo, ...input }) => run(ctx, async (w) => {
    const r = await w.create("contacts", input);
    if (attachTo) await attach(w, attachTo.kind, attachTo.id, r.id);
    return r;
  }),
});
export const contactsUpdate = defineCommand({
  name: "contacts.update", roles: [...ROLES], input: patchInput(ContactIn),
  description: "Edit a contact. emails/phones replace the lists (first email is primary; emails lowercased, phones stored E.164): read first. Use contacts.attach/detach for links.",
  run: (ctx, { id, patch }) => db.update(ctx, "contacts", id, patch as Record<string, unknown>),
});
export const contactsRemove = defineCommand({
  name: "contacts.remove", roles: ["admin"], input: idInput, description: "Archive a contact and unlink them from places.",
  run: (ctx, { id }) => run(ctx, async (w) => {
    for (const kind of parentKind.options) {
      if (kind === "venues") {
        // Archiving a contact unlinks them from every band's notes (contacts are shared, admin-only records), and from venues not yet migrated.
        for (const n of await w.query("venueNotes", (q) => q.where("contactIds", "array-contains", id), { includeDeleted: true })) {
          await w.update("venueNotes", n.id, { contactIds: (n.contactIds as string[]).filter((x) => x !== id) });
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
  name: "contacts.detach", roles: [...ROLES], input: linkInput, description: "Unlink a contact from a venue, promoter or festival.",
  run: (ctx, i) => run(ctx, async (w) => { await detach(w, i.kind, i.id, i.contactId); return { id: i.contactId }; }),
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
    const open = (await w.query("pitches", (q) => q.where("target.id", "==", i.id))).find((p) => p.target.kind === i.kind && isActive(p.status));
    if (open) return { id: open.id, existing: true };
    const name = await targetName(w, i.kind, i.id);
    const artist = await artistOf(w);
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
  name: "pitches.move", roles: [...ROLES], description: "Move a pitch to another status and log it on the timeline. Statuses: idea; toPitch = on the list, not sent; pitched = we sent it; waiting; talking; booked; declined = they said no; dropped = we stopped. " +
    "Moving to pitched/waiting/talking records contact now (how \"I pitched X today\" is logged). booked alone creates no show: use shows.create with pitchId (\"Booked it\").",
  input: z.strictObject({ id: z.string().min(1), status: pitchStatus, text: z.string().optional() }),
  run: (ctx, i) => run(ctx, async (w) => {
    const p = await requirePitch(w, i.id);
    if (p.status === i.status) return { id: i.id, changed: false };
    await w.update("pitches", i.id, { status: i.status, ...(["pitched", "waiting", "talking"].includes(i.status) ? { lastContactAt: w.now } : {}) });
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
        type: "emailSent", text: i.body, gmail: { messageId: msg.id, threadId: msg.threadId, to: i.to.join(", "), subject: i.subject },
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
    const acts = await db.list(`pitches/${id}/activity`);
    const threads = [...new Set(acts.filter((a) => a.gmail?.threadId).map((a) => a.gmail.threadId as string))];
    const seen = new Set(acts.filter((a) => a.gmail?.messageId).map((a) => a.gmail.messageId as string));
    const fresh: MailMessage[] = [];
    for (const t of threads) {
      const th = await gmailClient().getThread(t).catch(gmailFail);
      fresh.push(...th.messages.filter((m) => m.direction === "received" && !seen.has(m.id)));
    }
    if (!fresh.length) return { added: 0 };
    fresh.sort((a, b) => a.date.localeCompare(b.date));
    await run(ctx, async (w) => {
      for (const m of fresh) {
        await w.create(`pitches/${id}/activity`, {
          type: "emailReply", text: `From ${m.from}\n\n${m.body}`, gmail: { messageId: m.id, threadId: m.threadId, to: m.to.join(", "), subject: m.subject },
        });
      }
      await w.update("pitches", id, { lastContactAt: new Date(fresh[fresh.length - 1].date) });
    });
    return { added: fresh.length };
  },
});

export const bookingCommands = [
  venuesCreate, venuesUpdate, venuesRemove, venuesMergeInto, promotersCreate, promotersUpdate, promotersRemove,
  festivalsCreate, festivalsUpdate, festivalsRemove, editionsCreate, editionsUpdate, editionsRemove,
  contactsCreate, contactsUpdate, contactsRemove, contactsAttach, contactsDetach,
  pitchesFlag, pitchesUpdate, pitchesMove, pitchesComment, pitchesLog, pitchesRemove,
  templatesCreate, templatesUpdate, templatesRemove, pitchesSendEmail, pitchesDraftEmail, pitchesCheckReplies,
];
