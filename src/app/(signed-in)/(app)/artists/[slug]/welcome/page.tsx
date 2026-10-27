"use client";
import NextLink from "next/link";
import { AdminOnly } from "@/components/Guard";
import { WelcomeArt } from "@/components/WelcomeEmpty";
import { SetupRows } from "@/components/welcome/SetupRows";
import { useArtist } from "@/lib/artist";
import { ROUTES, artistPath } from "@/lib/routes";

export default function WelcomePage() { return <AdminOnly><Ready /></AdminOnly>; }

/** Ready: the band exists. Everything below is optional and each row has a home in Settings. Reachable any time at /welcome. */
function Ready() {
  const artist = useArtist();
  return (
    <div className="mx-auto grid max-w-xl gap-5" data-testid="welcome">
      <WelcomeArt />
      <div className="grid gap-1 text-center">
        <h1 className="page-title" data-testid="page-title">{artist.name} is ready</h1>
        <p className="s">A few optional things to set up. You can do them any time.</p>
      </div>
      <SetupRows slug={artist.slug} />
      <NextLink href={artistPath(artist.slug, ROUTES.calendar.path)} className="btn acc" data-testid="go-to-app">Go to the app</NextLink>
    </div>
  );
}
