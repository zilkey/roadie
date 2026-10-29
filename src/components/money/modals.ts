/**
 * The two money modals (MoneyOutModal.tsx, MoneyInModal.tsx) and what opens them. Any page may open one with the
 * context it has: a show passes its showId and projectId, the We owe card passes the person (userId or musicianId)
 * and their open items, a project page its projectId, a ledger line the record to mark paid. Everything else the admin
 * picks in the modal.
 */
/**
 * The record a money modal or card belongs to. When a modal gets one, it hides the pickers the record decides and
 * writes the record's ids: a show hides Project and Show (the show's project), a rehearsal hides Rehearsal and starts
 * Project on the rehearsal's (still changeable), a release hides Project and Track (whole release), a track hides
 * Project and Track (pinned to the track). Everything is stored the same way it is from the Money page.
 */
export type MoneyContext =
  | { kind: "show"; showId: string; projectId?: string }
  | { kind: "rehearsal"; rehearsalId: string; projectId?: string }
  | { kind: "release"; releaseId: string; projectId: string }
  | { kind: "track"; releaseId: string; projectId: string; releaseTrackId: string };

export interface MoneyDefaults {
  /** The record the modal was opened from; see MoneyContext. */
  context?: MoneyContext;
  /** Money out only: start on this category ("gas" opens the gas form). */
  category?: string;
  projectId?: string;
  showId?: string;
  /** A release track to pin the money to (the project must be that release's); a release's Money tab or a track page passes it. */
  releaseTrackId?: string;
  /** Money out only: who, as a band user. */
  userId?: string;
  /** Money out only: who, as a player (when they have no user). */
  musicianId?: string;
  /** Money out only: open "We paid" with these pay-back expense ids ticked (a reimbursement). */
  expenseIds?: string[];
  /** Money out only: open "We paid" instead of "We owe". */
  paid?: boolean;
  /** Money out only: settle one thing we owe (an open bill or an unpaid payout): asks who paid and when, nothing else. */
  markPaid?: { kind: "expense" | "payout"; id: string };
}
export interface MoneyModalProps {
  open: boolean;
  onClose: () => void;
  defaults?: MoneyDefaults;
}
export type MoneyOutModalProps = MoneyModalProps;
export type MoneyInModalProps = MoneyModalProps;

/** The admin's two money cards (MoneyCards.tsx), the same on a show, rehearsal, release and track. */
export interface MoneyCardProps {
  context: MoneyContext;
}
