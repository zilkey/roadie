/**
 * The two money modals (MoneyOutModal.tsx, MoneyInModal.tsx) and what opens them. Any page may open one with the
 * context it has: a show passes its showId and projectId, the We owe card passes the person (userId or musicianId)
 * and their open items, a project page its projectId. Everything else the admin picks in the modal.
 */
export interface MoneyDefaults {
  projectId?: string;
  showId?: string;
  /** Money out only: who, as a band user. */
  userId?: string;
  /** Money out only: who, as a player (when they have no user). */
  musicianId?: string;
  /** Money out only: open "We paid" with these pay-back expense ids ticked (a reimbursement). */
  expenseIds?: string[];
  /** Money out only: open "We paid" instead of "We owe". */
  paid?: boolean;
}
export interface MoneyModalProps {
  open: boolean;
  onClose: () => void;
  defaults?: MoneyDefaults;
}
export type MoneyOutModalProps = MoneyModalProps;
export type MoneyInModalProps = MoneyModalProps;
