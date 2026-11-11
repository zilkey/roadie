"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

/**
 * Only for logins that can't use the app at all (AI-tools-only, or a removed person). Someone who is simply on no band
 * yet goes to /no-band; this path stays so old links and bookmarks still land somewhere sensible.
 */
export default function NotInvited() {
  const { state } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (state.status === "noBand") router.replace("/no-band");
    if (state.status === "ready") router.replace("/artists");
  }, [state.status, router]);
  const email = state.status === "notInvited" ? state.email : undefined;
  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 py-10" data-testid="not-invited">
      <h1 className="page-title">This account can&apos;t sign in</h1>
      <p>{email ? <b>{email}</b> : "That Google account"} can&apos;t be used to sign in to Roadie. Try a different Google account.</p>
      <Link href="/signin" className="btn acc" data-testid="try-again">Try a different account</Link>
    </main>
  );
}
