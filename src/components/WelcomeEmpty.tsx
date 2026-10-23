"use client";
import type { ReactNode } from "react";
import { SECTION_LABEL, type SectionId } from "@/schema/sections";
import { useHideSection } from "@/lib/sections";

/** The flat "empty window" drawing. Theme tokens only, so it follows light/dark. `variant` shortens the thin lines so pages can differ a little. */
export function WelcomeArt({ variant = 0 }: { variant?: 0 | 1 | 2 }) {
  const thin = [112, 88, 100].map((w, i) => (i === variant ? w - 24 : w));
  return (
    <svg viewBox="0 0 200 150" width="200" height="150" aria-hidden className="mx-auto" data-testid="welcome-art">
      <path d="M40 30h150l-36 112H8z" fill="var(--soft)" />
      <rect x="20" y="10" width="160" height="120" rx="14" fill="var(--accent)" />
      {[150, 160, 170].map((cx) => <circle key={cx} cx={cx} cy="23" r="3.2" fill="var(--panel)" />)}
      <path d="M20 36h160v80a14 14 0 01-14 14H34a14 14 0 01-14-14z" fill="var(--panel)" />
      <rect x="38" y="52" width="104" height="14" rx="7" fill="var(--line)" />
      {thin.map((w, i) => <rect key={i} x="38" y={78 + i * 13} width={w} height="6" rx="3" fill="var(--soft)" />)}
    </svg>
  );
}

/**
 * What a section shows when it has no data at all: it replaces ALL the page's normal UI (search, chips, tabs, lists, add buttons).
 * `actions` are the page's primary create buttons; `children` render below the card (e.g. the open "new X" form).
 *   if (!loading && nothingAtAll) return <WelcomeEmpty section="booking" title="Welcome to Booking!" body="..." actions={<button className="btn acc">+ Add a place</button>}>{form}</WelcomeEmpty>;
 */
export function WelcomeEmpty({ section, title, body, actions, children, variant, hideable = true }: {
  section: SectionId; title: string; body: ReactNode; actions?: ReactNode; children?: ReactNode; variant?: 0 | 1 | 2; hideable?: boolean;
}) {
  const hide = useHideSection(section);
  const name = SECTION_LABEL[section];
  return (
    <div className="grid gap-3" data-testid={`welcome-${section}`}>
      <div className="card justify-items-center gap-4 px-5 pt-8 pb-16 text-center">
        <WelcomeArt variant={variant} />
        <h1 className="text-2xl" data-testid="page-title">{title}</h1>
        <p className="max-w-md text-muted">{body}</p>
        {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
        {hideable && (
          <div className="grid justify-items-center gap-1.5 pt-2">
            <button type="button" className="btn ghost" data-testid={`hide-${section}`} disabled={hide.busy} onClick={hide.run}>I don&apos;t need to manage {name.toLowerCase()} right now</button>
            <span className="s max-w-xs">I&apos;ll hide {name} for you — you can always get it back by asking Roadie or from the More menu.</span>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
