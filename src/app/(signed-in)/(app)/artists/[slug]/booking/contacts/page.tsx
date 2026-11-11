import { redirect } from "next/navigation";
import { artistPath } from "@/lib/routes";

/** Contacts used to be a Booking tab; they have their own section now. */
export default async function Page({ params }: PageProps<"/artists/[slug]/booking/contacts">) {
  const { slug } = await params;
  redirect(artistPath(slug, "/contacts"));
}
