"use client";
import NextLink from "next/link";
import { artistPath } from "@/lib/routes";

/** One optional next step after starting a band. `href` is artist-relative. */
export interface SetupRow { id: "people" | "links" | "google"; title: string; hint: string; href: string }

/** The three rows of the Ready screen and Home's "Finish setting up" card. */
export const SETUP_ROWS: readonly SetupRow[] = [
  { id: "people", title: "Invite your band", hint: "Add the people you play with.", href: "/welcome/people" },
  { id: "links", title: "Add your links", hint: "Website, Spotify, Instagram and your Signal group.", href: "/welcome/links" },
  { id: "google", title: "Connect Google", hint: "Calendar, Gmail and Drive for the band.", href: "/welcome/google" },
];

/** The rows as a list. `done` marks finished rows green with a check on the right; the rest show a chevron. */
export function SetupRows({ slug, done = {} }: { slug: string; done?: Partial<Record<SetupRow["id"], boolean>> }) {
  return (
    <ul className="m-0 grid list-none gap-2 p-0" data-testid="setup-rows">
      {SETUP_ROWS.map((r) => {
        const isDone = !!done[r.id];
        return (
          <li key={r.id}>
            <NextLink href={artistPath(slug, r.href)} className={`card setup-row${isDone ? " done" : ""}`} data-testid={`setup-${r.id}`} data-done={isDone ? "true" : "false"}>
              <span className="grid min-w-0 gap-0.5">
                <b>{r.title}</b>
                <span className="s">{r.hint}</span>
              </span>
              {isDone ? <span className="setup-check" role="img" aria-label="Done">✓</span> : <span aria-hidden>›</span>}
            </NextLink>
          </li>
        );
      })}
    </ul>
  );
}
