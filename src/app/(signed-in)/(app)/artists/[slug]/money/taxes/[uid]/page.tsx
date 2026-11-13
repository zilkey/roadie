"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { AdminOnly } from "@/components/Guard";
import { TaxReport } from "@/components/money/TaxReport";

/** One admin's yearly tax worksheet (?year=YYYY). Every admin can open every admin's. */
export default function Page() {
  const { uid } = useParams<{ uid: string }>();
  return <AdminOnly><Suspense><TaxReport uid={uid} /></Suspense></AdminOnly>;
}
