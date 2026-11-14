"use client";
import { BackLink } from "@/components/BackLink";
import { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { Dropdown } from "@/components/Shell";
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
import { FanPageCard } from "@/components/shows/page/FanPageCard";
import { PromotionCard } from "@/components/shows/page/PromotionCard";
import { PostersCard } from "@/components/shows/page/PostersCard";
import { ChecklistSidebar } from "@/components/shows/checklists/ChecklistSidebar";
import { bandsintownItemOf, useBandsintownAutoCheck } from "@/components/shows/checklists/BandsintownLink";
import { Comments } from "@/components/shows/page/Comments";
import { MoneyInCard, MoneyOutCard } from "@/components/money/MoneyCards";
import { ExpensesCard } from "@/components/shows/page/ExpensesCard";
import { ProjectCard } from "@/components/shows/page/ProjectCard";
import { NetCard } from "@/components/shows/page/NetCard";
import { ShowFansBanner } from "@/components/fans/ShowFansBanner";
import type { Show } from "@/schema";

type Tab = "details" | "setlist" | "promotion" | "finances";
const TABS: Tab[] = ["details", "setlist", "promotion", "finances"];

export default function ShowPage() { return <Suspense><Page /></Suspense>; }

function Page() {
  const { id } = useParams<{ id: string }>();
  const { doc: show, loading } = useDoc<Show>("shows", id);
  const nf = useNotFound(loading, show, "show");
  if (nf || !show) return nf;
  return <ShowView show={show} />;
}

/**
 * "[venue] · [date]" (a festival edition's show: "[edition] [date]") with the status pill; tabs Show Details / Setlist / Promotion / Finances. The checklists are a 360px column on the right from lg up
 * (on every tab, the setlist's too: they are the show's to-dos), and stack under the tab's cards, above Comments, below that.
 * Comments stay in the main column. Admins get a ⋮ menu top right: Preview as band member (Exit is in the banner it shows), Archive show. There is no page-level Edit:
 * values edit where they sit, and only real forms flip.
 */
function ShowView({ show }: { show: ShowRow }) {
  const p = useProfile();
  const admin = p.role === "admin";
  const router = useRouter();
  const sp = useSearchParams();
  const tab: Tab = TABS.includes(sp.get("tab") as Tab) ? (sp.get("tab") as Tab) : "details";
  const setTab = (t: Tab) => router.replace(`/shows/${show.id}${t === "details" ? "" : `?tab=${t}`}`);
  const { call, error, busy } = useCommand();
  const { setPreviewAsMember } = useArtist();
  const bit = bandsintownItemOf(show.checklists ?? []);
  useBandsintownAutoCheck(show.id, !!bit && !bit.item.done, admin);
  async function archive() {
    if (!confirm(show.calendarEventId ? "Archive this show? Its event comes off the band calendar too." : "Archive this show?")) return;
    if (await call("shows.remove", { id: show.id })) router.replace("/shows");
  }

  return (
    <div className="show-page" data-testid="show-page" data-show-id={show.id}>
      <header className="grid gap-1.5">
        <BackLink mode="back" href="/shows" label="All shows" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="page-title" data-testid="page-title">{show.editionName ? `${show.editionName} ${fmtLongYear(show.date)}` : `${showName(show)} · ${fmtLongYear(show.date)}`}</h1>
            <StatusPill show={show} admin={admin} />
          </div>
          {admin && (
            <Dropdown label="Show actions" testid="show-menu" listTestid="show-menu-list" className="ib" trigger={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
            }>
              <button type="button" role="menuitem" className="menu-item" onClick={() => setPreviewAsMember(true)} data-testid="show-preview-member">Preview as band member</button>
              <div className="menu-sep" role="separator" />
              <button type="button" role="menuitem" className="menu-item danger" disabled={busy} onClick={() => void archive()} data-testid="show-archive">Archive show</button>
            </Dropdown>
          )}
        </div>
        <ErrorBox error={error} />
      </header>

      <Tabs<Tab> testid="show-tab" value={tab} onChange={setTab} options={[["details", "Show Details"], ["setlist", "Setlist"], ["promotion", "Promotion"], ["finances", "Finances"]]} />

      <div className="show-cols">
        <div className="show-main">
            {tab === "details" && <>
              <WhereWhenCard show={show} admin={admin} />
              <WhosPlayingCard show={show} admin={admin} />
              <SoundCard show={show} admin={admin} />
              <StagePlotCard show={show} admin={admin} />
              {admin && <CustomFieldsCard show={show} />}
            </>}
            {tab === "setlist" && <SetlistTab show={show} admin={admin} />}
            {tab === "promotion" && <>
              <PostersCard show={show} admin={admin} />
              <PromotionCard show={show} admin={admin} />
              {admin && <FanPageCard show={show} />}
            </>}
            {tab === "finances" && <>
              {admin && <ProjectCard show={show} />}
              {admin && <MoneyInCard context={{ kind: "show", showId: show.id, projectId: show.projectId }} />}
              {admin && <MoneyOutCard context={{ kind: "show", showId: show.id, projectId: show.projectId }} splitEvenly />}
              {!admin && <ExpensesCard show={show} admin={admin} />}
            </>}
        </div>

        <aside className="show-side" aria-label="Checklists">
          {tab === "finances" && admin && <div className="mb-3"><NetCard show={show} /></div>}
          <ChecklistSidebar host={{ kind: "show", id: show.id, artistId: show.artistId, checklists: show.checklists }} admin={admin} />
        </aside>

        <div className="show-main show-after">
          <ShowFansBanner showId={show.id} />
          <div className="mt-3"><Comments show={show} admin={admin} /></div>
        </div>
      </div>
    </div>
  );
}
