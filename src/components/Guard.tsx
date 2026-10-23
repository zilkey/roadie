"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

/** Signed-in gate for the app shell: sends everyone else to sign-in / not-invited. */
export function SignedIn({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "signedOut") router.replace("/signin");
    if (state.status === "notInvited") router.replace("/not-invited");
  }, [state.status, router]);
  if (state.status !== "ready") return <div className="grid min-h-dvh place-items-center s" data-testid="auth-loading">Loading…</div>;
  return <>{children}</>;
}

/** Page-level role gate. Non-admins go back Home. */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();
  const ok = state.status === "ready" && state.profile.role === "admin";
  useEffect(() => { if (state.status === "ready" && !ok) router.replace("/home"); }, [state.status, ok, router]);
  return ok ? <>{children}</> : null;
}
