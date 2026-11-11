"use client";
import { useParams } from "next/navigation";
import { useProfile } from "@/lib/auth";
import Link from "@/lib/artist";
import { Project } from "@/components/money/Project";

export default function ProjectRoute() {
  const { id } = useParams<{ id: string }>();
  const p = useProfile();
  if (p.role !== "admin") return <div className="empty"><span>Project money is for admins.</span> <Link href="/money/projects" className="font-bold">Back to Projects</Link></div>;
  return <Project id={id} />;
}
