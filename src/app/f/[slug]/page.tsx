import type { Metadata } from "next";
import { FanList } from "./FanList";

// Public, no login. Deliberately imports nothing from the app (no auth, no Firebase): one client component and plain fetch.
export const metadata: Metadata = { title: "Join the list", robots: { index: false } };

export default async function FanListPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ showId?: string | string[] }> }) {
  const { slug } = await params;
  const { showId } = await searchParams;
  return <FanList slug={slug} showId={typeof showId === "string" ? showId : undefined} />;
}
