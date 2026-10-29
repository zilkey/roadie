"use client";
import Link, { useArtistRouter as useRouter } from "@/lib/artist";
import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ErrorBox, useCommand } from "@/components/ui";
import { Tabs, useNotFound } from "@/components/booking/common";
import { useProfile } from "@/lib/auth";
import { useDoc } from "@/lib/firestore-hooks";
import { fmtLongYear, showName } from "@/lib/shows";
import type { ShowRow } from "@/components/shows/common";
import { StatusPill } from "@/components/shows/page/StatusPill";
import { WhereWhenCard } from "@/components/shows/page/WhereWhenCard";
import { WhosPlayingCard } from "@/components/shows/page/WhosPlayingCard";
import { SoundCard } from "@/components/shows/page/SoundCard";
import { StagePlotCard } from "@/components/shows/page/StagePlotCard";
import { SetlistTab } from "@/components/shows/page/SetlistTab";
import { CustomFieldsCard } from "@/components/shows/page/CustomFieldsCard";
import { PromotionCard } from "@/components/shows/page/PromotionCard";
import { ChecklistSidebar } from "@/components/shows/checklists/ChecklistSidebar";
import { Comments } from "@/components/shows/page/Comments";
import { IncomeCard } from "@/components/shows/page/IncomeCard";
import { ExpensesCard } from "@/components/shows/page/ExpensesCard";
import { ProjectCard } from "@/components/shows/page/ProjectCard";
import { PaidOutCard } from "@/components/shows/page/PaidOutCard";
import { NetCard } from "@/components/shows/page/NetCard";
import { ShowFansBanner } from "@/components/fans/ShowFansBanner";
import type { Show } from "@/schema";

type Tab = "details" | "setlist" | "finances";
const TABS: Tab[] = ["details", "setlist", "finances"];

export default function ShowPage() { return <Suspense><Page /></Suspense>; }

function Page() {
  const { id } = useParams<{ id: string }>();
  const { doc: show, loading } = useDoc<Show>("shows", id);
  const nf = useNotFound(loading, show, "show");
  if (nf || !show) return nf;
  return <ShowView show={show} />;
}

/**
 * "[venue] · [date]" (a festival edition's show: "[edition] [date]") with the status pill; tabs Show Details / Setlist / Finances. The checklists are a 360px column on the right from lg up
 * (on all three tabs, the setlist's too: they are the show's to-dos), and stack under the tab's cards, above Comments, below that.
 * Comments and Archive stay in the main column. There is no page-level Edit: values edit where they sit, and only real forms flip.
 */
function ShowView({ show }: { show: ShowRow }) {
  const p = useProfile();
  const admin = p.role === "admin";
  const router = useRouter();
  const sp = useSearchParams();
  const tab: Tab = TABS.includes(sp.get("tab") as Tab) ? (sp.get("tab") as Tab) : "details";
  const setTab = (t: Tab) => router.replace(`/shows/${show.id}${t === "details" ? "" : `?tab=${t}`}`);
  const { call, error, busy } = useCommand();

  return (
    <div className="show-page" data-testid="show-page" data-show-id={show.id}>
      <header className="grid gap-1.5">
        <Link href="/shows" className="back-link" data-testid="back">← All shows</Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title" data-testid="page-title">{show.editionName ? `${show.editionName} ${fmtLongYear(show.date)}` : `${showName(show)} · ${fmtLongYear(show.date)}`}</h1>
            <StatusPill show={show} admin={admin} />
          </div>
        </div>
      </header>

      <Tabs<Tab> testid="show-tab" value={tab} onChange={setTab} options={[["details", "Show Details"], ["setlist", "Setlist"], ["finances", "Finances"]]} />

      <div className="show-cols">
        <div className="show-main">
            {tab === "details" && <>
              <WhereWhenCard show={show} admin={admin} />
              <WhosPlayingCard show={show} admin={admin} />
              <SoundCard show={show} admin={admin} />
              <StagePlotCard show={show} admin={admin} />
              <PromotionCard show={show} admin={admin} />
              {admin && <CustomFieldsCard show={show} />}
            </>}
            {tab === "setlist" && <SetlistTab show={show} admin={admin} />}
            {tab === "finances" && <>
              {admin && <ProjectCard show={show} />}
              {admin && <IncomeCard show={show} />}
              {admin && <PaidOutCard show={show} />}
              <ExpensesCard show={show} admin={admin} />
            </>}
        </div>

        <aside className="show-side" aria-label="Checklists">
          {tab === "finances" && admin && <div className="mb-3"><NetCard show={show} /></div>}
          <ChecklistSidebar show={show} admin={admin} />
        </aside>

        <div className="show-main show-after">
          <ShowFansBanner showId={show.id} />
          <div className="mt-3"><Comments show={show} admin={admin} /></div>
          {admin && (
            <div className="grid gap-2">
              <ErrorBox error={error} />
              <button type="button" className="btn outline danger justify-self-start" disabled={busy} data-testid="show-archive"
                onClick={async () => { if (confirm("Archive this show?") && (await call("shows.remove", { id: show.id }))) router.replace("/shows"); }}>Archive show</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
