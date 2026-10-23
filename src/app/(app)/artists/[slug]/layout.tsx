import { ArtistGate } from "@/components/ArtistGate";

/** Every band page lives under its artist: /artists/{slug}/... Only the artist's members get in. */
export default async function ArtistLayout({ children, params }: LayoutProps<"/artists/[slug]">) {
  const { slug } = await params;
  return <ArtistGate slug={slug}>{children}</ArtistGate>;
}
