"use client";
/**
 * An act's links as a row of small icons (the Acts table): one per link we have, in ARTIST_LINKS order, each opening in a new
 * tab with its service's name as the label. Simple line drawings in the text colour, not the services' own logos.
 */
import { ARTIST_LINKS, type ArtistLinkKey } from "@/schema";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const GLYPH: Record<ArtistLinkKey, React.ReactNode> = {
  website: <><circle cx="12" cy="12" r="9" {...S} /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" {...S} /></>,
  spotify: <><circle cx="12" cy="12" r="9" {...S} /><path d="M7.5 9.5c3-1 6.5-.7 9 .8M8 12.6c2.5-.7 5.3-.5 7.3.7M8.6 15.4c2-.5 4-.3 5.6.6" {...S} /></>,
  appleMusic: <path d="M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" {...S} />,
  bandcamp: <path d="M8 6h13l-5 12H3z" {...S} />,
  youtube: <><rect x="2.5" y="5.5" width="19" height="13" rx="4" {...S} /><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" /></>,
  instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="5" {...S} /><circle cx="12" cy="12" r="4" {...S} /><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" /></>,
  tiktok: <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.4 2.6 2.2 4.4 5 4.6" {...S} />,
  facebook: <path d="M15 3.5h-2.5A3.5 3.5 0 0 0 9 7v3H6.5v3.5H9V21h3.5v-7.5H15l.6-3.5h-3.1V7.5c0-.6.4-1 1-1H15.5z" {...S} />,
  tidal: <path d="M4 9l2.7-2.7L9.3 9 6.7 11.7zM9.3 9L12 6.3 14.7 9 12 11.7zM14.7 9l2.6-2.7L20 9l-2.7 2.7zM9.3 14.4L12 11.7l2.7 2.7L12 17z" {...S} />,
  linktree: <path d="M12 21v-7M12 14l-6-6M12 14l6-6M12 14V3M5 11h14" {...S} />,
  bandsintown: <path d="M4 20h16M4 20V8h4v6h3V4h4v10h3V8h2v12" {...S} />,
};
const LABEL = Object.fromEntries(ARTIST_LINKS) as Record<ArtistLinkKey, string>;

export function LinkIcons({ links, name, testid }: { links?: Partial<Record<ArtistLinkKey, string>>; name: string; testid?: string }) {
  const have = ARTIST_LINKS.map(([k]) => k).filter((k) => links?.[k]);
  if (!have.length) return <span className="dash">—</span>;
  return (
    <span className="link-icons" data-testid={testid}>
      {have.map((k) => (
        <a key={k} href={links![k]} target="_blank" rel="noopener noreferrer" title={LABEL[k]} aria-label={`${name} on ${LABEL[k]}`} data-testid={testid && `${testid}-${k}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>{GLYPH[k]}</svg>
        </a>
      ))}
    </span>
  );
}
