"use client";
import { Suspense, useEffect, useState } from "react";
import NextLink from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, type PendingInvite } from "@/lib/auth";
import { clientAuth } from "@/lib/firebase-client";
import { artistPath, isLegacyPath } from "@/lib/routes";

/**
 * Your artists. With one, you go straight to it; with several, you pick. `?next=/shows/123` (an old link, see
 * src/proxy.ts) opens that page inside the artist. Another artist's invite shows here as "Join <artist>?" with Join and Decline,
 * also when you have no artist yet.
 */
export default function ArtistsPage() {
  return <Suspense fallback={null}><Picker /></Suspense>;
}

function Picker() {
  const { state, signOut, refresh } = useAuth();
  const router = useRouter();
  const raw = useSearchParams().get("next") ?? "";
  const next = isLegacyPath(raw) ? raw : "/calendar";
  const artists = state.status === "ready" ? state.profile.artists : [];
  const invites = state.status === "ready" ? state.profile.invites ?? [] : state.status === "noBand" ? state.invites ?? [] : [];
  const only = artists.length === 1 && !invites.length ? artists[0] : null;
  const none = state.status === "ready" && !artists.length && !invites.length;
  useEffect(() => {
    if (only) router.replace(artistPath(only.slug, next));
    if (none) router.replace("/no-band"); // one screen for "no band yet"
  }, [only, none, next, router]);
  if ((state.status !== "ready" && !(state.status === "noBand" && invites.length)) || only || none) return null;

  return (
    <main className="mx-auto grid min-h-dvh max-w-md content-center gap-4 px-4 py-10" data-testid="artist-picker">
      <h1 className="page-title">{artists.length ? "Pick a band" : "You're invited"}</h1>
      {invites.map((i) => <Invite key={i.id} invite={i} onAnswered={refresh} />)}
      <div className="grid gap-2">
        {artists.map((a) => (
          <NextLink key={a.artistId} href={artistPath(a.slug, next)} className="card flex items-center justify-between" data-testid={`artist-${a.slug}`}>
            <b>{a.name}</b><span className={`chip ${a.role === "admin" ? "a" : "m"}`}>{a.role}</span>
          </NextLink>
        ))}
      </div>
      <button className="btn ghost sm w-fit" onClick={signOut}>Sign out</button>
    </main>
  );
}

/** "Join <artist>?": Join makes you a member there (your sign-in picks up the new artist before it opens); Decline drops the invite. */
function Invite({ invite, onAnswered }: { invite: PendingInvite; onAnswered(): Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function answer(action: "accept" | "decline") {
    const user = clientAuth().currentUser;
    if (!user) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(invite.id)}/${action}`, { method: "POST", headers: { authorization: `Bearer ${await user.getIdToken()}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message ?? "That didn't work. Try again.");
      await user.getIdToken(true); // the new artist is in your sign-in's claims before it opens
      await onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally { setBusy(false); }
  }
  return (
    <div className="card grid gap-2" data-testid={`invite-${invite.artistId}`}>
      <b>Join {invite.artistName}?</b>
      <span className="s">{invite.invitedBy ? `${invite.invitedBy} added you` : "You were added"} as {invite.role === "admin" ? "an Admin" : "a Standard member"}.</span>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="flex gap-2">
        <button className="btn acc sm" disabled={busy} onClick={() => answer("accept")} data-testid="invite-join">Join</button>
        <button className="btn ghost sm" disabled={busy} onClick={() => answer("decline")} data-testid="invite-decline">Decline</button>
      </div>
    </div>
  );
}
