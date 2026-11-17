/**
 * Two-artist fixtures for the tenancy phases (plan phases 3-6): `seedArtist(id)` writes one record of every `artist` kind in
 * `OWNERS` (src/schema/owners.ts), plus the artist doc, an admin and a member; `seedArtists(a, b)` seeds two and adds a person who
 * is a member of A and an admin of B.
 *
 * `SAMPLES` has one entry per artist kind (its type is keyed by OWNERS, so a new artist kind fails typecheck here until it gets
 * one). Every record is written through the Writer as the artist's admin (via "app"), so it is valid and has its history entry.
 */
import { randomUUID } from "node:crypto";
import { systemCtx, type Ctx } from "@/server/ctx";
import { db } from "@/server/db";
import { OWNERS, PARENTS } from "@/schema/owners";
import { snapshotId } from "@/server/commands/stats";
import { makeUser, SYS } from "./helpers";

type ArtistKind = { [K in keyof typeof OWNERS]: (typeof OWNERS)[K] extends "artist" ? K : never }[keyof typeof OWNERS];
export const ARTIST_KINDS = (Object.keys(OWNERS) as (keyof typeof OWNERS)[]).filter((k) => OWNERS[k] === "artist") as ArtistKind[];

/** Ids a sample may point at (the artist's own records, made earlier in SAMPLE_ORDER). */
export interface SeedRefs {
  artistId: string; adminUid: string; memberUid: string; musicianId: string; memberMusicianId: string;
  shows: string; pitches: string; tours: string; releases: string; songs: string; projects: string; rehearsals: string; contacts: string;
  assistantThreads: string;
  venueId: string; actId: string; festivalId: string; editionId: string; promoterId: string; eventId: string;
}

/** One record of a kind: where it goes (a sub-collection path for comments, entries…) and its id (keyed kinds), then the input. */
interface Sample { path?: (r: SeedRefs) => string; id?: (r: SeedRefs) => string; data: (r: SeedRefs) => Record<string, unknown> }

