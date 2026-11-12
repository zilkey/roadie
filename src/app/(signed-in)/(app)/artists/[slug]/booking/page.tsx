import { redirect } from "next/navigation";
import { artistPath, ROUTES } from "@/lib/routes";

/** Booking opens on Ongoing: the full Pitch List went away (#82 Q1), campaign pages replace it. */
export default async function Page({ params }: PageProps<"/artists/[slug]/booking">) {
  const { slug } = await params;
  redirect(artistPath(slug, ROUTES.bookingPitches.path));
}
