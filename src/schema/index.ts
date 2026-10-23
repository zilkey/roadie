import type { z } from "zod";
import { UserInput } from "./users";
import { MusicianInput } from "./musicians";
import { ArtistInput } from "./artists";
import { ContactInput } from "./contacts";
import { VenueInput } from "./venues";
import { PromoterInput } from "./promoters";
import { FestivalInput } from "./festivals";
import { EditionInput } from "./editions";
import { PitchInput, CommentInput, ActivityInput } from "./pitches";
import { EmailTemplateInput } from "./emailTemplates";
import { ShowInput, ShowDealInput } from "./shows";
import { AvailabilityInput } from "./availability";
import { ChecklistTemplateInput } from "./checklistTemplates";
import { SongInput } from "./songs";
import { FileInput } from "./files";
import { SetlistInput } from "./setlists";
import { RehearsalInput } from "./rehearsals";
import { LedgerInput } from "./ledger";
import { ExpenseInput } from "./expenses";
import { StatSnapshotInput } from "./statSnapshots";
import { HistoryInput } from "./history";
import { McpTokenInput } from "./mcpTokens";
import { e164, lowerEmail, matchKeyFor } from "./normalize";

export * from "./common";
export * from "./normalize";
export * from "./users";
export * from "./assistant";
export * from "./musicians";
export * from "./artists";
export * from "./contacts";
export * from "./venues";
export * from "./promoters";
export * from "./festivals";
export * from "./editions";
export * from "./pitches";
export * from "./emailTemplates";
export * from "./shows";
export * from "./availability";
export * from "./checklistTemplates";
export * from "./songs";
export * from "./files";
export * from "./setlists";
export * from "./rehearsals";
export * from "./ledger";
export * from "./expenses";
export * from "./statSnapshots";
export * from "./history";
export * from "./mcpTokens";

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
  contacts: { input: ContactInput, dedupe: true },
  venues: { input: VenueInput, dedupe: true },
  promoters: { input: PromoterInput, dedupe: true },
  festivals: { input: FestivalInput, dedupe: true },
  editions: { input: EditionInput },
  pitches: { input: PitchInput },
  comments: { input: CommentInput },
  activity: { input: ActivityInput, appendOnly: true },
  emailTemplates: { input: EmailTemplateInput },
  shows: { input: ShowInput },
  showDeals: { input: ShowDealInput },
  availability: { input: AvailabilityInput },
  checklistTemplates: { input: ChecklistTemplateInput },
  songs: { input: SongInput },
  files: { input: FileInput },
  setlists: { input: SetlistInput },
  rehearsals: { input: RehearsalInput },
  ledger: { input: LedgerInput, immutable: true },
  expenses: { input: ExpenseInput },
  statSnapshots: { input: StatSnapshotInput, immutable: true },
  history: { input: HistoryInput, immutable: true },
  mcpTokens: { input: McpTokenInput },
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
  if (kind === "setlists" && Array.isArray(out.items)) {
    out.totalSec = (out.items as { lengthSec?: number }[]).reduce((n, i) => n + (i.lengthSec ?? 0), 0);
  }
  const mk = matchKeyFor(kind, out);
  if (mk !== undefined) out.matchKey = mk;
  return out;
}

/** Fields the server computes in normalizeDoc; stripped from validation and re-added. */
export const computedFields: Record<string, string[]> = {
  contacts: ["matchKey"], venues: ["matchKey"], promoters: ["matchKey"], festivals: ["matchKey"], setlists: ["totalSec"],
};
