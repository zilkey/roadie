"use client";
import Link from "@/lib/artist";
import { PageTitle } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { Projects } from "@/components/money/Projects";

export default function ProjectsPage() {
  const p = useProfile();
  return (
    <div className="grid gap-5">
      <PageTitle title="Projects" back={<Link href="/money" className="back-link" data-testid="back">‹ Money</Link>} />
      <Projects admin={p.role === "admin"} />
    </div>
  );
}
