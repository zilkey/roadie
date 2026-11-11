import type { z } from "zod";
import { UserInput } from "./users";
import { MusicianInput } from "./musicians";
import { ArtistInput } from "./artists";
import { ContactRecord } from "./contacts";
import { VenueRecord } from "./venues";
import { VenueNoteInput } from "./venueNotes";
import { VenueEventNoteInput } from "./venueEvents";
import { FestivalNoteInput, EditionNoteInput, PromoterNoteInput, ContactNoteInput, ActNoteInput } from "./bandNotes";
import { ActRecord } from "./acts";
import { PromoterRecord } from "./promoters";
import { FestivalRecord } from "./festivals";
import { VenueTypeInput } from "./venueTypes";
import { EditionRecord } from "./editions";
import { PitchInput, CommentInput, ActivityInput } from "./pitches";
import { EmailTemplateInput } from "./emailTemplates";
import { EmailThreadInput } from "./emailThreads";
import { ShowInput, ShowDealInput } from "./shows";
import { AvailabilityInput } from "./availability";
import { FanInput } from "./fans";
import { ChecklistTemplateInput } from "./checklistTemplates";
import { SongRecord } from "./songs";
import { FileInput } from "./files";
import { SetlistInput, SetlistTemplateInput } from "./setlists";
import { StagePlotDocInput } from "./stagePlots";
import { RehearsalInput } from "./rehearsals";
import { ExpenseInput } from "./expenses";
import { ProjectInput } from "./projects";
import { ReleaseInput, ReleaseTrackInput } from "./releases";
import { TourInput, TourEntryInput } from "./tours";
import { PostInput } from "./posts";
import { IncomeInput } from "./income";
import { PayoutInput } from "./payouts";
import { StatSnapshotInput } from "./statSnapshots";
import { HistoryInput } from "./history";
import { McpTokenInput } from "./mcpTokens";
import { ShortcutTokenInput } from "./shortcutTokens";
import { e164, lowerEmail, matchKeyFor } from "./normalize";

export * from "./common";
export * from "./normalize";
export * from "./users";
export * from "./assistant";
export * from "./musicians";
export * from "./people";
export * from "./artists";
export * from "./contacts";
export * from "./venues";
export * from "./venueNotes";
export * from "./venueEvents";
export * from "./bandNotes";
export * from "./promoters";
export * from "./acts";
export * from "./festivals";
export * from "./venueTypes";
export * from "./editions";
export * from "./pitches";
export * from "./emailTemplates";
export * from "./emailThreads";
export * from "./shows";
export * from "./availability";
export * from "./fans";
export * from "./checklistTemplates";
export * from "./songs";
export * from "./files";
export * from "./docContent";
export * from "./setlists";
export * from "./rehearsals";
export * from "./stagePlots";
export * from "./expenses";
export * from "./projects";
export * from "./releases";
export * from "./tours";
export * from "./posts";
export * from "./income";
export * from "./payouts";
export * from "./driving";
export * from "./statSnapshots";
export * from "./history";
export * from "./mcpTokens";
export * from "./shortcutTokens";

export interface CollectionDef {
  /** Validates the writable fields (no server-stamped ones). */
  input: z.ZodType;
  /** Dedupe on matchKey and merge into an existing doc. */
  dedupe?: boolean;
  /** Never edited or deleted after creation. */
  immutable?: boolean;
  /** Append-only: create only. */
  appendOnly?: boolean;
}

/** Keyed by "kind": the collection id, or the sub-collection name (comments, activity). */
export const collections: Record<string, CollectionDef> = {
  users: { input: UserInput },
  musicians: { input: MusicianInput },
  artists: { input: ArtistInput },
  contacts: { input: ContactRecord, dedupe: true },
  venues: { input: VenueRecord, dedupe: true },
  venueNotes: { input: VenueNoteInput },
  venueEventNotes: { input: VenueEventNoteInput },
  promoters: { input: PromoterRecord, dedupe: true },
  festivals: { input: FestivalRecord, dedupe: true },
  venueTypes: { input: VenueTypeInput, dedupe: true },
  editions: { input: EditionRecord },
  festivalNotes: { input: FestivalNoteInput },
  editionNotes: { input: EditionNoteInput },
  promoterNotes: { input: PromoterNoteInput },
  contactNotes: { input: ContactNoteInput },
  acts: { input: ActRecord, dedupe: true },
  actNotes: { input: ActNoteInput },
  pitches: { input: PitchInput },
  comments: { input: CommentInput },
  activity: { input: ActivityInput, appendOnly: true },
  emailTemplates: { input: EmailTemplateInput },
  emailThreads: { input: EmailThreadInput },
  shows: { input: ShowInput },
  showDeals: { input: ShowDealInput },
  availability: { input: AvailabilityInput },
  fans: { input: FanInput },
  checklistTemplates: { input: ChecklistTemplateInput },
  songs: { input: SongRecord },
  files: { input: FileInput },
  setlistTemplates: { input: SetlistTemplateInput },
  setlists: { input: SetlistInput },
  stagePlots: { input: StagePlotDocInput },
  rehearsals: { input: RehearsalInput },
  expenses: { input: ExpenseInput },
  projects: { input: ProjectInput },
  releases: { input: ReleaseInput },
  tracks: { input: ReleaseTrackInput },
  tours: { input: TourInput },
  entries: { input: TourEntryInput },
  posts: { input: PostInput },
  income: { input: IncomeInput },
  payouts: { input: PayoutInput },
  statSnapshots: { input: StatSnapshotInput, immutable: true },
  history: { input: HistoryInput, immutable: true },
  mcpTokens: { input: McpTokenInput },
  shortcutTokens: { input: ShortcutTokenInput },
};

/** "pitches/abc/comments" -> "comments"; "venues" -> "venues". */
export function kindOf(path: string): string {
  const seg = path.split("/").filter(Boolean);
  return seg.length >= 3 ? seg[seg.length - 1] : seg[0];
}

type Doc = Record<string, unknown>;

/** Normalizes writable fields before validation: lowercase emails, E.164 phones, computed fields. */
export function normalizeDoc(kind: string, d: Doc): Doc {
  const out: Doc = { ...d };
  if (typeof out.name === "string") out.name = out.name.trim();
  if (typeof out.email === "string") out.email = lowerEmail(out.email);
  if (Array.isArray(out.emails)) out.emails = (out.emails as string[]).map(lowerEmail);
  if (Array.isArray(out.phones)) out.phones = (out.phones as string[]).map(e164);
  if (typeof out.instagram === "string") out.instagram = out.instagram.replace(/^@/, "");
  // Budgets were dropped from projects (2026-10-29): a stored one is stripped on the next write.
  if (kind === "projects") delete out.budget;
  // Releases lost their status and budget (2026-10-29): where a record stands is its tracks' statuses and its release date.
  if (kind === "releases") { delete out.status; delete out.budget; }
  if ((kind === "setlists" || kind === "setlistTemplates") && Array.isArray(out.items)) {
    out.totalSec = (out.items as { lengthSec?: number }[]).reduce((n, i) => n + (i.lengthSec ?? 0), 0);
  }
  const mk = matchKeyFor(kind, out);
  if (mk !== undefined) out.matchKey = mk;
  return out;
}

/** Fields the server computes in normalizeDoc; stripped from validation and re-added. */
export const computedFields: Record<string, string[]> = {
  contacts: ["matchKey"], venues: ["matchKey"], promoters: ["matchKey"], acts: ["matchKey"], festivals: ["matchKey"], venueTypes: ["matchKey"], setlists: ["totalSec"], setlistTemplates: ["totalSec"],
};
