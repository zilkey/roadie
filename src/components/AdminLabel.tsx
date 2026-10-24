/** The label of an admin-only card (`.card.admin`): a lock icon and the text. */
export function AdminLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="admin-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
      {children}
    </span>
  );
}