const day = "2027-05-01";
const mail = (who: string, artistId: string) => `${who}@${artistId.toLowerCase()}.example`;
export const SAMPLES: Record<ArtistKind, Sample> = {
  musicians: { data: () => ({ name: "Sam Sample", instruments: ["drums"], active: true }) },
  projects: { data: (r) => ({ artistId: r.artistId, kind: "band", name: "The band", status: "open" }) },
  contacts: { data: (r) => ({ artistId: r.artistId, name: "Rosa Booker", emails: [mail("rosa", r.artistId)], phones: [] }) },
  songs: { data: () => ({ title: "Glass Coast", status: "active" }) },
  pitches: { data: (r) => ({ artistId: r.artistId, target: { kind: "venue", id: r.venueId, name: "Sample Room" }, status: "idea", personnel: [r.musicianId], showIds: [] }) },
  shows: {
    data: (r) => ({
      artistId: r.artistId, date: day, status: "hold", times: { set: "20:00", setLengthSec: 2400 }, personnel: [r.musicianId],
      sound: { provider: "venueProvided" }, needs: { poster: false, backline: false, merch: false }, docs: [],
      venue: { id: r.venueId, name: "Sample Room", city: "Denver" },
    }),
  },
  tours: { data: (r) => ({ artistId: r.artistId, name: "Spring run", status: "idea", projectId: r.projects }) },
  releases: { data: (r) => ({ artistId: r.artistId, title: "Sample EP", kind: "ep", projectId: r.projects }) },
  rehearsals: { data: (r) => ({ date: day, projectId: r.projects, personnel: [r.musicianId], songs: [{ songId: r.songs, title: "Glass Coast" }] }) },
  assistantThreads: { data: (r) => ({ ownerUid: r.adminUid, startedAt: new Date(), lastActiveAt: new Date(), startedOnRoute: "/shows" }) },
  comments: { path: (r) => `shows/${r.shows}/comments`, data: (r) => ({ authorId: r.adminUid, body: "Load in round back" }) },
  activity: { path: (r) => `pitches/${r.pitches}/activity`, data: () => ({ type: "note", text: "Called the room" }) },
  entries: { path: (r) => `tours/${r.tours}/entries`, data: (r) => ({ tourId: r.tours, kind: "note", position: 0, visibility: "band", tz: "America/Denver" }) },
  tracks: { path: (r) => `releases/${r.releases}/tracks`, data: (r) => ({ releaseId: r.releases, position: 1, songId: r.songs, title: "Glass Coast", status: "mixing" }) },
  showDeals: { id: (r) => r.shows, data: () => ({ contactIds: [], deal: "guarantee" }) },
  setlists: { id: (r) => r.shows, data: (r) => ({ items: [{ type: "song", songId: r.songs, title: "Glass Coast" }] }) },
  setlistTemplates: { data: (r) => ({ name: "Long set", items: [{ type: "song", songId: r.songs, title: "Glass Coast" }] }) },
  files: { data: (r) => ({ kind: "chart", title: "Glass Coast chart", songId: r.songs, url: "https://example.com/chart", checkedAt: new Date() }) },
  expenses: { data: (r) => ({ userId: r.adminUid, date: day, amount: 1200, category: "gear", what: "Strings", projectId: r.projects, showId: r.shows }) },
  income: { data: (r) => ({ artistId: r.artistId, date: day, amount: 30000, category: "guarantee", from: "Sample Room", projectId: r.projects, showId: r.shows }) },
  payouts: { data: (r) => ({ artistId: r.artistId, to: { musicianId: r.musicianId, name: "Sam Sample" }, kind: "pay", amount: 5000, projectId: r.projects }) },
  availability: { data: (r) => ({ date: day, label: "Sample Room", showId: r.shows, askedMusicianIds: [r.musicianId], responses: {}, linkTokens: {} }) },
  stagePlots: { data: () => ({ name: "Trio", stage: { widthFt: 20, depthFt: 12 }, inputs: [], items: [], monitors: [], version: 1 }) },
  emailTemplates: { data: () => ({ name: "Pitch", subject: "Booking", body: "Hi", targetKinds: ["venue"] }) },
  statSnapshots: { id: (r) => snapshotId(r.artistId, "spotifyApi", day), data: () => ({ source: "spotifyApi", date: day, followers: 10 }) },
  checklistTemplates: { data: (r) => ({ artistId: r.artistId, name: "Day of", order: 0, items: [] }) },
  campaigns: { data: (r) => ({ artistId: r.artistId, name: "Spring push", status: "active" }) },
  posts: { data: (r) => ({ artistId: r.artistId, caption: "Tonight!", media: [{ driveFileId: "fake-photo", mimeType: "image/jpeg" }], status: "draft", createdVia: "app" }) },
  todos: { data: (r) => ({ artistId: r.artistId, label: "Call the room" }) },
  fans: { id: (r) => `${r.artistId}__fan`, data: (r) => ({ artistId: r.artistId, email: mail("fan", r.artistId), cities: [], showIds: [], source: "list", lastSeenAt: new Date() }) },
  emailThreads: {
    data: (r) => ({
      artistId: r.artistId, account: mail("admin", r.artistId), threadId: `t-${r.artistId}`, target: { kind: "venue", id: r.venueId, name: "Sample Room" },
      subject: "Booking", snippet: "Hi", lastDate: day, lastFrom: "rosa@example.com", lastDirection: "received", messageCount: 1, participants: [],
    }),
  },
  venueNotes: { id: (r) => `${r.artistId}__${r.venueId}`, data: (r) => ({ artistId: r.artistId, venueId: r.venueId, contactIds: [], promoterIds: [] }) },
  venueEventNotes: { id: (r) => `${r.artistId}__${r.eventId}`, data: (r) => ({ artistId: r.artistId, venueId: r.venueId, eventId: r.eventId }) },
  actNotes: { id: (r) => `${r.artistId}__${r.actId}`, data: (r) => ({ artistId: r.artistId, actId: r.actId }) },
  festivalNotes: { id: (r) => `${r.artistId}__${r.festivalId}`, data: (r) => ({ artistId: r.artistId, festivalId: r.festivalId }) },
  editionNotes: { id: (r) => `${r.artistId}__${r.editionId}`, data: (r) => ({ artistId: r.artistId, editionId: r.editionId }) },
  promoterNotes: { id: (r) => `${r.artistId}__${r.promoterId}`, data: (r) => ({ artistId: r.artistId, promoterId: r.promoterId }) },
  contactNotes: { id: (r) => `${r.artistId}__${r.contacts}`, data: (r) => ({ artistId: r.artistId, contactId: r.contacts }) },
  socialChecklists: { id: (r) => r.artistId, data: (r) => ({ artistId: r.artistId }) },
  mcpTokens: { id: (r) => `hash-${r.artistId}`, data: (r) => ({ userId: r.adminUid, label: "Claude Desktop" }) },
  shortcutTokens: { id: (r) => `short-${r.artistId}`, data: (r) => ({ userId: r.adminUid, artistId: r.artistId }) },
  invites: { data: (r) => ({ artistId: r.artistId, email: mail("invitee", r.artistId), name: "Ivy Invitee", role: "member", invitedBy: r.adminUid }) },
};

/** Parents first: the kinds a later sample points at. */
const FIRST: ArtistKind[] = ["musicians", "projects", "contacts", "songs", "pitches", "shows", "tours", "releases", "rehearsals", "assistantThreads"];
export const SAMPLE_ORDER: ArtistKind[] = [...FIRST, ...ARTIST_KINDS.filter((k) => !FIRST.includes(k))];

