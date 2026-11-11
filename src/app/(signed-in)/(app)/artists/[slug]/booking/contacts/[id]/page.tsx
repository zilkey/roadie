import { redirect } from "next/navigation";
import { artistPath } from "@/lib/routes";

export default async function Page({ params }: PageProps<"/artists/[slug]/booking/contacts/[id]">) {
  const { slug, id } = await params;
  redirect(artistPath(slug, `/contacts/${encodeURIComponent(id)}`));
}
