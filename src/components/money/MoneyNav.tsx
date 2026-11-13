"use client";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Link, useArtist, useHref } from "@/lib/artist";
import { useCollection } from "@/lib/firestore-hooks";
import { roleIn, type User } from "@/schema";

/**
 * The Money sub-nav (admins only), shaped like Booking's: MONEY (Overview, Projects and the breakdowns), then TAXES with
 * one link per admin (every admin can open every admin's worksheet). Beside the page on desktop; on a phone the links
 * become one row that scrolls sideways above it. Members get their page alone (My money, New expense).
 */
export function MoneyLayout({ children }: { children: React.ReactNode }) {
  const { role } = useArtist();
  if (role !== "admin") return <>{children}</>;
  return (
    <div className="min-[900px]:flex min-[900px]:items-start min-[900px]:gap-6">
      <MoneyNav />
      <div className="min-w-0 min-[900px]:flex-1">{children}</div>
    </div>
  );
}

interface Item { key: string; href: string; label: string; exact?: boolean }
const MONEY: Item[] = [
  { key: "overview", href: "/money", label: "Overview", exact: true },
  { key: "projects", href: "/money/projects", label: "Projects" },
  { key: "years", href: "/money/years", label: "By year" },
  { key: "shows", href: "/money/shows", label: "By show" },
  { key: "categories", href: "/money/categories", label: "By category" },
  { key: "people", href: "/money/people", label: "By person" },
];

/** The admins of the current artist, by name: the people whose accounts money goes through. */
export function useAdmins() {
  const { artistId } = useArtist();
  const users = useCollection<User>("users");
  return useMemo(() => (users.rows ?? []).filter((u) => roleIn(u, artistId) === "admin").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")), [users.rows, artistId]);
}

function MoneyNav() {
  const path = usePathname();
  const full = useHref();
  const admins = useAdmins();
  const groups = [
    { head: "Money", items: MONEY },
    { head: "Taxes", items: admins.map((u): Item => ({ key: `taxes-${u.id}`, href: `/money/taxes/${u.id}`, label: u.name ?? "Admin" })) },
  ];
  const on = (i: Item) => i.exact ? path === full(i.href) : path === full(i.href) || path.startsWith(full(i.href) + "/");
  return (
    <nav aria-label="Money" data-testid="money-nav"
      className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 pb-2 min-[900px]:sticky min-[900px]:top-6 min-[900px]:mx-0 min-[900px]:mb-0 min-[900px]:w-[220px] min-[900px]:shrink-0 min-[900px]:flex-col min-[900px]:gap-0 min-[900px]:overflow-visible min-[900px]:rounded-lg min-[900px]:border min-[900px]:bg-surface min-[900px]:p-2">
      {groups.map((g) => (
        <div key={g.head} className="contents min-[900px]:block">
          <div className="hidden px-3 pb-1 pt-2 text-[0.6875rem] font-bold uppercase tracking-wide text-muted min-[900px]:block">{g.head}</div>
          {g.items.map((i) => (
            <Link key={i.key} href={i.href} data-testid={`money-seg-${i.key}`} aria-current={on(i) ? "page" : undefined}
              className={`menu-item shrink-0 whitespace-nowrap${on(i) ? " bg-accent-soft text-accent" : ""}`}>
              {g.head === "Taxes" && <span className="min-[900px]:hidden">Taxes · </span>}{i.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
