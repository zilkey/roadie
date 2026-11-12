import { redirect } from "next/navigation";
import { artistPath, ROUTES } from "@/lib/routes";

/** The old Pitch List address: campaign pages replace it (#82 Q1), so it opens Ongoing. A pitch's own page (/booking/pitches/{id}) stays. */
export default async function Page({ params }: PageProps<"/artists/[slug]/booking/pitches">) {
  const { slug } = await params;
  redirect(artistPath(slug, ROUTES.bookingPitches.path));
}
