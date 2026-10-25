"use client";
import { useParams } from "next/navigation";
import { StagePlotEditor } from "@/components/stagePlots/StagePlotEditor";

export default function StagePlotPage() {
  const { id } = useParams<{ id: string }>();
  return <StagePlotEditor id={id} />;
}
