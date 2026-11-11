"use client";
import { useState } from "react";
import Link from "@/lib/artist";
import { PageTitle } from "@/components/ui";
import { useProfile } from "@/lib/auth";
import { Projects } from "@/components/money/Projects";

export default function ProjectsPage() {
  const p = useProfile();
  const admin = p.role === "admin";
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-5">
      <PageTitle title="Projects" back={<Link href="/money" className="back-link" data-testid="back">‹ Money</Link>}
        actions={admin && !adding ? <button className="btn acc" data-testid="new-project" onClick={() => setAdding(true)}>New project</button> : undefined} />
      <Projects admin={admin} adding={adding} onDoneAdding={() => setAdding(false)} />
    </div>
  );
}
