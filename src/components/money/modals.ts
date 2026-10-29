/**
 * The two money modals (MoneyOutModal.tsx, MoneyInModal.tsx) and what opens them. Any page may open one with the
 * context it has: a show passes its showId and projectId, the We owe card passes the person (userId or musicianId)
 * and their open items, a project page its projectId, a ledger line the record to mark paid. Everything else the admin
 * picks in the modal.
 */
export interface MoneyDefaults {
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
