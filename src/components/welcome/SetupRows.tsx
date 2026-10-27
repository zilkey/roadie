"use client";
import NextLink from "next/link";
import { artistPath } from "@/lib/routes";

/** One optional next step after starting a band. `href` is artist-relative; a row without one is not built yet. */
export interface SetupRow { id: "people" | "links" | "google" | "import"; title: string; hint: string; href?: string }

/** The four rows of the Ready screen (and, later, Home's "Finish setting up" card). */
export const SETUP_ROWS: readonly SetupRow[] = [
  { id: "people", title: "Invite your band", hint: "Add the people you play with.", href: "/welcome/people" },
  { id: "links", title: "Add your links", hint: "Website, Spotify, Instagram and your Signal group.", href: "/welcome/links" },
  { id: "google", title: "Connect Google", hint: "Calendar, Gmail and Drive for the band.", href: "/welcome/google" },
  { id: "import", title: "Bring in venues or songs", hint: "Start from a list you already have." },
];

/** The rows as a list. `done` marks finished rows (Home's card); the Ready screen passes nothing. */
export function SetupRows({ slug, done = {}, only }: { slug: string; done?: Partial<Record<SetupRow["id"], boolean>>; only?: readonly SetupRow["id"][] }) {
  const rows = SETUP_ROWS.filter((r) => !only || only.includes(r.id));
  return (
    <ul className="m-0 grid list-none gap-2 p-0" data-testid="setup-rows">
      {rows.map((r) => {
        const body = (
          <>
            <span className="grid min-w-0 gap-0.5">
              <b>{r.title}</b>
              <span className="s">{r.hint}</span>
            </span>
            {r.href ? <span aria-hidden>{done[r.id] ? "Done" : "›"}</span> : <span className="chip" data-testid={`setup-${r.id}-soon`}>Coming soon</span>}
          </>
        );
        return (
          <li key={r.id}>
            {r.href
              ? <NextLink href={artistPath(slug, r.href)} className="card flex items-center justify-between gap-3" data-testid={`setup-${r.id}`}>{body}</NextLink>
              : <div className="card flex items-center justify-between gap-3" data-testid={`setup-${r.id}`} aria-disabled>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
