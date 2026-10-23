"use client";
import { useProfile } from "@/lib/auth";
import { Stub } from "@/components/ui";
export default function Money() {
  const p = useProfile();
  return <Stub title={p.role === "admin" ? "Money" : "My money"} slice={6} />;
}
