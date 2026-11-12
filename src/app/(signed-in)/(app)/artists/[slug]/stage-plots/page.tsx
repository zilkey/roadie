"use client";
import { StagePlotsList } from "@/components/stagePlots/StagePlotsList";

export default function StagePlotsPage() {
  return (
    <div className="grid gap-5" data-testid="stage-plots-page">
      <StagePlotsList />
    </div>
  );
}
