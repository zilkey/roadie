import type { Metadata } from "next";
import { FanList } from "./FanList";

// Public, no login. Deliberately imports nothing from the app (no auth, no Firebase): one client component and plain fetch.
export const metadata: Metadata = { title: "Join the list", robots: { index: false } };

export default async function FanListPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <FanList slug={slug} />;
}
