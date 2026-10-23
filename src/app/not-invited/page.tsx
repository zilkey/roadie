"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function NotInvited() {
  const { state } = useAuth();
  const email = state.status === "notInvited" ? state.email : undefined;
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 py-10" data-testid="not-invited">
      <h1 className="text-3xl">Not invited yet</h1>
      <p>{email ? <b>{email}</b> : "That Google account"} isn&apos;t on the band&apos;s list. Ask Jeff or Ingrid to add your email, then try again.</p>
      <Link href="/signin" className="btn acc" data-testid="try-again">Try a different account</Link>
    </main>
  );
}
