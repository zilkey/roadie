"use client";
import { BackLink } from "@/components/BackLink";
import Link, { useArtist, useArtistRouter as useRouter } from "@/lib/artist";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ErrorBox, useCommand } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { Menu } from "@/components/Menu";
import { SaveStatus } from "@/components/SaveStatus";
import { InlineValue } from "@/components/InlineValue";
import { Tabs } from "@/components/booking/common";
import { DetailCard, DetailPage } from "@/components/booking/DetailCards";
import { useAutosave } from "@/lib/autosave";
import { useCollection, useDoc } from "@/lib/firestore-hooks";
import { fmtTourDates } from "@/lib/tours";
import { TourStatusPill, actName, townOf, type TourRow } from "@/components/tours/common";
import { TourInfo, type TourForm } from "@/components/tours/TourInfo";
import { TourAsk } from "@/components/tours/TourAsk";
import { TourPlan } from "@/components/tours/TourPlan";
import type { Musician, Project, Tour } from "@/schema";

type Tab = "plan" | "sheet" | "info" | "money";

export default function TourPage() { return <Suspense><Page /></Suspense>; }

function Page() {
  const { id } = useParams<{ id: string }>();
  const tour = useDoc<Tour>("tours", id);
  if (tour.loading) return null;
  if (!tour.doc) return <div className="card" data-testid="not-found">That tour isn&apos;t here any more. <Link href="/tours" className="font-bold">Back to Tours</Link></div>;
  return <TourView tour={tour.doc as TourRow} />;
}

const formOf = (t: Tour): TourForm => ({
  name: t.name, status: t.status, startDate: t.startDate ?? "", endDate: t.endDate ?? "", leavingFrom: t.leavingFrom ?? null, billedAs: t.billedAs ?? "",
  projectId: t.projectId, personnel: t.personnel ?? [], notes: t.notes ?? "",
});

/**
 * A tour: back link, the title (click to edit for admins), status pill and meta line; Saved, Ask who's free and More ▾ on the
 * title line. Tabs Plan · Sheet · Info · Money (?tab=); Plan is the default and Money is admins only, even by URL. Everything
 * autosaves through tours.update (with an Undo toast). Members read the same page.
 */
function TourView({ tour }: { tour: TourRow }) {
  const admin = useProfile().role === "admin";
  const artist = useArtist().doc;
  const router = useRouter();
  const raw = useSearchParams().get("tab");
  const tab: Tab = raw === "sheet" || raw === "info" ? raw : raw === "money" && admin ? "money" : "plan";
  const setTab = (t: Tab) => router.replace(`/tours/${tour.id}${t === "plan" ? "" : `?tab=${t}`}`, { scroll: false });
  const { call, error, busy } = useCommand();
  const musicians = useCollection<Musician>("musicians").rows ?? [];
  const projects = useCollection<Project>("projects").rows ?? [];

  const [form, setForm] = useState<TourForm>(() => formOf(tour));
  const as = useAutosave({ command: "tours.update", id: tour.id, rev: tour.rev, title: tour.name, onUseTheirs: () => setForm(formOf(tour)) });
  // Follow the record when it changes under us (Undo, someone else), unless we have edits on the way.
  const serverKey = JSON.stringify(formOf(tour));
  useEffect(() => { if (!as.isBusy()) setForm(JSON.parse(serverKey)); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (patch: Record<string, unknown>) => {
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? (k === "leavingFrom" ? null : "")])) }));
    as.patch(patch);
    await as.flush();
    return true;
  };

  const remove = async (question: string) => { if (confirm(question) && (await call("tours.remove", { id: tour.id }))) router.push("/tours"); };
  const act = actName(artist, form.billedAs);
  const meta = [form.startDate || form.endDate ? fmtTourDates(form.startDate || undefined, form.endDate || undefined) : "", form.leavingFrom ? `from ${townOf(form.leavingFrom)}` : "", act ?? ""].filter(Boolean).join(" · ");

  return (
    <DetailPage testid="tour-page" wide={tab === "plan"} back={<BackLink href="/tours" label="All tours" />}
      title={admin
        ? <InlineValue testid="tour-title" label="Name" kind="text" value={form.name} canEdit validate={(v) => (v ? null : "A tour needs a name")} onSave={(v) => save({ name: v })} />
        : form.name}
      pill={<TourStatusPill status={form.status} />}
      meta={meta ? <span data-testid="tour-meta">{meta}</span> : undefined}
      more={admin && <div className="flex flex-wrap items-center gap-2">
        <SaveStatus {...as.statusProps} />
        <TourAsk tour={tour} musicians={musicians} />
        <Menu label="More actions" testid="tour" trigger={<span className="px-2 text-sm font-semibold">More ▾</span>} items={[
          { key: "cancel", label: "Cancel tour", danger: true, disabled: busy, onSelect: () => remove(`Cancel ${tour.name}? Its shows, pitches and money stay; they just come off the tour.`) },
          { key: "archive", label: "Archive", danger: true, disabled: busy, onSelect: () => remove(`Archive ${tour.name}? Its shows, pitches and money stay; they just come off the tour.`) },
        ]} />
      </div>}>
      <Tabs<Tab> testid="tour-tab" value={tab} onChange={setTab}
        options={[["plan", "Plan"], ["sheet", "Sheet"], ["info", "Info"], ...(admin ? [["money", "Money"] as [Tab, string]] : [])]} />
      <ErrorBox error={error} />

      {tab === "plan" && <TourPlan tour={tour} admin={admin} extend={save} />}
      {tab === "sheet" && <DetailCard private title="Sheet" testid="tour-sheet"><span className="d-muted">The sheet is coming soon.</span></DetailCard>}
      {tab === "info" && <TourInfo form={form} admin={admin} musicians={musicians} projects={projects} save={save} />}
      {tab === "money" && admin && <DetailCard private title="Money" testid="tour-money"><span className="d-muted">The tour&apos;s money is coming soon.</span></DetailCard>}
    </DetailPage>
  );
}