/** The shared directory records every artist's samples point at (one set, made once). */
export async function seedShared(): Promise<Pick<SeedRefs, "venueId" | "actId" | "festivalId" | "editionId" | "promoterId" | "eventId">> {
  const ctx = systemCtx("seed-shared");
  const mk = async (path: string, data: Record<string, unknown>, id?: string) => (await db.create(ctx, path, data, id ? { id } : undefined)).id;
  const venueId = await mk("venues", { name: "Sample Room", type: "bar", address: { city: "Denver", state: "CO" }, region: "denver" }, "fx-venue");
  const actId = await mk("acts", { name: "The Openers" }, "fx-act");
  const festivalId = await mk("festivals", { name: "Sample Fest", type: "festival", address: { city: "Denver", state: "CO" } }, "fx-festival");
  const editionId = await mk("editions", { festivalId, festivalName: "Sample Fest", year: 2027, label: "2027", venueIds: [] }, "fx-edition");
  const promoterId = await mk("promoters", { name: "Sample Presents", kind: "promoter" }, "fx-promoter");
  return { venueId, actId, festivalId, editionId, promoterId, eventId: "fx-event" };
}

export interface SeededArtist {
  artistId: string;
  admin: { uid: string; token: string };
  member: { uid: string; token: string };
  /** Every sample's path and id, by kind (plus the artist doc and both users). */
  records: Record<ArtistKind, { path: string; id: string }>;
  refs: SeedRefs;
}

/**
 * One artist with one record of every artist kind, an admin (linked to the sample musician) and a member (with a musician of
 * their own). Shared directory records are made on first use (`seedShared`). Ids of keyed records include the artist id, so two
 * artists can be seeded side by side.
 */
export async function seedArtist(artistId: string, shared?: Awaited<ReturnType<typeof seedShared>>, timeZone = "America/Denver"): Promise<SeededArtist> {
  const sh = shared ?? (await db.get(SYS, "venues", "fx-venue") ? { venueId: "fx-venue", actId: "fx-act", festivalId: "fx-festival", editionId: "fx-edition", promoterId: "fx-promoter", eventId: "fx-event" } : await seedShared());
  const boot: Ctx = { uid: "bootstrap", role: "admin", via: "import", runId: randomUUID(), artistId };
  await db.create(boot, "artists", { name: `Artist ${artistId}`, slug: `artist-${artistId.toLowerCase()}`, timeZone, configurations: [], links: {}, driveFolderId: "" }, { id: artistId });
  const admin = await makeUser(mail("admin", artistId), "admin", { artistId, name: `Admin ${artistId}` });
  const member = await makeUser(mail("member", artistId), "member", { artistId, name: `Member ${artistId}` });
  const ctx: Ctx = { uid: admin.uid, role: "admin", via: "app", runId: randomUUID(), artistId };

  const refs = { artistId, adminUid: admin.uid, memberUid: member.uid, ...sh } as SeedRefs;
  const records = {} as SeededArtist["records"];
  for (const kind of SAMPLE_ORDER) {
    const s = SAMPLES[kind];
    const path = s.path?.(refs) ?? kind;
    const { id } = await db.create(ctx, path, s.data(refs), s.id ? { id: s.id(refs) } : undefined);
    records[kind] = { path, id };
    if (kind === "musicians") refs.musicianId = id;
    if (FIRST.includes(kind)) (refs as unknown as Record<string, string>)[kind] = id;
  }
  // The member's own musician; both users link theirs.
  refs.memberMusicianId = (await db.create(ctx, "musicians", { name: `Member ${artistId}`, instruments: ["bass"], active: true })).id;
  await db.update(SYS, "users", admin.uid, { artists: [{ artistId, role: "admin", musicianId: refs.musicianId }] });
  await db.update(SYS, "users", member.uid, { artists: [{ artistId, role: "member", musicianId: refs.memberMusicianId }] });
  return { artistId, admin, member, records, refs };
}

/** Two artists side by side, plus `both`: a member of A and an admin of B (no musician of their own). */
export async function seedArtists(a: string, b: string) {
  const shared = await seedShared();
  const A = await seedArtist(a, shared);
  const B = await seedArtist(b, shared);
  const both = await makeUser(`both@${a}-${b}.example`, "member", { name: "Both Ways", artists: [{ artistId: a, role: "member" }, { artistId: b, role: "admin" }] });
  return { A, B, both };
}

/** Sub-collection kinds (comments, entries…): the ones whose path has a parent. Re-exported for tests that walk every kind. */
export const SUB_KINDS = ARTIST_KINDS.filter((k) => PARENTS[k] && !PARENTS[k].keyedById);
